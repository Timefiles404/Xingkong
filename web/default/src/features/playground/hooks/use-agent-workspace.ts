import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  isFileSystemAccessSupported,
  requestWorkspaceDirectory,
} from '../lib'
import type { PlaygroundConversation } from '../types'

interface UseAgentWorkspaceOptions {
  activeConversationId: string | null
  updateActiveConversationMeta: (
    updates: Partial<Pick<PlaygroundConversation, 'workspaceName'>>
  ) => void
}

export function useAgentWorkspace({
  activeConversationId,
  updateActiveConversationMeta,
}: UseAgentWorkspaceOptions) {
  const { t } = useTranslation()
  const [workspaceHandles, setWorkspaceHandles] = useState<
    Record<string, FileSystemDirectoryHandle>
  >({})

  const activeWorkspaceHandle = activeConversationId
    ? workspaceHandles[activeConversationId]
    : undefined

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

  return {
    activeWorkspaceHandle,
    pickWorkspace,
    ensureWorkspaceForHelper,
  }
}
