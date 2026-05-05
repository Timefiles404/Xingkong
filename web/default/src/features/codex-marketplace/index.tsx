import { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  getCodexMarketProducts,
  getMyCodexMarketPaymentKeySecret,
  getMyCodexMarketPayments,
  getMyCodexMarketKeySecret,
  getMyCodexMarketKeys,
  quotaToUsd,
  redeemCodexMarketCode,
  submitCodexMarketPayment,
  type CodexMarketKey,
  type CodexMarketPayment,
  type CodexMarketProduct,
} from './api'

function formatTime(ts?: number) {
  if (!ts || ts < 0) return '-'
  return new Date(ts * 1000).toLocaleString()
}

function sellerName(item: { seller_display_name?: string; seller_username?: string; seller_id: number }) {
  return item.seller_display_name || item.seller_username || `卖家 #${item.seller_id}`
}

function keyUsagePercent(item: Pick<CodexMarketKey, 'remain_quota' | 'used_quota' | 'unlimited_quota'>) {
  const total = (item.remain_quota || 0) + (item.used_quota || 0)
  if (item.unlimited_quota || total <= 0) return 0
  return Math.max(0, Math.min(100, (item.used_quota / total) * 100))
}

export function CodexMarketplace() {
  const [products, setProducts] = useState<CodexMarketProduct[]>([])
  const [keys, setKeys] = useState<CodexMarketKey[]>([])
  const [payments, setPayments] = useState<CodexMarketPayment[]>([])
  const [redeemCode, setRedeemCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [paymentProduct, setPaymentProduct] = useState<CodexMarketProduct | null>(null)
  const [paymentContact, setPaymentContact] = useState('')
  const [paymentProof, setPaymentProof] = useState('')
  const [paymentMessage, setPaymentMessage] = useState('')

  const activeProducts = useMemo(
    () => products.filter((item) => item.status === 1),
    [products]
  )
  const approvedPaymentKeys = useMemo(
    () => {
      const codeTokenIds = new Set(keys.map((item) => item.token_id).filter(Boolean))
      return payments.filter((item) => item.status === 2 && item.token_id > 0 && !codeTokenIds.has(item.token_id))
    },
    [keys, payments]
  )

  const load = async () => {
    setLoading(true)
    try {
      const [productRes, keyRes, paymentRes] = await Promise.all([
        getCodexMarketProducts(),
        getMyCodexMarketKeys(),
        getMyCodexMarketPayments(),
      ])
      if (productRes.success) setProducts(productRes.data || [])
      if (keyRes.success) setKeys(keyRes.data || [])
      if (paymentRes.success) setPayments(paymentRes.data || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      toast.error('请输入兑换码')
      return
    }
    setRedeeming(true)
    try {
      const res = await redeemCodexMarketCode(redeemCode)
      if (!res.success) {
        toast.error(res.message || '兑换失败')
        return
      }
      if (res.data?.key) {
        await navigator.clipboard.writeText(res.data.key)
        toast.success('兑换成功，API Key 已复制')
      } else {
        toast.success('兑换成功')
      }
      setRedeemCode('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '兑换失败')
    } finally {
      setRedeeming(false)
    }
  }

  const copyKey = async (id: number) => {
    const res = await getMyCodexMarketKeySecret(id)
    if (!res.success || !res.data?.key) {
      toast.error(res.message || '获取 key 失败')
      return
    }
    await navigator.clipboard.writeText(res.data.key)
    toast.success('Key 已复制')
  }

  const copyPaymentKey = async (id: number) => {
    const res = await getMyCodexMarketPaymentKeySecret(id)
    if (!res.success || !res.data?.key) {
      toast.error(res.message || '获取 key 失败')
      return
    }
    await navigator.clipboard.writeText(res.data.key)
    toast.success('Key 已复制')
  }

  const submitPayment = async () => {
    if (!paymentProduct) return
    const res = await submitCodexMarketPayment({
      product_id: paymentProduct.id,
      contact: paymentContact,
      proof: paymentProof,
      message: paymentMessage,
    })
    if (!res.success) {
      toast.error(res.message || '提交失败')
      return
    }
    toast.success('支付确认已提交，等待卖家审核')
    setPaymentProduct(null)
    setPaymentContact('')
    setPaymentProof('')
    setPaymentMessage('')
    await load()
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>Codex 跳蚤市场</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        通过子代理兑换码获得托管 Codex 额度。这里的额度只用于对应卖家的 Codex 号池，不消耗你的普通余额。
      </SectionPageLayout.Description>
      <SectionPageLayout.Actions>
        <Button variant='outline' onClick={load} disabled={loading}>
          {loading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <RefreshCw className='mr-2 h-4 w-4' />}
          刷新
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <Tabs defaultValue='market'>
          <TabsList>
            <TabsTrigger value='market'>正在售卖</TabsTrigger>
            <TabsTrigger value='keys'>我的市场 Key</TabsTrigger>
          </TabsList>

          <TabsContent value='market' className='space-y-4'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>兑换码兑换</CardTitle>
              </CardHeader>
              <CardContent>
                <div className='flex flex-col gap-3 md:flex-row md:items-end'>
                  <div className='flex-1 space-y-2'>
                    <Label>兑换码</Label>
                    <Input
                      value={redeemCode}
                      onChange={(e) => setRedeemCode(e.target.value)}
                      placeholder='输入从卖家处获得的兑换码'
                    />
                  </div>
                  <Button onClick={handleRedeem} disabled={redeeming}>
                    {redeeming ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <KeyRound className='mr-2 h-4 w-4' />}
                    兑换并复制 Key
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {activeProducts.map((product) => (
                <Card key={product.id} className='overflow-hidden'>
                  <CardHeader>
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <CardTitle className='text-base'>{product.title}</CardTitle>
                        <div className='text-muted-foreground mt-1 text-xs'>
                          {sellerName(product)} · ${quotaToUsd(product.quota)}
                          {product.key_rpm ? ` · RPM ${product.key_rpm}` : ''}
                        </div>
                      </div>
                      <Badge variant='secondary'>{product.available_codes || 0} 个码</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <p className='text-muted-foreground line-clamp-4 min-h-16 text-sm'>
                      {product.description || '卖家暂未填写说明'}
                    </p>
                    <div className='flex flex-wrap gap-1'>
                      {(product.models || '').split(',').filter(Boolean).map((model) => (
                        <Badge key={model} variant='outline' className='text-[11px]'>
                          {model}
                        </Badge>
                      ))}
                    </div>
                    <div className='rounded-lg bg-muted/50 p-3 text-sm'>
                      <div className='font-medium'>外部支付 / 联系方式</div>
                      <div className='text-muted-foreground mt-1 whitespace-pre-wrap break-words text-xs'>
                      {product.payment_text || '卖家暂未填写，请通过其他渠道联系卖家获取兑换码。'}
                      </div>
                      {product.payment_url && (
                        <Button variant='link' className='h-auto px-0 pt-2 text-xs' asChild>
                          <a href={product.payment_url} target='_blank' rel='noreferrer'>
                            打开支付链接
                            <ExternalLink className='ml-1 h-3 w-3' />
                          </a>
                        </Button>
                      )}
                    </div>
                    <Button variant='outline' size='sm' onClick={() => setPaymentProduct(product)}>
                      提交支付确认
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {activeProducts.length === 0 && (
                <div className='text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm md:col-span-2 xl:col-span-3'>
                  当前没有上架商品。
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value='keys' className='space-y-4'>
            <div className='grid gap-4 lg:grid-cols-2'>
              {keys.map((item) => {
                const percent = keyUsagePercent(item)
                const total = (item.remain_quota || 0) + (item.used_quota || 0)
                return (
                  <Card key={item.id}>
                    <CardHeader>
                      <div className='flex items-start justify-between gap-3'>
                        <div>
                          <CardTitle className='text-base'>{item.product_title || item.token_name}</CardTitle>
                          <div className='text-muted-foreground mt-1 text-xs'>
                            {sellerName(item)} · {item.key}
                          </div>
                        </div>
                        <Badge variant={item.status === 1 ? 'default' : 'secondary'}>
                          {item.status === 1 ? '可用' : '不可用'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                      <div className='space-y-1'>
                        <div className='flex items-center justify-between text-xs'>
                          <span>额度使用</span>
                          <span className='text-muted-foreground'>
                            ${quotaToUsd(item.used_quota)} / ${quotaToUsd(total)}
                          </span>
                        </div>
                        <Progress value={percent} className='h-1.5' />
                        <div className='text-muted-foreground text-xs'>剩余 ${quotaToUsd(item.remain_quota)}</div>
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        模型：{item.model_limits || '-'} · RPM {item.rpm_limit || '不限'} · 兑换时间：{formatTime(item.redeemed_at)}
                      </div>
                      <div className='flex justify-end'>
                        <Button variant='outline' size='sm' onClick={() => copyKey(item.id)}>
                          <Copy className='mr-2 h-4 w-4' />
                          复制完整 Key
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              {approvedPaymentKeys.map((payment) => {
                const percent = keyUsagePercent({
                  remain_quota: payment.remain_quota || 0,
                  used_quota: payment.used_quota || 0,
                  unlimited_quota: !!payment.unlimited_quota,
                })
                const total = (payment.remain_quota || 0) + (payment.used_quota || 0)
                return (
                  <Card key={`payment-${payment.id}`}>
                    <CardHeader>
                      <div className='flex items-start justify-between gap-3'>
                        <div>
                          <CardTitle className='text-base'>{payment.product_title || payment.token_name || `商品 #${payment.product_id}`}</CardTitle>
                          <div className='text-muted-foreground mt-1 text-xs'>
                            支付确认发货 · {payment.key || payment.token_name || `Token #${payment.token_id}`}
                          </div>
                        </div>
                        <Badge variant='default'>可用</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                      <div className='space-y-1'>
                        <div className='flex items-center justify-between text-xs'>
                          <span>额度使用</span>
                          <span className='text-muted-foreground'>
                            ${quotaToUsd(payment.used_quota)} / ${quotaToUsd(total)}
                          </span>
                        </div>
                        <Progress value={percent} className='h-1.5' />
                        <div className='text-muted-foreground text-xs'>剩余 ${quotaToUsd(payment.remain_quota)}</div>
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        RPM {payment.key_rpm || '不限'} · 通过时间：{formatTime(payment.reviewed_at || payment.updated_at)}
                      </div>
                      <div className='flex justify-end'>
                        <Button variant='outline' size='sm' onClick={() => copyPaymentKey(payment.id)}>
                          <Copy className='mr-2 h-4 w-4' />
                          复制完整 Key
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              {keys.length === 0 && approvedPaymentKeys.length === 0 && (
                <div className='text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm lg:col-span-2'>
                  还没有兑换过市场 Key。
                </div>
              )}
            </div>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>我的支付确认</CardTitle>
              </CardHeader>
              <CardContent className='grid gap-3 lg:grid-cols-2'>
                {payments.map((payment) => (
                  <div key={payment.id} className='rounded-xl border p-4 text-sm'>
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <div className='font-medium'>{payment.product_title || `商品 #${payment.product_id}`}</div>
                        <div className='text-muted-foreground mt-1 text-xs'>
                          ${quotaToUsd(payment.quota)} · RPM {payment.key_rpm || '不限'} · {formatTime(payment.created_at)}
                        </div>
                      </div>
                      <Badge variant={payment.status === 1 ? 'secondary' : payment.status === 2 ? 'default' : 'destructive'}>
                        {payment.status === 1 ? '待确认' : payment.status === 2 ? '已通过' : '已拒绝'}
                      </Badge>
                    </div>
                    {payment.message && (
                      <div className='text-muted-foreground mt-2 whitespace-pre-wrap break-words text-xs'>{payment.message}</div>
                    )}
                    {payment.status === 2 && payment.token_id > 0 && (
                      <div className='mt-3 flex justify-end'>
                        <Button variant='outline' size='sm' onClick={() => copyPaymentKey(payment.id)}>
                          <Copy className='mr-2 h-4 w-4' />
                          复制 Key
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                {payments.length === 0 && (
                  <div className='text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm lg:col-span-2'>
                    暂无支付确认记录。
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!paymentProduct} onOpenChange={(open) => !open && setPaymentProduct(null)}>
          <DialogContent className='sm:max-w-xl'>
            <DialogHeader>
              <DialogTitle>提交支付确认</DialogTitle>
            </DialogHeader>
            <div className='space-y-3'>
              <div className='rounded-lg bg-muted/50 p-3 text-sm'>
                <div className='font-medium'>{paymentProduct?.title}</div>
                <div className='text-muted-foreground mt-1 whitespace-pre-wrap break-words text-xs'>
                  {paymentProduct?.payment_confirm_text || '提交联系方式或支付凭证后，卖家确认会为你发放市场 Key。'}
                </div>
              </div>
              <Label>联系方式</Label>
              <Input value={paymentContact} onChange={(e) => setPaymentContact(e.target.value)} placeholder='QQ / 邮箱 / 订单号等' />
              <Label>支付凭证</Label>
              <Textarea value={paymentProof} onChange={(e) => setPaymentProof(e.target.value)} placeholder='支付截图链接、交易号或其他凭证' />
              <Label>补充说明</Label>
              <Textarea value={paymentMessage} onChange={(e) => setPaymentMessage(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setPaymentProduct(null)}>取消</Button>
              <Button onClick={submitPayment}>提交</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
