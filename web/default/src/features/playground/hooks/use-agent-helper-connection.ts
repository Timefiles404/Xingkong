import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getCommonHeaders } from '@/lib/api'
import {
  buildAgentHelperManualCommand,
  checkAgentHelperStatus,
  downloadAgentHelperToWorkspace,
  getAgentHelperDownloadTarget,
  getHelperWorkspaceName,
  isAgentHelperPaired,
  launchAgentHelperProtocol,
  pairAgentHelper,
} from '../lib'
import type { AgentHelperStatus } from '../lib'
import type { PlaygroundConversation, PlaygroundMode } from '../types'

interface UseAgentHelperConnectionOptions {
  isAgentMode: boolean
  ensureWorkspaceForHelper: () => Promise<FileSystemDirectoryHandle | null>
  createNewConversation: (
    mode?: PlaygroundMode,
    meta?: Partial<Pick<PlaygroundConversation, 'workspaceName'>>
  ) => void
  switchMode: (mode: PlaygroundMode) => void
}

export function useAgentHelperConnection({
  isAgentMode,
  ensureWorkspaceForHelper,
  createNewConversation,
  switchMode,
}: UseAgentHelperConnectionOptions) {
  const { t } = useTranslation()
  const [agentHelperStatus, setAgentHelperStatus] =
    useState<AgentHelperStatus | null>(null)
  const [isHelperDownloading, setIsHelperDownloading] = useState(false)
  const [isHelperPairing, setIsHelperPairing] = useState(false)
  const [isHelperPairDialogOpen, setIsHelperPairDialogOpen] = useState(false)
  const [helperPairCodeInput, setHelperPairCodeInput] = useState('')
  const [helperManualCommand, setHelperManualCommand] = useState('')
  const helperStatusMissesRef = useRef(0)

  useEffect(() => {
    if (!isAgentMode) return

    let cancelled = false
    const refresh = async () => {
      const status = await checkAgentHelperStatus()
      if (cancelled) return
      if (status) {
        helperStatusMissesRef.current = 0
        setAgentHelperStatus(status)
        return
      }
      helperStatusMissesRef.current += 1
      setAgentHelperStatus((previous) =>
        previous && helperStatusMissesRef.current < 3 ? previous : null
      )
    }

    void refresh()
    const timer = window.setInterval(refresh, 10000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isAgentMode])

  const refreshAgentHelperStatus = useCallback(async () => {
    const status = await checkAgentHelperStatus(2500)
    setAgentHelperStatus(status)
    return status
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pairCode = params.get('xingkong_helper_pair_code')?.trim()
    const shouldAutoStart = params.get('xingkong_helper_autostart') === '1'
    const shouldResume = params.get('xingkong_helper_resume') === '1'
    if (!pairCode || !shouldAutoStart) return

    let cancelled = false
    const run = async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (cancelled) return
        try {
          await pairAgentHelper(pairCode)
          const status = await refreshAgentHelperStatus()
          if (!cancelled && isAgentHelperPaired(status)) {
            if (shouldResume) {
              switchMode('agent')
            } else {
              createNewConversation('agent', {
                workspaceName: getHelperWorkspaceName(status),
              })
            }
            toast.success(t('Helper paired'))
            params.delete('xingkong_helper_pair_code')
            params.delete('xingkong_helper_autostart')
            params.delete('xingkong_agent_mode')
            params.delete('xingkong_helper_resume')
            const nextQuery = params.toString()
            window.history.replaceState(
              null,
              '',
              `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`
            )
            return
          }
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 700))
        }
      }
      if (!cancelled) {
        setHelperPairCodeInput(pairCode)
        setIsHelperPairDialogOpen(true)
        toast.error(t('Failed to pair helper'))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [createNewConversation, refreshAgentHelperStatus, switchMode, t])

  const handleDownloadHelper = useCallback(async () => {
    const workspace = await ensureWorkspaceForHelper()
    if (!workspace) return

    const target = getAgentHelperDownloadTarget()
    setIsHelperDownloading(true)
    try {
      const fileName = await downloadAgentHelperToWorkspace(
        workspace,
        target,
        getCommonHeaders()
      )
      toast.success(
        t('Helper downloaded to workspace: {{fileName}}', { fileName })
      )
      setHelperManualCommand(buildAgentHelperManualCommand(fileName))
      toast.info(t('Helper downloaded. Start it from the helper menu.'))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to download helper')
      )
    } finally {
      setIsHelperDownloading(false)
    }
  }, [ensureWorkspaceForHelper, t])

  const handlePairHelper = useCallback(
    async (code: string) => {
      if (!code) return
      setIsHelperPairing(true)
      try {
        await pairAgentHelper(code)
        const status = await refreshAgentHelperStatus()
        setAgentHelperStatus(status)
        if (isAgentHelperPaired(status)) {
          toast.success(t('Helper paired'))
          setHelperPairCodeInput('')
          setHelperManualCommand('')
          setIsHelperPairDialogOpen(false)
        } else {
          toast.info(t('Helper is reachable but not paired yet'))
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t('Failed to pair helper')
        )
      } finally {
        setIsHelperPairing(false)
      }
    },
    [refreshAgentHelperStatus, t]
  )

  const handleStartHelper = useCallback(async () => {
    const target = getAgentHelperDownloadTarget()
    setHelperManualCommand(buildAgentHelperManualCommand(target.fileName))
    launchAgentHelperProtocol()

    window.setTimeout(async () => {
      const status = await refreshAgentHelperStatus()
      if (status) {
        if (isAgentHelperPaired(status)) return
        setIsHelperPairDialogOpen(true)
        return
      }
      setIsHelperPairDialogOpen(true)
      toast.info(
        t('Helper launch failed. Start helper manually and enter the pairing code.')
      )
    }, 2000)
  }, [refreshAgentHelperStatus, t])

  const handleCopyManualHelperCommand = useCallback(async () => {
    if (!helperManualCommand || !navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(helperManualCommand)
    toast.success(t('Command copied'))
  }, [helperManualCommand, t])

  return {
    agentHelperStatus,
    isHelperDownloading,
    isHelperPairing,
    isHelperPairDialogOpen,
    helperPairCodeInput,
    helperManualCommand,
    setIsHelperPairDialogOpen,
    setHelperPairCodeInput,
    handleDownloadHelper,
    handlePairHelper,
    handleStartHelper,
    handleCopyManualHelperCommand,
    refreshAgentHelperStatus,
  }
}
