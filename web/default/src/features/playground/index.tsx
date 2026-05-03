import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CopyIcon, SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getCommonHeaders } from '@/lib/api'
import { getUserModels, getUserGroups } from './api'
import { PlaygroundHistorySidebar } from './components/playground-history-sidebar'
import { PlaygroundFileSidebar } from './components/playground-file-sidebar'
import { PlaygroundAgentSettingsDialog } from './components/playground-agent-settings-dialog'
import { PlaygroundChat } from './components/playground-chat'
import { PlaygroundInput } from './components/playground-input'
import { PlaygroundModeToolbar } from './components/playground-mode-toolbar'
import { DEFAULT_GROUP } from './constants'
import {
  useAgentHelperHistory,
  usePlaygroundState,
  useChatHandler,
} from './hooks'
import {
  buildModelVisibleAgentMessages,
  buildAgentPromptCacheKey,
  buildAgentResponsesPayload,
  buildAgentSummaryPrompt,
  buildAgentHelperManualCommand,
  buildAgentToolReviewResults,
  buildChatCompletionPayload,
  calculateAgentContextUsage,
  prepareAgentContextCompaction,
  checkAgentHelperStatus,
  createAgentContextEventMessage,
  createAgentSystemMessage,
  createUserMessage,
  createLoadingAssistantMessage,
  chargeExternalRequestFeeOnce,
  downloadAgentHelperToWorkspace,
  executeAgentToolCalls,
  externalEndpoint,
  finalizeMessage,
  formatAgentToolResults,
  getCompactionSourceCharCount,
  getAgentHelperDownloadTarget,
  getHelperWorkspaceName,
  isAgentHelperPaired,
  isOpenAIReasoningModel,
  isFileSystemAccessSupported,
  isWorkspaceMutatingToolCall,
  launchAgentHelperProtocol,
  pairAgentHelper,
  parseAgentToolCalls,
  requestAgentContextSummaryModel,
  requestWorkspaceDirectory,
  requiresAgentToolApproval,
  stripAgentToolBlocks,
  shouldUseOpenAICompatibleMode,
  streamAgentCompletion,
  streamExternalAgentChatCompletion,
  streamAgentResponsesCompletion,
} from './lib'
import type {
  AgentStreamControl,
  AgentHelperStatus,
  AgentToolRuntime,
  AgentToolCall,
  AgentToolResult,
} from './lib'
import type {
  AgentExternalProvider,
  AgentSettings,
  Message as MessageType,
  PlaygroundAttachment,
  PlaygroundMode,
  ResponsesOutputHistoryItem,
} from './types'

const MAX_AGENT_STEPS = 30

