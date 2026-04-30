export type ImagePlaygroundAttachment = {
  id: string
  type: 'image'
  name: string
  mimeType?: string
  url: string
}

export type GeneratedImage = {
  id: string
  url: string
  revisedPrompt?: string
}

export type ImagePlaygroundMessage = {
  key: string
  from: 'user' | 'assistant'
  prompt: string
  attachments?: ImagePlaygroundAttachment[]
  images?: GeneratedImage[]
  status?: 'loading' | 'complete' | 'error'
  errorMessage?: string
  createdAt: number
}

export type ImagePlaygroundConversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ImagePlaygroundMessage[]
}

export type ImagePlaygroundConfig = {
  model: string
  group: string
}

export interface ModelOption {
  label: string
  value: string
}

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

export type ImageGenerationRequest = {
  model: string
  group: string
  prompt: string
  response_format: 'b64_json'
}

export type ImageGenerationResponse = {
  created?: number
  data?: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
}
