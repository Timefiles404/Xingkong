import type { ImagePlaygroundConfig } from './types'

export const IMAGE_PLAYGROUND_STORAGE_KEYS = {
  CONFIG: 'image_playground_config',
  CONVERSATIONS: 'image_playground_conversations',
  ACTIVE_CONVERSATION_ID: 'image_playground_active_conversation_id',
} as const

export const DEFAULT_GROUP = 'default' as const

export const DEFAULT_CONFIG: ImagePlaygroundConfig = {
  model: '',
  group: DEFAULT_GROUP,
}

export const IMAGE_PLAYGROUND_ENDPOINTS = {
  GENERATIONS: '/pg/images/generations',
  GENERATION_TASKS: '/pg/images/generations/tasks',
  EDITS: '/pg/images/edits',
  EDIT_TASKS: '/pg/images/edits/tasks',
  TASK_STATUS: (taskId: string) => `/pg/images/tasks/${taskId}`,
  USER_MODELS: '/api/user/models',
  USER_GROUPS: '/api/user/self/groups',
} as const
