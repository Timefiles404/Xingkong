import { STORAGE_KEYS } from '../constants'
import type {
  PlaygroundConfig,
  ParameterEnabled,
  Message,
  PlaygroundConversation,
} from '../types'
import { sanitizeMessagesOnLoad } from './message-utils'

function getConversationTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((message) => message.from === 'user')
  const text = firstUserMessage?.versions?.[0]?.content?.trim()
  if (text) {
    return text.length > 24 ? `${text.slice(0, 24)}...` : text
  }

  const firstAttachment = firstUserMessage?.attachments?.[0]?.name
  if (firstAttachment) {
    return firstAttachment
  }

  return 'New conversation'
}

/**
 * Load playground config from localStorage
 */
export function loadConfig(): Partial<PlaygroundConfig> {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.CONFIG)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load config:', error)
  }
  return {}
}

/**
 * Save playground config to localStorage
 */
export function saveConfig(config: Partial<PlaygroundConfig>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save config:', error)
  }
}

/**
 * Load parameter enabled state from localStorage
 */
export function loadParameterEnabled(): Partial<ParameterEnabled> {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.PARAMETER_ENABLED)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load parameter enabled:', error)
  }
  return {}
}

/**
 * Save parameter enabled state to localStorage
 */
export function saveParameterEnabled(
  parameterEnabled: Partial<ParameterEnabled>
): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.PARAMETER_ENABLED,
      JSON.stringify(parameterEnabled)
    )
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save parameter enabled:', error)
  }
}

/**
 * Load messages from localStorage
 */
export function loadMessages(): Message[] | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.MESSAGES)
    if (saved) {
      const parsed: Message[] = JSON.parse(saved)
      const sanitized = sanitizeMessagesOnLoad(parsed)
      // Persist sanitized result to avoid re-sanitizing on subsequent loads
      if (sanitized !== parsed) {
        saveMessages(sanitized)
      }
      return sanitized
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load messages:', error)
  }
  return null
}

/**
 * Save messages to localStorage
 */
export function saveMessages(messages: Message[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save messages:', error)
  }
}

export function loadConversations(): {
  conversations: PlaygroundConversation[]
  activeConversationId: string | null
} {
  try {
    const savedConversations = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS)
    const savedActiveId = localStorage.getItem(STORAGE_KEYS.ACTIVE_CONVERSATION_ID)

    if (savedConversations) {
      const parsed = JSON.parse(savedConversations) as PlaygroundConversation[]
      const conversations = parsed.map((conversation) => ({
        ...conversation,
        messages: sanitizeMessagesOnLoad(conversation.messages || []),
      }))

      return {
        conversations,
        activeConversationId:
          savedActiveId && conversations.some((item) => item.id === savedActiveId)
            ? savedActiveId
            : conversations[0]?.id || null,
      }
    }

    const legacyMessages = loadMessages()
    if (legacyMessages && legacyMessages.length > 0) {
      const now = Date.now()
      const migratedConversation: PlaygroundConversation = {
        id: `legacy-${now}`,
        title: getConversationTitle(legacyMessages),
        createdAt: now,
        updatedAt: now,
        messages: legacyMessages,
      }

      saveConversations([migratedConversation], migratedConversation.id)
      return {
        conversations: [migratedConversation],
        activeConversationId: migratedConversation.id,
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load conversations:', error)
  }

  return {
    conversations: [],
    activeConversationId: null,
  }
}

export function saveConversations(
  conversations: PlaygroundConversation[],
  activeConversationId: string | null
): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.CONVERSATIONS,
      JSON.stringify(conversations)
    )
    if (activeConversationId) {
      localStorage.setItem(
        STORAGE_KEYS.ACTIVE_CONVERSATION_ID,
        activeConversationId
      )
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONVERSATION_ID)
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save conversations:', error)
  }
}

/**
 * Clear all playground data
 */
export function clearPlaygroundData(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.CONFIG)
    localStorage.removeItem(STORAGE_KEYS.PARAMETER_ENABLED)
    localStorage.removeItem(STORAGE_KEYS.MESSAGES)
    localStorage.removeItem(STORAGE_KEYS.CONVERSATIONS)
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONVERSATION_ID)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to clear playground data:', error)
  }
}