function hasAgentToolSyntax(content: string): boolean {
  return /<agent_tools\b/i.test(content) || /```agent_tools/i.test(content)
}

export function Playground() {
  const { t } = useTranslation()
  const {
    config,
    parameterEnabled,
    agentSettings,
    messages,
    mode,
    workspaceName,
    models,
    groups,
    conversations,
    activeConversationId,
    activeConversation,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateAgentSettings,
    createNewConversation,
    switchConversation,
    switchMode,
    deleteConversation,
    updateActiveConversationMeta,
    replaceModeConversations,
    setConversationPersistenceEnabled,
  } = usePlaygroundState()
  const [workspaceHandles, setWorkspaceHandles] = useState<
    Record<string, FileSystemDirectoryHandle>
  >({})
  const [agentHelperStatus, setAgentHelperStatus] =
    useState<AgentHelperStatus | null>(null)
  const [isHelperDownloading, setIsHelperDownloading] = useState(false)
  const [isHelperPairing, setIsHelperPairing] = useState(false)
  const [isHelperPairDialogOpen, setIsHelperPairDialogOpen] = useState(false)
  const [helperPairCodeInput, setHelperPairCodeInput] = useState('')
  const [helperManualCommand, setHelperManualCommand] = useState('')
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0)
  const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState(false)
  const helperStatusMissesRef = useRef(0)
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [isAgentCompacting, setIsAgentCompacting] = useState(false)
  const pendingAgentApprovalsRef = useRef<
    Map<string, (approved: boolean) => void>
  >(new Map())
  const agentStreamControlRef = useRef<AgentStreamControl>({
    source: null,
    retryTimer: null,
    stopped: false,
  })

  const activeWorkspaceHandle = activeConversationId
    ? workspaceHandles[activeConversationId]
    : undefined
  const isAgentMode = mode === 'agent'
  const isHelperConnected = isAgentHelperPaired(agentHelperStatus)
  const usableHelperStatus = isHelperConnected ? agentHelperStatus : null
  const helperHistoryKey =
    isAgentMode && usableHelperStatus ? usableHelperStatus.workspace : ''
  const activeWorkspaceName =
    workspaceName ||
    activeWorkspaceHandle?.name ||
    (usableHelperStatus ? getHelperWorkspaceName(usableHelperStatus) : '')
  const activeAgentRuntime: AgentToolRuntime = usableHelperStatus
    ? { helper: usableHelperStatus }
    : { root: activeWorkspaceHandle }
  const visibleConversations = conversations.filter(
    (conversation) => (conversation.mode || 'chat') === mode
  )
  const activeExternalProvider =
    agentSettings.externalProviders.find(
      (provider) => provider.id === agentSettings.activeExternalProviderId
    ) || agentSettings.externalProviders[0]
  const agentUsesExternalProvider =
    isAgentMode && agentSettings.providerKind === 'external' && !!activeExternalProvider
  const agentChannelOptions = [
    { label: t('内置渠道'), value: 'builtin', ratio: 1 },
    ...agentSettings.externalProviders.map((provider) => ({
      label: provider.name || t('外置渠道'),
      value: provider.id,
      ratio: 1,
      desc: provider.endpointType === 'responses' ? 'Responses' : 'Chat Completions',
    })),
  ]
  const activeAgentChannelValue = agentUsesExternalProvider
    ? activeExternalProvider.id
    : 'builtin'
  const activeAgentModels =
    agentUsesExternalProvider && activeExternalProvider.models.length > 0
      ? activeExternalProvider.models
      : models
  const activeAgentModelValue = agentUsesExternalProvider
    ? activeExternalProvider.selectedModel || activeExternalProvider.models[0]?.value || ''
    : config.model
  const contextUsage = calculateAgentContextUsage(
    buildModelVisibleAgentMessages(
      activeConversation,
      messages,
      agentSettings.context
    ),
    agentSettings.context
  )

  useAgentHelperHistory({
    isAgentMode,
    helperHistoryKey,
    conversations,
    activeConversationId,
    agentSettings,
    replaceModeConversations,
    updateAgentSettings,
    setConversationPersistenceEnabled,
  })

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
  })
  const isBusy = isGenerating || isAgentRunning || isAgentCompacting

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

  // Edit dialog state
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  useEffect(() => {
    setEditingMessageKey(null)
  }, [activeConversationId])

  // Load models
  const { data: modelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['playground-models'],
    queryFn: getUserModels,
  })

  // Load groups
  const { data: groupsData } = useQuery({
    queryKey: ['playground-groups'],
    queryFn: getUserGroups,
  })

  // Update models when data changes
  useEffect(() => {
    if (!modelsData) return

    setModels(modelsData)

    // Set default model if current model is not available
    const isCurrentModelValid = modelsData.some((m) => m.value === config.model)
    if (modelsData.length > 0 && !isCurrentModelValid) {
      updateConfig('model', modelsData[0].value)
    }
  }, [modelsData, config.model, setModels, updateConfig])

  // Update groups when data changes
  useEffect(() => {
    if (!groupsData) return

    const processedGroups = groupsData.filter((group) => group.value !== 'auto')

    setGroups(processedGroups)

    const isCurrentGroupValid = processedGroups.some(
      (group) => group.value === config.group
    )
    if (!isCurrentGroupValid) {
      updateConfig('group', processedGroups[0]?.value || DEFAULT_GROUP)
    }
  }, [groupsData, config.group, setGroups, updateConfig])

  const pickWorkspace = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      toast.error(t('This browser does not support local folder access'))
      return null
    }

    if (!activeConversationId) return null

    try {
      const handle = await requestWorkspaceDirectory()
      setWorkspaceHandles((prev) => ({
        ...prev,
        [activeConversationId]: handle,
      }))
      updateActiveConversationMeta({ workspaceName: handle.name })
      toast.success(t('Workspace selected'))
      return handle
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null
      }
      toast.error(t('Failed to select workspace'))
      return null
    }
  }, [activeConversationId, t, updateActiveConversationMeta])

  const ensureWorkspaceForHelper = useCallback(async () => {
    let workspace = activeWorkspaceHandle
    if (!workspace) {
      workspace = await pickWorkspace()
    }
    return workspace || null
  }, [activeWorkspaceHandle, pickWorkspace])

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

  const handleModeChange = useCallback(
    (nextMode: PlaygroundMode) => {
      if (isBusy || mode === nextMode) return
      switchMode(nextMode)
    },
    [isBusy, mode, switchMode]
  )

  const handleApproveAgentToolCalls = useCallback(
    (approvalId: string, approved: boolean) => {
      const resolver = pendingAgentApprovalsRef.current.get(approvalId)
      if (!resolver) return
      pendingAgentApprovalsRef.current.delete(approvalId)
      resolver(approved)

      updateMessages((prev) =>
        prev.map((message) =>
          message.agentToolApprovalId === approvalId
            ? {
                ...message,
                agentToolApprovalId: undefined,
                agentToolResults: (message.agentToolResults || []).map(
                  (result) => ({
                    ...result,
                    status: approved
                      ? 'running'
                      : result.requiresApproval
                        ? 'denied'
                        : 'running',
                    ok: approved || !result.requiresApproval,
                    summary: approved || !result.requiresApproval
                      ? t('Running')
                      : t('Permission denied'),
                    error:
                      approved || !result.requiresApproval
                        ? undefined
                        : 'permission_denied',
                  })
                ),
              }
            : message
        )
      )
    },
    [t, updateMessages]
  )

  const stopAgentGeneration = useCallback(() => {
    const control = agentStreamControlRef.current
    control.stopped = true
    if (control.retryTimer) {
      clearTimeout(control.retryTimer)
      control.retryTimer = null
    }
    control.source?.close()
    control.source = null
    pendingAgentApprovalsRef.current.forEach((resolve) => resolve(false))
    pendingAgentApprovalsRef.current.clear()
    setIsAgentRunning(false)

    updateMessages((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      if (last.from !== 'assistant') return prev
      if (last.status !== 'loading' && last.status !== 'streaming') return prev

      const content = last.versions[0]?.content?.trim()
      const next = [...prev]
      next[next.length - 1] = {
        ...finalizeMessage({
          ...last,
          versions: [
            {
              ...last.versions[0],
              content: content || t('Generation was interrupted'),
            },
          ],
        }),
        status: 'complete',
        errorCode: null,
      }
      return next
    })
  }, [t, updateMessages])

  const requestToolApproval = useCallback(
    (
      calls: AgentToolCall[],
      workingMessages: MessageType[],
      reviewResults: AgentToolResult[]
    ): {
      approvalMessage: MessageType
      promise: Promise<boolean>
    } => {
      const approvalId =
        globalThis.crypto?.randomUUID?.() || `tool-approval-${Date.now()}`
      const approvalMessage: MessageType = {
        ...createUserMessage(''),
        isAgentToolResult: true,
        agentToolApprovalId: approvalId,
        agentToolResults: calls.map((call, index) => ({
          ...reviewResults[index],
          id: call.id,
          tool: call.tool,
          path: call.path || '.',
          ok: false,
          status: 'pending',
          requiresApproval: requiresAgentToolApproval(call),
          summary:
            reviewResults[index]?.summary ||
            (requiresAgentToolApproval(call)
              ? t('Waiting for permission')
              : t('Ready to run')),
        })),
      }

      const promise = new Promise<boolean>((resolve) => {
        pendingAgentApprovalsRef.current.set(approvalId, resolve)
      })
      updateMessages([...workingMessages, approvalMessage])
      return { approvalMessage, promise }
    },
    [t, updateMessages]
  )

  const executeToolCallsWithApproval = useCallback(
    async (
      runtime: AgentToolRuntime,
      calls: AgentToolCall[],
      workingMessages: MessageType[]
    ): Promise<{ results: AgentToolResult[]; messages: MessageType[] }> => {
      const needsApproval = calls.some(requiresAgentToolApproval)
      const createToolMessage = (
        status: 'pending' | 'running' | 'denied' | 'complete',
        results?: AgentToolResult[]
      ): MessageType => {
        const displayResults = results
          ? results.map((result) => ({
              ...result,
              status: 'complete' as const,
            }))
          : calls.map((call) => {
              const requiresApproval = requiresAgentToolApproval(call)
              const denied = status === 'denied' && requiresApproval
              return {
                id: call.id,
                tool: call.tool,
                path: call.path || '.',
                ok: !denied,
                status: denied ? ('denied' as const) : status,
                requiresApproval,
                summary: denied
                  ? t('Permission denied')
                  : status === 'pending'
                    ? requiresApproval
                      ? t('Waiting for permission')
                      : t('Ready to run')
                    : t('Running'),
                error: denied ? 'permission_denied' : undefined,
              }
            })

        return {
          ...createUserMessage(results ? formatAgentToolResults(results) : ''),
          isAgentToolResult: true,
          agentToolResults: displayResults,
        }
      }

      if (!needsApproval) {
        const runningMessage = createToolMessage('running')
        updateMessages([...workingMessages, runningMessage])
        const results = await executeAgentToolCalls(runtime, calls)
        if (calls.some(isWorkspaceMutatingToolCall)) {
          setWorkspaceRefreshKey((value) => value + 1)
        }
        return {
          results,
          messages: [...workingMessages, createToolMessage('complete', results)],
        }
      }

      const reviewResults = await buildAgentToolReviewResults(runtime, calls)
      const { approvalMessage, promise } = requestToolApproval(
        calls,
        workingMessages,
        reviewResults
      )
      const approved = await promise

      if (approved) {
        const runningMessage = {
          ...createToolMessage('running'),
          key: approvalMessage.key,
        }
        updateMessages([...workingMessages, runningMessage])
        const results = await executeAgentToolCalls(runtime, calls)
        if (calls.some(isWorkspaceMutatingToolCall)) {
          setWorkspaceRefreshKey((value) => value + 1)
        }
        const completedMessage = {
          ...createToolMessage('complete', results),
          key: approvalMessage.key,
        }
        return {
          results,
          messages: [...workingMessages, completedMessage],
        }
      }

      const safeCalls = calls.filter((call) => !requiresAgentToolApproval(call))
      const deniedResults: AgentToolResult[] = calls
        .filter(requiresAgentToolApproval)
        .map((call) => ({
          id: call.id,
          tool: call.tool,
          path: call.path || '.',
          ok: false,
          summary: t('Permission denied'),
          error: 'permission_denied',
        }))
      const deniedMessage = {
        ...createToolMessage('denied'),
        key: approvalMessage.key,
      }
      updateMessages([...workingMessages, deniedMessage])
      const results =
        safeCalls.length > 0
          ? [
              ...(await executeAgentToolCalls(runtime, safeCalls)),
              ...deniedResults,
            ]
          : deniedResults
      if (safeCalls.some(isWorkspaceMutatingToolCall)) {
        setWorkspaceRefreshKey((value) => value + 1)
      }
      const completedMessage = {
        ...createToolMessage('complete', results),
        key: approvalMessage.key,
      }

      return {
        results,
        messages: [...workingMessages, completedMessage],
      }
    },
    [requestToolApproval, t, updateMessages]
  )

  const compactAgentMessages = useCallback(
    async ({
      currentConversation,
      currentMessages,
      currentAgentSettings,
      runtimeWorkspaceName,
      force = false,
      showStatus = true,
    }: {
      currentConversation: typeof activeConversation
      currentMessages: MessageType[]
      currentAgentSettings: AgentSettings
      runtimeWorkspaceName: string
      force?: boolean
      showStatus?: boolean
    }): Promise<{
      changed: boolean
      messages: MessageType[]
      summary?: string
      compactedBeforeKey?: string
      usage: ReturnType<typeof calculateAgentContextUsage>
    }> => {
      const plan = prepareAgentContextCompaction(
        currentConversation,
        currentMessages,
        currentAgentSettings.context,
        runtimeWorkspaceName,
        force
      )
      if (!plan.changed) {
        updateActiveConversationMeta({ agentContextUsage: plan.usage })
        return { changed: false, messages: currentMessages, usage: plan.usage }
      }

      let nextMessages = currentMessages
      let statusMessageKey: string | null = null
      if (showStatus) {
        const statusMessage = createAgentContextEventMessage(
          t('正在压缩上下文...'),
          'loading'
        )
        statusMessageKey = statusMessage.key
        nextMessages = [...nextMessages, statusMessage]
        updateMessages(nextMessages)
      }

      setIsAgentCompacting(true)
      let summary = plan.localSummary || ''
      let usedFallback = false
      const beforeChars = getCompactionSourceCharCount(
        plan.previousSummary,
        plan.compactedMessages
      )
      try {
        const prompt = buildAgentSummaryPrompt(
          plan.previousSummary,
          plan.compactedMessages,
          runtimeWorkspaceName
        )
        summary = await requestAgentContextSummaryModel(
          prompt,
          currentAgentSettings,
          config,
          currentAgentSettings.externalProviders
        )
      } catch (error) {
        usedFallback = true
        toast.warning(t('摘要模型压缩失败，已使用本地摘要兜底'), {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setIsAgentCompacting(false)
      }

      const usage = calculateAgentContextUsage(
        plan.tailMessages,
        currentAgentSettings.context,
        summary.length ? Math.ceil(summary.length / 4) : 0
      )
      const afterChars = summary.length
      const divider = createAgentContextEventMessage(
        usedFallback ? t('上下文已压缩，本轮使用本地兜底摘要') : t('上下文已压缩'),
        'complete',
        t('从 {{before}} 字符 -> {{after}} 字符', {
          before: beforeChars.toLocaleString(),
          after: afterChars.toLocaleString(),
        })
      )
      nextMessages = statusMessageKey
        ? nextMessages.map((message) =>
            message.key === statusMessageKey ? divider : message
          )
        : [...nextMessages, divider]

      updateMessages(nextMessages)
      updateActiveConversationMeta({
        agentContextSummary: summary,
        agentContextSummaryUpdatedAt: Date.now(),
        agentContextCompactedBeforeKey: plan.compactedBeforeKey,
        agentContextUsage: usage,
      })

      return {
        changed: true,
        messages: nextMessages,
        summary,
        compactedBeforeKey: plan.compactedBeforeKey,
        usage,
      }
    },
    [config, t, updateActiveConversationMeta, updateMessages]
  )

  const runAgentConversation = useCallback(
    async (
      initialMessages: MessageType[],
      runtime: AgentToolRuntime,
      runtimeWorkspaceName: string,
      conversationId: string | null,
      externalProvider: AgentExternalProvider | null,
      currentAgentSettings: AgentSettings,
      currentConversation = activeConversation
    ) => {
      const control = agentStreamControlRef.current
      control.stopped = false
      if (control.retryTimer) {
        clearTimeout(control.retryTimer)
        control.retryTimer = null
      }
      control.source?.close()
      control.source = null
      setIsAgentRunning(true)

      let workingMessages = initialMessages
      let contextConversation = currentConversation
      const useExternalResponses =
        !!externalProvider && externalProvider.endpointType === 'responses'
      const useNativeResponses =
        !externalProvider &&
        isOpenAIReasoningModel(config.model) &&
        !shouldUseOpenAICompatibleMode(config)

      try {
        for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
          const updateLastAssistantContent = (
            content: string,
            status: 'loading' | 'streaming' = 'streaming',
            errorCode: string | null = null
          ) => {
            workingMessages = workingMessages.map((message, index) => {
              if (index !== workingMessages.length - 1) return message
              return {
                ...message,
                versions: [
                  {
                    ...message.versions[0],
                    content,
                  },
                ],
                status,
                errorCode,
              }
            })
            updateMessages(workingMessages)
          }

          let rawContent = ''
          let nativeToolCalls: AgentToolCall[] = []
          let nativeOutputItems: ResponsesOutputHistoryItem[] = []
          const handleReconnect = (
            error: string,
            attempt: number,
            maxAttempts: number
          ) => {
            updateLastAssistantContent(
              t('{{error}}，正在重连（{{attempt}}/{{max}}）...', {
                error,
                attempt,
                max: maxAttempts,
              }),
              'loading',
              'reconnecting'
            )
          }

          const visibleModelMessages = buildModelVisibleAgentMessages(
            contextConversation,
            workingMessages,
            currentAgentSettings.context
          )

          if (useNativeResponses || useExternalResponses) {
            const payload = buildAgentResponsesPayload(
              visibleModelMessages,
              {
                ...config,
                model:
                  externalProvider?.selectedModel ||
                  externalProvider?.models[0]?.value ||
                  config.model,
                openaiRequestMode: externalProvider
                  ? 'compatible'
                  : config.openaiRequestMode,
                stream: true,
              },
              parameterEnabled,
              runtimeWorkspaceName,
              conversationId,
              usableHelperStatus,
              currentAgentSettings.context.systemPrompt
            )
            if (useExternalResponses) {
              delete payload.group
              delete payload.prompt_cache_key
            }
            if (payload.input.length === 0) {
              throw new Error('responses_input_empty')
            }
            const result = await streamAgentResponsesCompletion(
              payload,
              (content) => updateLastAssistantContent(content, 'streaming', null),
              handleReconnect,
              control,
              useExternalResponses && externalProvider
                ? {
                    endpoint: externalEndpoint(externalProvider.baseUrl, '/responses'),
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${externalProvider.apiKey}`,
                    },
                    chargeBeforeRequest: chargeExternalRequestFeeOnce,
                  }
                : {}
            )
            rawContent = result.rawContent
            nativeToolCalls = result.nativeToolCalls
            nativeOutputItems = result.nativeOutputItems
          } else {
            const payload = buildChatCompletionPayload(
              [
                createAgentSystemMessage(
                  runtimeWorkspaceName,
                  usableHelperStatus,
                  currentAgentSettings.context.systemPrompt
                ),
                ...visibleModelMessages,
              ],
              {
                ...config,
                model:
                  externalProvider?.selectedModel ||
                  externalProvider?.models[0]?.value ||
                  config.model,
                stream: true,
              },
              parameterEnabled,
              {
                promptCacheKey: externalProvider
                  ? undefined
                  : buildAgentPromptCacheKey(conversationId),
              }
            )
            rawContent = externalProvider
              ? await streamExternalAgentChatCompletion(
                  externalProvider,
                  payload,
                  (content) => updateLastAssistantContent(content, 'streaming', null),
                  handleReconnect,
                  control
                )
              : await streamAgentCompletion(
                  payload,
                  (content) => updateLastAssistantContent(content, 'streaming', null),
                  handleReconnect,
                  control
                )
          }

          if (control.stopped) return
          const visibleContent = stripAgentToolBlocks(rawContent)
          const toolCalls = useNativeResponses || useExternalResponses
            ? nativeToolCalls
            : parseAgentToolCalls(rawContent)
          if (hasAgentToolSyntax(rawContent) && toolCalls.length === 0) {
            throw new Error(
              `工具调用格式不完整或无法解析：${rawContent.slice(0, 600)}`
            )
          }

          workingMessages = workingMessages.map((message, index) => {
            if (index !== workingMessages.length - 1) return message
            return {
              ...finalizeMessage({
                ...message,
                apiContent: toolCalls.length > 0 ? rawContent : undefined,
                agentResponsesOutputItems:
                  (useNativeResponses || useExternalResponses) &&
                  nativeOutputItems.length > 0
                    ? nativeOutputItems
                    : undefined,
                versions: [
                  {
                    ...message.versions[0],
                    content: visibleContent,
                  },
                ],
              }),
              status: 'complete',
            }
          })
          updateMessages(workingMessages)

          if (toolCalls.length === 0) {
            const compaction = await compactAgentMessages({
              currentConversation: contextConversation,
              currentMessages: workingMessages,
              currentAgentSettings,
              runtimeWorkspaceName,
            })
            workingMessages = compaction.messages
            if (compaction.changed) {
              contextConversation = contextConversation
                ? {
                    ...contextConversation,
                    agentContextSummary: compaction.summary,
                    agentContextSummaryUpdatedAt: Date.now(),
                    agentContextCompactedBeforeKey:
                      compaction.compactedBeforeKey,
                    agentContextUsage: compaction.usage,
                  }
                : contextConversation
            }
            return
          }

          const toolExecution = await executeToolCallsWithApproval(
            runtime,
            toolCalls,
            workingMessages
          )
          workingMessages = toolExecution.messages
          updateMessages(workingMessages)
          const nextAssistantMessage = createLoadingAssistantMessage()
          workingMessages = [...workingMessages, nextAssistantMessage]
          updateMessages(workingMessages)
        }

        workingMessages = workingMessages.map((message, index) => {
          if (index !== workingMessages.length - 1) return message
          return {
            ...message,
            versions: [
              {
                ...message.versions[0],
                content: t('Agent stopped after reaching the tool step limit'),
              },
            ],
            status: 'complete',
          }
        })
        updateMessages(workingMessages)
      } catch (error) {
        if (agentStreamControlRef.current.stopped) return
        const message =
          error instanceof Error ? error.message : t('Agent request failed')
        toast.error(message)
        workingMessages = workingMessages.map((item, index) => {
          if (index !== workingMessages.length - 1) return item
          return {
            ...item,
            versions: [
              {
                ...item.versions[0],
                content: `${t('Agent request failed')}: ${message}`,
              },
            ],
            status: 'error',
            errorCode: 'agent_error',
          }
        })
        updateMessages(workingMessages)
      } finally {
        if (!agentStreamControlRef.current.stopped) {
          agentStreamControlRef.current.source?.close()
          agentStreamControlRef.current.source = null
          if (agentStreamControlRef.current.retryTimer) {
            clearTimeout(agentStreamControlRef.current.retryTimer)
            agentStreamControlRef.current.retryTimer = null
          }
          setIsAgentRunning(false)
        }
      }
    },
    [
      config,
      compactAgentMessages,
      executeToolCallsWithApproval,
      usableHelperStatus,
      parameterEnabled,
      t,
      activeConversation,
      updateActiveConversationMeta,
      updateMessages,
    ]
  )

  const handleSendMessage = async (
    text: string,
    attachments: PlaygroundAttachment[] = []
  ) => {
    if (isAgentMode) {
      let runtime = activeAgentRuntime
      let runtimeWorkspaceName = activeWorkspaceName
      if (!usableHelperStatus && !runtime.root) {
        let workspace = activeWorkspaceHandle
        workspace = await pickWorkspace()
        if (!workspace) return
        runtime = { root: workspace }
        runtimeWorkspaceName = workspace.name
      }
      if (isAgentRunning) return
      if (agentUsesExternalProvider && !activeAgentModelValue) {
        toast.error(t('请先在 Agent 设置中拉取并选择外置渠道模型'))
        return
      }

      updateActiveConversationMeta({ workspaceName: runtimeWorkspaceName })
      const userMessage = createUserMessage(text, attachments)
      const assistantMessage = createLoadingAssistantMessage()
      const newMessages = [...messages, userMessage, assistantMessage]
      const conversationId = activeConversationId
      updateMessages(newMessages)
      void runAgentConversation(
        newMessages,
        runtime,
        runtimeWorkspaceName,
        conversationId,
        agentUsesExternalProvider ? activeExternalProvider : null,
        agentSettings,
        activeConversation
      )
      return
    }

    const userMessage = createUserMessage(text, attachments)
    const assistantMessage = createLoadingAssistantMessage()

    const newMessages = [...messages, userMessage, assistantMessage]
    updateMessages(newMessages)

    // Send chat request
    sendChat(newMessages)
  }

  const handleCompactContextNow = () => {
    if (!isAgentMode || isBusy) return
    void compactAgentMessages({
      currentConversation: activeConversation,
      currentMessages: messages,
      currentAgentSettings: agentSettings,
      runtimeWorkspaceName: activeWorkspaceName,
      force: true,
      showStatus: true,
    }).then((result) => {
      if (!result.changed) {
        toast.info(t('当前上下文暂时没有可压缩的旧内容'))
      }
    })
  }

  const handleCopyMessage = (message: MessageType) => {
    // Copy is handled in MessageActions component
    // eslint-disable-next-line no-console
    console.log('Message copied:', message.key)
  }

  const handleRegenerateMessage = (message: MessageType) => {
    // Find the message index and regenerate from there
    const messageIndex = messages.findIndex((m) => m.key === message.key)
    if (messageIndex === -1) return

    // Remove messages after this one and regenerate
    const messagesUpToHere = messages.slice(0, messageIndex)
    const loadingMessage = createLoadingAssistantMessage()
    const newMessages = [...messagesUpToHere, loadingMessage]

    updateMessages(newMessages)
    sendChat(newMessages)
  }

  const handleEditMessage = useCallback((message: MessageType) => {
    setEditingMessageKey(message.key)
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) setEditingMessageKey(null)
  }, [])

  // Apply edit and optionally re-submit from the edited user message
  const applyEdit = useCallback(
    (newContent: string, submit: boolean) => {
      if (!editingMessageKey) return
      const index = messages.findIndex((m) => m.key === editingMessageKey)
      if (index === -1) return

      const updated = messages.map((m) =>
        m.key === editingMessageKey
          ? { ...m, versions: [{ ...m.versions[0], content: newContent }] }
          : m
      )

      setEditingMessageKey(null)

      if (!submit || updated[index].from !== 'user') {
        updateMessages(updated)
        return
      }

      const toSubmit = [
        ...updated.slice(0, index + 1),
        createLoadingAssistantMessage(),
      ]
      updateMessages(toSubmit)
      sendChat(toSubmit)
    },
    [editingMessageKey, messages, updateMessages, sendChat]
  )

  const handleDeleteMessage = (message: MessageType) => {
    const newMessages = messages.filter((m) => m.key !== message.key)
    updateMessages(newMessages)
  }

  const handleAgentChannelChange = (value: string) => {
    if (!isAgentMode || value === 'builtin') {
      updateAgentSettings((prev) => ({
        ...prev,
        providerKind: 'builtin',
        activeExternalProviderId: undefined,
      }))
      return
    }
    updateAgentSettings((prev) => ({
      ...prev,
      providerKind: 'external',
      activeExternalProviderId: value,
    }))
  }

  const handleAgentModelChange = (value: string) => {
    if (!agentUsesExternalProvider || !activeExternalProvider) {
      updateConfig('model', value)
      return
    }
    updateAgentSettings((prev) => ({
      ...prev,
      externalProviders: prev.externalProviders.map((provider) =>
        provider.id === activeExternalProvider.id
          ? { ...provider, selectedModel: value }
          : provider
      ),
    }))
  }

  return (
    <div
      className='relative flex size-full flex-col overflow-hidden'
      style={
        isAgentMode
          ? {
              fontSize: `${agentSettings.context.fontSize}px`,
              fontFamily: agentSettings.context.fontFamily || undefined,
            }
          : undefined
      }
    >
      <PlaygroundHistorySidebar
        activeConversationId={activeConversationId}
        conversations={visibleConversations}
        isGenerating={isBusy}
        onCreateConversation={() => createNewConversation(mode)}
        onDeleteConversation={deleteConversation}
        onSelectConversation={switchConversation}
      />
      {isAgentMode && (
        <PlaygroundFileSidebar
          disabled={isBusy}
          helperStatus={usableHelperStatus}
          refreshKey={workspaceRefreshKey}
          root={activeWorkspaceHandle}
          workspaceName={activeWorkspaceName}
        />
      )}

      {/* Full-width scroll container: scrolling works even over side whitespace */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        <PlaygroundModeToolbar
          activeWorkspaceName={activeWorkspaceName}
          hasBrowserWorkspace={!!activeWorkspaceHandle}
          helperStatus={agentHelperStatus}
          isBusy={isBusy}
          isHelperConnected={isHelperConnected}
          isHelperDownloading={isHelperDownloading}
          isHelperPairing={isHelperPairing}
          mode={mode}
          onDownloadHelper={() => void handleDownloadHelper()}
          onModeChange={handleModeChange}
          onOpenPairDialog={() => setIsHelperPairDialogOpen(true)}
          onPickWorkspace={() => void pickWorkspace()}
          onStartHelper={() => void handleStartHelper()}
        />

        <PlaygroundChat
          messages={messages}
          onCopyMessage={handleCopyMessage}
          onRegenerateMessage={handleRegenerateMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onApproveAgentToolCalls={handleApproveAgentToolCalls}
          isGenerating={isBusy}
          editingKey={editingMessageKey}
          onCancelEdit={handleEditOpenChange}
          onSaveEdit={(newContent) => applyEdit(newContent, false)}
          onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
        />
      </div>

      {/* Input area: center content and constrain to the same container width */}
      <div className='mx-auto w-full max-w-4xl'>
        <PlaygroundInput
          disabled={isBusy}
          groups={isAgentMode ? agentChannelOptions : groups}
          groupValue={isAgentMode ? activeAgentChannelValue : config.group}
          groupLabel={isAgentMode ? t('渠道') : undefined}
          contextUsage={isAgentMode ? contextUsage : undefined}
          canCompactContext={isAgentMode && !isBusy}
          isCompactingContext={isAgentCompacting}
          isGenerating={isBusy}
          isModelLoading={isLoadingModels}
          modelValue={isAgentMode ? activeAgentModelValue : config.model}
          models={isAgentMode ? activeAgentModels : models}
          onGroupChange={(value) =>
            isAgentMode ? handleAgentChannelChange(value) : updateConfig('group', value)
          }
          onModelChange={(value) =>
            isAgentMode ? handleAgentModelChange(value) : updateConfig('model', value)
          }
          reasoningEffort={config.openaiReasoningEffort}
          onReasoningEffortChange={(value) =>
            updateConfig('openaiReasoningEffort', value)
          }
          requestMode={config.openaiRequestMode}
          onRequestModeChange={(value) => {
            updateConfig('openaiRequestMode', value)
            updateConfig('openaiFastMode', value === 'fast')
          }}
          onStop={isAgentMode ? stopAgentGeneration : stopGeneration}
          onCompactContextNow={handleCompactContextNow}
          onSubmit={handleSendMessage}
          agentMode={isAgentMode}
        />
      </div>

      {isAgentMode && (
        <Button
          className='absolute right-4 bottom-28 z-30 rounded-full shadow-sm'
          onClick={() => setIsAgentSettingsOpen(true)}
          size='icon'
          type='button'
          variant='outline'
        >
          <SettingsIcon className='size-4' />
          <span className='sr-only'>{t('Agent 设置')}</span>
        </Button>
      )}

      <PlaygroundAgentSettingsDialog
        open={isAgentSettingsOpen}
        onOpenChange={setIsAgentSettingsOpen}
        settings={agentSettings}
        onSettingsChange={updateAgentSettings}
        builtinModels={models}
      />

      <Dialog
        open={isHelperPairDialogOpen && !isHelperConnected}
        onOpenChange={setIsHelperPairDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Pair local helper')}</DialogTitle>
            <DialogDescription>
              {t(
                'Enter the pairing code printed in the local helper window. The web page never generates this code.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <Input
              autoFocus
              inputMode='numeric'
              maxLength={16}
              onChange={(event) =>
                setHelperPairCodeInput(event.target.value.replace(/\s+/g, ''))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handlePairHelper(helperPairCodeInput)
                }
              }}
              placeholder={t('Helper pairing code')}
              value={helperPairCodeInput}
            />
            {helperManualCommand && (
              <button
                className='text-muted-foreground flex min-w-0 items-center gap-2 text-left text-xs hover:text-foreground'
                onClick={() => void handleCopyManualHelperCommand()}
                type='button'
              >
                <CopyIcon className='size-3.5 shrink-0' />
                <span className='truncate'>
                  {t('Manual start command')}: {helperManualCommand}
                </span>
              </button>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setIsHelperPairDialogOpen(false)}
              type='button'
              variant='outline'
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={isHelperPairing || !helperPairCodeInput.trim()}
              onClick={() => void handlePairHelper(helperPairCodeInput)}
              type='button'
            >
              {isHelperPairing ? t('Pairing helper') : t('Pair helper')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
