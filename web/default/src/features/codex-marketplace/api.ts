import { api } from '@/lib/api'

export const QUOTA_PER_USD = 10000

export type CodexMarketProduct = {
  id: number
  seller_id: number
  seller_username?: string
  seller_display_name?: string
  title: string
  description: string
  models: string
  quota: number
  key_rpm: number
  payment_type: string
  payment_text: string
  payment_url: string
  payment_confirm_text: string
  status: number
  available_codes: number
  created_at: number
  updated_at: number
}

export type CodexMarketCode = {
  id: number
  product_id: number
  seller_id: number
  buyer_id: number
  token_id: number
  batch_id: string
  code_preview: string
  plain_code?: string
  quota: number
  key_rpm: number
  status: number
  redeemed_at: number
  expired_at: number
  created_at: number
}

export type CodexMarketKey = {
  id: number
  product_id: number
  product_title: string
  seller_id: number
  seller_username?: string
  seller_display_name?: string
  token_id: number
  token_name: string
  key: string
  status: number
  remain_quota: number
  used_quota: number
  unlimited_quota: boolean
  model_limits: string
  rpm_limit: number
  created_time: number
  accessed_time: number
  redeemed_at: number
}

export type CodexMarketPayment = {
  id: number
  product_id: number
  product_title?: string
  seller_id: number
  buyer_id: number
  buyer_username?: string
  buyer_display_name?: string
  token_id: number
  token_name?: string
  key?: string
  contact: string
  proof: string
  message: string
  quota: number
  key_rpm: number
  status: number
  remain_quota?: number
  used_quota?: number
  unlimited_quota?: boolean
  created_at: number
  updated_at: number
  reviewed_at: number
}

export function quotaToUsd(quota?: number) {
  return ((quota || 0) / QUOTA_PER_USD).toFixed(4)
}

export function usdToQuota(value: string) {
  const usd = Number.parseFloat(value)
  if (!Number.isFinite(usd) || usd < 0) return 0
  return Math.round(usd * QUOTA_PER_USD)
}

export async function getCodexMarketProducts() {
  const res = await api.get('/api/codex_market/products')
  return res.data as { success: boolean; message?: string; data?: CodexMarketProduct[] }
}

export async function getMyCodexMarketKeys() {
  const res = await api.get('/api/codex_market/my_keys')
  return res.data as { success: boolean; message?: string; data?: CodexMarketKey[] }
}

export async function getMyCodexMarketKeySecret(id: number) {
  const res = await api.post(`/api/codex_market/my_keys/${id}/key`)
  return res.data as { success: boolean; message?: string; data?: { key?: string } }
}

export async function redeemCodexMarketCode(code: string) {
  const res = await api.post('/api/codex_market/redeem', { code })
  return res.data as {
    success: boolean
    message?: string
    data?: { key?: string; item?: CodexMarketKey }
  }
}

export async function submitCodexMarketPayment(payload: {
  product_id: number
  contact: string
  proof: string
  message: string
}) {
  const res = await api.post('/api/codex_market/payments', payload)
  return res.data as { success: boolean; message?: string; data?: CodexMarketPayment }
}

export async function getMyCodexMarketPayments() {
  const res = await api.get('/api/codex_market/my_payments')
  return res.data as { success: boolean; message?: string; data?: CodexMarketPayment[] }
}

export async function getMyCodexMarketPaymentKeySecret(id: number) {
  const res = await api.post(`/api/codex_market/my_payments/${id}/key`)
  return res.data as { success: boolean; message?: string; data?: { key?: string } }
}

export async function getSellerCodexMarketProducts(sellerId?: number) {
  const res = await api.get('/api/codex_market/seller/products', {
    params: sellerId !== undefined ? { seller_id: sellerId } : undefined,
  })
  return res.data as { success: boolean; message?: string; data?: CodexMarketProduct[] }
}

export async function createSellerCodexMarketProduct(payload: Partial<CodexMarketProduct>) {
  const res = await api.post('/api/codex_market/seller/products', payload)
  return res.data as { success: boolean; message?: string; data?: CodexMarketProduct }
}

export async function updateSellerCodexMarketProduct(
  id: number,
  payload: Partial<CodexMarketProduct>
) {
  const res = await api.put(`/api/codex_market/seller/products/${id}`, payload)
  return res.data as { success: boolean; message?: string; data?: CodexMarketProduct }
}

export async function deleteSellerCodexMarketProduct(id: number) {
  const res = await api.delete(`/api/codex_market/seller/products/${id}`)
  return res.data as { success: boolean; message?: string }
}

export async function getSellerCodexMarketCodes(productId?: number, sellerId?: number) {
  const res = await api.get('/api/codex_market/seller/codes', {
    params: {
      ...(productId ? { product_id: productId } : {}),
      ...(sellerId !== undefined ? { seller_id: sellerId } : {}),
    },
  })
  return res.data as { success: boolean; message?: string; data?: CodexMarketCode[] }
}

export async function exportSellerCodexMarketCodes(params?: {
  product_id?: number
  batch_id?: string
  seller_id?: number
}) {
  const res = await api.get('/api/codex_market/seller/codes/export', { params })
  return res.data as { success: boolean; message?: string; data?: { codes?: string[] } }
}

export async function disableSellerCodexMarketCode(id: number) {
  const res = await api.post(`/api/codex_market/seller/codes/${id}/disable`)
  return res.data as { success: boolean; message?: string }
}

export async function cleanupInvalidSellerCodexMarketCodes(params?: {
  product_id?: number
  seller_id?: number
}) {
  const res = await api.post('/api/codex_market/seller/codes/cleanup_invalid', undefined, { params })
  return res.data as { success: boolean; message?: string; data?: { deleted?: number } }
}

export async function generateSellerCodexMarketCodes(payload: {
  product_id: number
  count: number
  quota: number
  key_rpm?: number
  expired_at?: number
}) {
  const res = await api.post('/api/codex_market/seller/codes', payload)
  return res.data as { success: boolean; message?: string; data?: { codes?: string[] } }
}

export async function getSellerCodexMarketPayments(sellerId?: number) {
  const res = await api.get('/api/codex_market/seller/payments', {
    params: sellerId !== undefined ? { seller_id: sellerId } : undefined,
  })
  return res.data as { success: boolean; message?: string; data?: CodexMarketPayment[] }
}

export async function reviewSellerCodexMarketPayment(
  id: number,
  payload: { status: number; message?: string }
) {
  const res = await api.post(`/api/codex_market/seller/payments/${id}/review`, payload)
  return res.data as { success: boolean; message?: string; data?: { key?: string } }
}
