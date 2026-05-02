import { nanoid } from 'nanoid'
import { DEFAULT_CONFIG, IMAGE_PLAYGROUND_STORAGE_KEYS } from './constants'
import type {
  ImagePlaygroundConfig,
  ImagePlaygroundConversation,
  ImagePlaygroundMessage,
} from './types'

function getConversationTitle(messages: ImagePlaygroundMessage[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.from === 'user')
  const text = lastUserMessage?.prompt?.trim()
  if (text) {
    return text.length > 24 ? `${text.slice(0, 24)}...` : text
  }

  const firstAttachment = lastUserMessage?.attachments?.[0]?.name
  if (firstAttachment) {
    return firstAttachment
  }

  return 'New image task'
}

export function createConversation(
  messages: ImagePlaygroundMessage[] = []
): ImagePlaygroundConversation {
  const now = Date.now()
  return {
    id: nanoid(),
    title: getConversationTitle(messages),
    createdAt: now,
    updatedAt: now,
    messages,
  }
}

export function loadConfig(): ImagePlaygroundConfig {
  try {
    const saved = localStorage.getItem(IMAGE_PLAYGROUND_STORAGE_KEYS.CONFIG)
    if (saved) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(saved) }
    }
  } catch {
    // ignore invalid cache
  }
  return DEFAULT_CONFIG
}

export function saveConfig(config: ImagePlaygroundConfig): void {
  try {
    localStorage.setItem(
      IMAGE_PLAYGROUND_STORAGE_KEYS.CONFIG,
      JSON.stringify(config)
    )
  } catch {
    // ignore storage failure
  }
}

export function loadConversationState(): {
  conversations: ImagePlaygroundConversation[]
  activeConversationId: string | null
} {
  try {
    const savedConversations = localStorage.getItem(
      IMAGE_PLAYGROUND_STORAGE_KEYS.CONVERSATIONS
    )
    const savedActiveId = localStorage.getItem(
      IMAGE_PLAYGROUND_STORAGE_KEYS.ACTIVE_CONVERSATION_ID
    )

    if (!savedConversations) {
      return { conversations: [], activeConversationId: null }
    }

    const conversations = JSON.parse(
      savedConversations
    ) as ImagePlaygroundConversation[]

    return {
      conversations,
      activeConversationId:
        savedActiveId && conversations.some((item) => item.id === savedActiveId)
          ? savedActiveId
          : conversations[0]?.id || null,
    }
  } catch {
    return { conversations: [], activeConversationId: null }
  }
}

export function saveConversationState(
  conversations: ImagePlaygroundConversation[],
  activeConversationId: string | null
): void {
  try {
    localStorage.setItem(
      IMAGE_PLAYGROUND_STORAGE_KEYS.CONVERSATIONS,
      JSON.stringify(conversations)
    )
    if (activeConversationId) {
      localStorage.setItem(
        IMAGE_PLAYGROUND_STORAGE_KEYS.ACTIVE_CONVERSATION_ID,
        activeConversationId
      )
    } else {
      localStorage.removeItem(IMAGE_PLAYGROUND_STORAGE_KEYS.ACTIVE_CONVERSATION_ID)
    }
  } catch {
    // ignore storage failure
  }
}

export { getConversationTitle }
