import { useState, useCallback } from 'react'
import { nanoid } from 'nanoid'
import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import {
  loadConfig,
  saveConfig,
  loadParameterEnabled,
  saveParameterEnabled,
  loadConversations,
  saveConversations,
} from '../lib'
import type {
  Message,
  PlaygroundConfig,
  ParameterEnabled,
  ModelOption,
  GroupOption,
  PlaygroundConversation,
  PlaygroundMode,
} from '../types'

function getConversationTitle(messages: Message[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => {
      if (message.from !== 'user') return false
      if (message.isAgentToolResult) return false
      const content = message.versions?.[0]?.content || ''
      return !/<agent_tool_results\b/i.test(content)
    })
  const text = lastUserMessage?.versions?.[0]?.content?.replace(/\s+/g, ' ').trim()
  if (text) {
    return text.length > 28 ? `${text.slice(0, 28)}...` : text
  }

  const lastAttachment = lastUserMessage?.attachments?.[0]?.name
  if (lastAttachment) {
    return lastAttachment
  }

  return 'New conversation'
}

function createConversation(
  messages: Message[] = [],
  mode: PlaygroundMode = 'chat'
): PlaygroundConversation {
  const now = Date.now()
  return {
    id: nanoid(),
    title: getConversationTitle(messages),
    createdAt: now,
    updatedAt: now,
    mode,
    messages,
  }
}

/**
 * Main state management hook for playground
 */
