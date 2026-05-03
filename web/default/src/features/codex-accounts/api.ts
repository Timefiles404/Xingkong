import { api } from '@/lib/api'

export type CodexAccount = {
  id: number
  name: string
  email: string
  account_id: string
  base_url: string
  proxy: string
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
}

export async function getCodexAccounts(params: {
  page?: number
  page_size?: number
  search?: string
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
}) {
  const res = await api.post('/api/codex_account/oauth/complete', payload)
  return res.data as { success: boolean; message?: string }
}

export async function importCodexAccounts(payload: {
  raw: string
  base_url?: string
  proxy?: string
}) {
  const res = await api.post('/api/codex_account/import', payload)
  return res.data as {
    success: boolean
    message?: string
    data?: { imported: number; total: number }
  }
}

export async function exportCodexAccounts() {
  const res = await api.get('/api/codex_account/export')
  return res.data as { success: boolean; data?: unknown }
}

export async function updateCodexAccount(
  id: number,
  payload: Partial<Pick<CodexAccount, 'name' | 'base_url' | 'proxy' | 'status'>>
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
