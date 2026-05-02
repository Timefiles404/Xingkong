import { api } from '@/lib/api'
import type {
  DeleteLogsResponse,
  FetchUpstreamRatiosRequest,
  SystemOptionsResponse,
  UpdateOptionRequest,
  UpdateOptionResponse,
  UpstreamChannelsResponse,
  UpstreamRatiosResponse,
} from './types'

export async function getSystemOptions() {
  const res = await api.get<SystemOptionsResponse>('/api/option/')
  return res.data
}

export async function updateSystemOption(request: UpdateOptionRequest) {
  const res = await api.put<UpdateOptionResponse>('/api/option/', request)
  return res.data
}

export async function deleteLogsBefore(targetTimestamp: number) {
  const res = await api.delete<DeleteLogsResponse>('/api/log/', {
    params: { target_timestamp: targetTimestamp },
  })
  return res.data
}

export async function resetModelRatios() {
  const res = await api.post<UpdateOptionResponse>(
    '/api/option/rest_model_ratio'
  )
  return res.data
}

export async function getUpstreamChannels() {
  const res = await api.get<UpstreamChannelsResponse>(
    '/api/ratio_sync/channels'
  )
  return res.data
}

export async function fetchUpstreamRatios(request: FetchUpstreamRatiosRequest) {
  const res = await api.post<UpstreamRatiosResponse>(
    '/api/ratio_sync/fetch',
    request
  )
  return res.data
}

export type SystemUpdateInfo = {
  current_version: string
  latest_version: string
  has_update: boolean
  repository: string
  image: string
  can_auto_update: boolean
  auto_update_hint?: string
  release_info?: {
    tag_name: string
    name?: string
    body?: string
    html_url?: string
    published_at?: string
  }
}

export type SystemUpdateInfoResponse = {
  success: boolean
  message: string
  data?: SystemUpdateInfo
}

export type ApplySystemUpdateResponse = {
  success: boolean
  message: string
  data?: {
    target_image?: string
  }
}

export async function checkSystemUpdate() {
  const res = await api.get<SystemUpdateInfoResponse>('/api/system/update/check')
  return res.data
}

export async function applySystemUpdate() {
  const res = await api.post<ApplySystemUpdateResponse>('/api/system/update/apply')
  return res.data
}