export function usePlaygroundState() {
  // Load initial state from localStorage
  const [config, setConfig] = useState<PlaygroundConfig>(() => {
    const savedConfig = loadConfig()
    return { ...DEFAULT_CONFIG, ...savedConfig }
  })

  const [parameterEnabled, setParameterEnabled] = useState<ParameterEnabled>(
    () => {
      const saved = loadParameterEnabled()
      return { ...DEFAULT_PARAMETER_ENABLED, ...saved }
    }
  )

  const [conversationState, setConversationState] = useState(() => {
    const loaded = loadConversations()
    if (loaded.conversations.length > 0 && loaded.activeConversationId) {
      return loaded
    }

    const initialConversation = createConversation()
    return {
      conversations: [initialConversation],
      activeConversationId: initialConversation.id,
      activeConversationIds: {
        chat: initialConversation.id,
        agent: null,
      },
    }
  })

  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  const { conversations, activeConversationId } = conversationState
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ||
    conversations[0]
  const messages = activeConversation?.messages || []
  const mode = activeConversation?.mode || 'chat'
  const workspaceName = activeConversation?.workspaceName || ''

  const persistConversationState = useCallback(
    (
      nextConversations: PlaygroundConversation[],
      nextActiveConversationId: string | null,
      nextActiveConversationIds?: Record<PlaygroundMode, string | null>
    ) => {
      const activeConversationIds =
        nextActiveConversationIds || conversationState.activeConversationIds
      saveConversations(
        nextConversations,
        nextActiveConversationId,
        activeConversationIds
      )
      return {
        conversations: nextConversations,
        activeConversationId: nextActiveConversationId,
        activeConversationIds,
      }
    },
    [conversationState.activeConversationIds]
  )

  // Update config with automatic save
  const updateConfig = useCallback(
    <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
      setConfig((prev) => {
        const updated = { ...prev, [key]: value }
        saveConfig(updated)
        return updated
      })
    },
    []
  )

  // Update parameter enabled with automatic save
  const updateParameterEnabled = useCallback(
    (key: keyof ParameterEnabled, value: boolean) => {
      setParameterEnabled((prev) => {
        const updated = { ...prev, [key]: value }
        saveParameterEnabled(updated)
        return updated
      })
    },
    []
  )

  // Update messages with automatic save
  const updateMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      setConversationState((prevState) => {
        const currentId =
          prevState.activeConversationId || prevState.conversations[0]?.id || null
        const now = Date.now()
        const nextConversations = prevState.conversations.map((conversation) => {
          if (conversation.id !== currentId) return conversation

          const newMessages =
            typeof updater === 'function'
              ? updater(conversation.messages)
              : updater

          return {
            ...conversation,
            messages: newMessages,
            title: getConversationTitle(newMessages),
            updatedAt: now,
          }
        })

        return persistConversationState(
          nextConversations,
          currentId,
          prevState.activeConversationIds
        )
      })
    },
    [persistConversationState]
  )

  // Clear all messages
  const clearMessages = useCallback(() => {
    updateMessages([])
  }, [updateMessages])

  const createNewConversation = useCallback((mode: PlaygroundMode = 'chat') => {
    setConversationState((prevState) => {
      const conversation = createConversation([], mode)
      const nextConversations = [conversation, ...prevState.conversations]
      return persistConversationState(nextConversations, conversation.id, {
        ...prevState.activeConversationIds,
        [mode]: conversation.id,
      })
    })
  }, [persistConversationState])

  const switchConversation = useCallback(
    (conversationId: string) => {
      setConversationState((prevState) => {
        if (!prevState.conversations.some((item) => item.id === conversationId)) {
          return prevState
        }
        const conversation = prevState.conversations.find(
          (item) => item.id === conversationId
        )
        const nextMode = conversation?.mode || 'chat'
        return persistConversationState(prevState.conversations, conversationId, {
          ...prevState.activeConversationIds,
          [nextMode]: conversationId,
        })
      })
    },
    [persistConversationState]
  )

  const deleteConversation = useCallback(
    (conversationId: string) => {
      setConversationState((prevState) => {
        const remaining = prevState.conversations.filter(
          (conversation) => conversation.id !== conversationId
        )
        if (remaining.length === 0) {
          const replacement = createConversation()
          return persistConversationState([replacement], replacement.id, {
            chat: replacement.id,
            agent: null,
          })
        }

        const deleted = prevState.conversations.find(
          (conversation) => conversation.id === conversationId
        )
        const deletedMode = deleted?.mode || 'chat'
        const sameModeRemaining = remaining.filter(
          (conversation) => (conversation.mode || 'chat') === deletedMode
        )
        const nextActiveConversationId =
          prevState.activeConversationId === conversationId
            ? sameModeRemaining[0]?.id || remaining[0].id
            : prevState.activeConversationId
        const nextActiveConversationIds = {
          ...prevState.activeConversationIds,
          [deletedMode]:
            prevState.activeConversationIds[deletedMode] === conversationId
              ? sameModeRemaining[0]?.id || null
              : prevState.activeConversationIds[deletedMode],
        }

        return persistConversationState(
          remaining,
          nextActiveConversationId,
          nextActiveConversationIds
        )
      })
    },
    [persistConversationState]
  )

  const switchMode = useCallback(
    (nextMode: PlaygroundMode) => {
      setConversationState((prevState) => {
        const existingId =
          prevState.activeConversationIds[nextMode] ||
          prevState.conversations
            .filter((conversation) => (conversation.mode || 'chat') === nextMode)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ||
          null

        if (existingId) {
          return persistConversationState(prevState.conversations, existingId, {
            ...prevState.activeConversationIds,
            [nextMode]: existingId,
          })
        }

        const conversation = createConversation([], nextMode)
        return persistConversationState(
          [conversation, ...prevState.conversations],
          conversation.id,
          {
            ...prevState.activeConversationIds,
            [nextMode]: conversation.id,
          }
        )
      })
    },
    [persistConversationState]
  )

  const updateActiveConversationMeta = useCallback(
    (
      updates: Partial<
        Pick<
          PlaygroundConversation,
          | 'mode'
          | 'workspaceName'
          | 'agentPreviousResponseId'
          | 'agentResponsesSentMessageCount'
          | 'agentResponsesPendingToolCallIds'
          | 'agentResponsesModel'
          | 'agentResponsesWorkspaceName'
          | 'agentResponsesStateVersion'
        >
      >
    ) => {
      setConversationState((prevState) => {
        const currentId =
          prevState.activeConversationId || prevState.conversations[0]?.id || null
        if (!currentId) return prevState

        const now = Date.now()
        const nextConversations = prevState.conversations.map((conversation) =>
          conversation.id === currentId
            ? { ...conversation, ...updates, updatedAt: now }
            : conversation
        )

        const nextMode = updates.mode || mode
        const nextActiveConversationIds =
          updates.mode && currentId
            ? { ...prevState.activeConversationIds, [nextMode]: currentId }
            : prevState.activeConversationIds

        return persistConversationState(
          nextConversations,
          currentId,
          nextActiveConversationIds
        )
      })
    },
    [mode, persistConversationState]
  )

  // Reset config to defaults
  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
    setParameterEnabled(DEFAULT_PARAMETER_ENABLED)
    saveConfig(DEFAULT_CONFIG)
    saveParameterEnabled(DEFAULT_PARAMETER_ENABLED)
  }, [])

  return {
    // State
    config,
    parameterEnabled,
    messages,
    mode,
    workspaceName,
    models,
    groups,
    conversations,
    activeConversationId,
    activeConversation,

    // Setters
    setModels,
    setGroups,

    // Actions
    updateConfig,
    updateParameterEnabled,
    updateMessages,
    clearMessages,
    resetConfig,
    createNewConversation,
    switchConversation,
    switchMode,
    deleteConversation,
    updateActiveConversationMeta,
  }
}
