import { api } from '@/lib/api'
import { API_ENDPOINTS } from './constants'
import type {
  AgentExternalEndpointType,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelOption,
  GroupOption,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Get user available models
 */
export async function getUserModels(): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { capability: 'text' },
  })
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

function normalizeExternalBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export async function getExternalProviderModels(
  baseUrl: string,
  apiKey: string,
  endpointType: AgentExternalEndpointType
): Promise<ModelOption[]> {
  const normalized = normalizeExternalBaseUrl(baseUrl)
  const url = endpointType === 'responses'
    ? `${normalized}/models`
    : `${normalized}/models`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  const payload = (await response.json()) as {
    data?: Array<{ id?: string; name?: string }>
  }
  return (payload.data || [])
    .map((item) => item.id || item.name || '')
    .filter(Boolean)
    .map((model) => ({ label: model, value: model }))
}

export async function chargeExternalAgentRequestFee(): Promise<void> {
  await api.post('/api/playground/agent/external-request-fee')
}
