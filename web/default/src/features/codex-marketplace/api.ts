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
  payment_type: string
  payment_text: string
  payment_url: string
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
  code_preview: string
  quota: number
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
  created_time: number
  accessed_time: number
  redeemed_at: number
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

export async function generateSellerCodexMarketCodes(payload: {
  product_id: number
  count: number
  quota: number
  expired_at?: number
}) {
  const res = await api.post('/api/codex_market/seller/codes', payload)
  return res.data as { success: boolean; message?: string; data?: { codes?: string[] } }
}
