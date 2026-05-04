import { api } from '@/lib/api'

export type CodexAccount = {
  id: number
  owner_user_id: number
  owner_username?: string
  owner_display_name?: string
  name: string
  email: string
  account_id: string
  base_url: string
  proxy: string
  priority: number
  note: string
  status: number
  last_refresh: number
  expired_at: number
  last_used_time: number
  next_retry_time: number
  used_count: number
  failed_count: number
  last_error: string
  created_at: number
  updated_at: number
  has_refresh_token: boolean
  model_states?: Array<{
    id: number
    account_row_id: number
    model: string
    next_retry_time: number
    failed_count: number
    last_error: string
  }>
}

export type CodexAccountAccess = {
  is_admin: boolean
  is_subagent: boolean
  user_id: number
}

export type CodexSubagent = {
  id: number
  user_id: number
  admin_user_id: number
  username: string
  display_name: string
  email: string
  account_count: number
  key_count: number
  used_quota: number
  created_at: number
  updated_at: number
}

export type CodexProxyKey = {
  id: number
  user_id: number
  name: string
  key: string
  status: number
  remain_quota: number
  used_quota: number
  unlimited_quota: boolean
  expired_time: number
  created_time: number
  accessed_time: number
  codex_subagent_only: boolean
  codex_subagent_owner: number
}

export type CodexProxyStats = {
  total?: {
    prompt_tokens?: number
    completion_tokens?: number
    cache_tokens?: number
    quota?: number
    requests?: number
  }
  keys?: Array<{
    token_id: number
    token_name: string
    prompt_tokens: number
    completion_tokens: number
    cache_tokens: number
    quota: number
    requests: number
  }>
}

export async function getCodexAccountAccess() {
  const res = await api.get('/api/codex_account/access')
  return res.data as { success: boolean; message?: string; data?: CodexAccountAccess }
}

export async function getCodexAccounts(params: {
  page?: number
  page_size?: number
  search?: string
  owner_user_id?: number
}) {
  const res = await api.get('/api/codex_account/', { params })
  return res.data as {
    success: boolean
    message?: string
    data?: {
      items: CodexAccount[]
      total: number
      page: number
      page_size: number
    }
  }
}

export async function startCodexAccountOAuth() {
  const res = await api.post('/api/codex_account/oauth/start')
  return res.data as {
    success: boolean
    message?: string
    data?: { authorize_url?: string }
  }
}

export async function completeCodexAccountOAuth(payload: {
  input: string
  name?: string
  base_url?: string
  proxy?: string
  owner_user_id?: number
}) {
  const res = await api.post('/api/codex_account/oauth/complete', payload)
  return res.data as { success: boolean; message?: string }
}

export async function importCodexAccounts(payload: {
  raw: string
  base_url?: string
  proxy?: string
  owner_user_id?: number
}) {
  const res = await api.post('/api/codex_account/import', payload)
  return res.data as {
    success: boolean
    message?: string
    data?: { imported: number; total: number }
  }
}

export async function exportCodexAccounts(ownerUserId?: number) {
  const res = await api.get('/api/codex_account/export', {
    params: ownerUserId !== undefined ? { owner_user_id: ownerUserId } : undefined,
  })
  return res.data as { success: boolean; data?: unknown }
}

export async function updateCodexAccount(
  id: number,
  payload: Partial<
    Pick<CodexAccount, 'name' | 'base_url' | 'proxy' | 'priority' | 'note' | 'status'>
  >
) {
  const res = await api.put(`/api/codex_account/${id}`, payload)
  return res.data as { success: boolean; message?: string }
}

export async function deleteCodexAccount(id: number) {
  const res = await api.delete(`/api/codex_account/${id}`)
  return res.data as { success: boolean; message?: string }
}

export async function refreshCodexAccount(id: number) {
  const res = await api.post(`/api/codex_account/${id}/refresh`)
  return res.data as { success: boolean; message?: string }
}

export async function getCodexAccountUsage(id: number) {
  const res = await api.get(`/api/codex_account/${id}/usage`)
  return res.data as {
    success: boolean
    message?: string
    upstream_status?: number
    data?: unknown
  }
}

export async function getCodexSubagents() {
  const res = await api.get('/api/codex_account/subagents')
  return res.data as { success: boolean; message?: string; data?: CodexSubagent[] }
}

export async function addCodexSubagent(userId: number) {
  const res = await api.post('/api/codex_account/subagents', { user_id: userId })
  return res.data as { success: boolean; message?: string }
}

export async function deleteCodexSubagent(userId: number) {
  const res = await api.delete(`/api/codex_account/subagents/${userId}`)
  return res.data as { success: boolean; message?: string }
}

export async function getCodexProxyKeys(ownerUserId?: number) {
  const res = await api.get('/api/codex_account/proxy_keys', {
    params: ownerUserId !== undefined ? { owner_user_id: ownerUserId } : undefined,
  })
  return res.data as { success: boolean; message?: string; data?: CodexProxyKey[] }
}

export async function createCodexProxyKey(payload: {
  name: string
  remain_quota: number
  unlimited_quota: boolean
  expired_time: number
  owner_user_id?: number
}) {
  const res = await api.post('/api/codex_account/proxy_keys', payload)
  return res.data as {
    success: boolean
    message?: string
    data?: { key?: string; token?: CodexProxyKey }
  }
}

export async function updateCodexProxyKey(
  id: number,
  payload: Partial<Pick<CodexProxyKey, 'name' | 'remain_quota' | 'unlimited_quota' | 'expired_time' | 'status'>>
) {
  const res = await api.put(`/api/codex_account/proxy_keys/${id}`, payload)
  return res.data as { success: boolean; message?: string }
}

export async function deleteCodexProxyKey(id: number) {
  const res = await api.delete(`/api/codex_account/proxy_keys/${id}`)
  return res.data as { success: boolean; message?: string }
}

export async function fetchCodexProxyKeySecret(id: number) {
  const res = await api.post(`/api/codex_account/proxy_keys/${id}/key`)
  return res.data as { success: boolean; message?: string; data?: { key?: string } }
}

export async function getCodexProxyStats(ownerUserId?: number) {
  const res = await api.get('/api/codex_account/proxy_stats', {
    params: ownerUserId !== undefined ? { owner_user_id: ownerUserId } : undefined,
  })
  return res.data as { success: boolean; message?: string; data?: CodexProxyStats }
}
