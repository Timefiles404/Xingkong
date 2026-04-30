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
} from '../types'

function getConversationTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((message) => message.from === 'user')
  const text = firstUserMessage?.versions?.[0]?.content?.trim()
  if (text) {
    return text.length > 28 ? `${text.slice(0, 28)}...` : text
  }

  const firstAttachment = firstUserMessage?.attachments?.[0]?.name
  if (firstAttachment) {
    return firstAttachment
  }

  return 'New conversation'
}

function createConversation(messages: Message[] = []): PlaygroundConversation {
  const now = Date.now()
  return {
    id: nanoid(),
    title: getConversationTitle(messages),
    createdAt: now,
    updatedAt: now,
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
    }
  })

  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  const { conversations, activeConversationId } = conversationState
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ||
    conversations[0]
  const messages = activeConversation?.messages || []

  const persistConversationState = useCallback(
    (
      nextConversations: PlaygroundConversation[],
      nextActiveConversationId: string | null
    ) => {
      saveConversations(nextConversations, nextActiveConversationId)
      return {
        conversations: nextConversations,
        activeConversationId: nextActiveConversationId,
      }
    },
    []
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

        return persistConversationState(nextConversations, currentId)
      })
    },
    [persistConversationState]
  )

  // Clear all messages
  const clearMessages = useCallback(() => {
    updateMessages([])
  }, [updateMessages])

  const createNewConversation = useCallback(() => {
    setConversationState((prevState) => {
      const conversation = createConversation()
      const nextConversations = [conversation, ...prevState.conversations]
      return persistConversationState(nextConversations, conversation.id)
    })
  }, [persistConversationState])

  const switchConversation = useCallback(
    (conversationId: string) => {
      setConversationState((prevState) => {
        if (!prevState.conversations.some((item) => item.id === conversationId)) {
          return prevState
        }
        return persistConversationState(prevState.conversations, conversationId)
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
          return persistConversationState([replacement], replacement.id)
        }

        const nextActiveConversationId =
          prevState.activeConversationId === conversationId
            ? remaining[0].id
            : prevState.activeConversationId

        return persistConversationState(remaining, nextActiveConversationId)
      })
    },
    [persistConversationState]
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
    models,
    groups,
    conversations,
    activeConversationId,

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
    deleteConversation,
  }
}
