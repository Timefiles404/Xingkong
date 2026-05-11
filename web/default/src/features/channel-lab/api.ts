import { api } from '@/lib/api'

export type ChannelLabPayload = {
  base_url: string
  type: number
  key: string
  proxy?: string
  skip_tls_verify?: boolean
  model?: string
  models?: string[]
  endpoint_type?: string
  stream?: boolean
}

export type ChannelLabDetail = {
  model: string
  upstream_model?: string
  endpoint_type: string
  request_path: string
  request_url?: string
  request_body?: string
  response_status?: number
  response_body?: string
  error_code?: string
  error_message?: string
  duration_ms: number
  stream: boolean
  channel_type: number
  channel_type_name: string
  base_url: string
  detected_by: string
}

export type ChannelLabAttempt = {
  endpoint_type: string
  success: boolean
  message?: string
  detail?: ChannelLabDetail
}

export type ChannelLabTestResult = {
  success: boolean
  model: string
  endpoint_type: string
  message?: string
  time: number
  detail?: ChannelLabDetail
  attempts?: ChannelLabAttempt[]
}

export type ChannelLabFetchModelsResponse = {
  success: boolean
  message?: string
  data?: string[]
}

export type ChannelLabTestAllResponse = {
  success: boolean
  message?: string
  data?: {
    success: ChannelLabTestResult[]
    failed: ChannelLabTestResult[]
    total: number
  }
}

export type ChannelLabCPAImportItem = {
  client_id?: string
  base_url: string
  type: number
  key: string
  proxy?: string
  skip_tls_verify?: boolean
  available_models: string[]
  model_endpoint_types?: Record<string, string>
}

export type ChannelLabCPAImportResponse = {
  success: boolean
  message?: string
  data?: {
    items: {
      client_id?: string
      id: number
      name: string
      base_url: string
      available_models: string[]
    }[]
    total: number
  }
}

export async function fetchChannelLabModels(payload: ChannelLabPayload) {
  const res = await api.post('/api/channel_lab/fetch_models', payload)
  return res.data as ChannelLabFetchModelsResponse
}

export async function testChannelLabModel(payload: ChannelLabPayload) {
  const res = await api.post('/api/channel_lab/test', payload)
  return res.data as ChannelLabTestResult
}

export async function testAllChannelLabModels(payload: ChannelLabPayload) {
  const res = await api.post('/api/channel_lab/test_all', payload)
  return res.data as ChannelLabTestAllResponse
}

export async function importChannelLabCPAChannels(
  items: ChannelLabCPAImportItem[]
) {
  const res = await api.post('/api/channel_lab/import_cpa', { items })
  return res.data as ChannelLabCPAImportResponse
}
