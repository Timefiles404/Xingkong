import { useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, Plus, RefreshCw, Ticket } from 'lucide-react'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import {
  createSellerCodexMarketProduct,
  deleteSellerCodexMarketProduct,
  disableSellerCodexMarketCode,
  exportSellerCodexMarketCodes,
  generateSellerCodexMarketCodes,
  getSellerCodexMarketCodes,
  getSellerCodexMarketPayments,
  getSellerCodexMarketProducts,
  quotaToUsd,
  reviewSellerCodexMarketPayment,
  updateSellerCodexMarketProduct,
  usdToQuota,
  type CodexMarketCode,
  type CodexMarketPayment,
  type CodexMarketProduct,
} from './api'

const MODEL_LIST = ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark']

type ProductForm = {
  title: string
  description: string
  models: string
  quotaUsd: string
  keyRpm: string
  paymentType: string
  paymentText: string
  paymentUrl: string
  paymentConfirmText: string
  status: number
}

const emptyForm: ProductForm = {
  title: '',
  description: '',
  models: MODEL_LIST.join(','),
  quotaUsd: '10',
  keyRpm: '0',
  paymentType: 'text',
  paymentText: '',
  paymentUrl: '',
  paymentConfirmText: '',
  status: 2,
}

export function CodexMarketplaceSellerPanel(props: { sellerId?: number }) {
  const [products, setProducts] = useState<CodexMarketProduct[]>([])
  const [codes, setCodes] = useState<CodexMarketCode[]>([])
  const [payments, setPayments] = useState<CodexMarketPayment[]>([])
  const [loading, setLoading] = useState(false)
  const [productOpen, setProductOpen] = useState(false)
  const [editing, setEditing] = useState<CodexMarketProduct | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeProductId, setCodeProductId] = useState(0)
  const [codeCount, setCodeCount] = useState('1')
  const [codeQuotaUsd, setCodeQuotaUsd] = useState('')
  const [codeRpm, setCodeRpm] = useState('0')
  const [codeExpiredAt, setCodeExpiredAt] = useState('')
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([])

  const productMap = useMemo(
    () => new Map(products.map((item) => [item.id, item])),
    [products]
  )

  const load = async () => {
    setLoading(true)
    try {
      const [productRes, codeRes, paymentRes] = await Promise.all([
        getSellerCodexMarketProducts(props.sellerId),
        getSellerCodexMarketCodes(undefined, props.sellerId),
        getSellerCodexMarketPayments(props.sellerId),
      ])
      if (productRes.success) setProducts(productRes.data || [])
      if (codeRes.success) setCodes(codeRes.data || [])
      if (paymentRes.success) setPayments(paymentRes.data || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载市场数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.sellerId])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setProductOpen(true)
  }

  const openEdit = (product: CodexMarketProduct) => {
    setEditing(product)
    setForm({
      title: product.title,
      description: product.description || '',
      models: product.models || MODEL_LIST.join(','),
      quotaUsd: quotaToUsd(product.quota),
      keyRpm: String(product.key_rpm || 0),
      paymentType: product.payment_type || 'text',
      paymentText: product.payment_text || '',
      paymentUrl: product.payment_url || '',
      paymentConfirmText: product.payment_confirm_text || '',
      status: product.status || 2,
    })
    setProductOpen(true)
  }

  const saveProduct = async () => {
    const payload = {
      title: form.title,
      description: form.description,
      models: form.models,
      quota: usdToQuota(form.quotaUsd),
      key_rpm: Math.max(0, Number.parseInt(form.keyRpm, 10) || 0),
      payment_type: form.paymentType,
      payment_text: form.paymentText,
      payment_url: form.paymentUrl,
      payment_confirm_text: form.paymentConfirmText,
      status: form.status,
      seller_id: props.sellerId,
    }
    const res = editing
      ? await updateSellerCodexMarketProduct(editing.id, payload)
      : await createSellerCodexMarketProduct(payload)
    if (!res.success) {
      toast.error(res.message || '保存失败')
      return
    }
    setProductOpen(false)
    await load()
  }

  const openGenerateCodes = (product: CodexMarketProduct) => {
    setCodeProductId(product.id)
    setCodeQuotaUsd(quotaToUsd(product.quota))
    setCodeRpm(String(product.key_rpm || 0))
    setCodeCount('1')
    setCodeExpiredAt('')
    setGeneratedCodes([])
    setCodeOpen(true)
  }

  const generateCodes = async () => {
    const productId = codeProductId
    const count = Number.parseInt(codeCount, 10)
    const res = await generateSellerCodexMarketCodes({
      product_id: productId,
      count: Number.isFinite(count) ? count : 1,
      quota: usdToQuota(codeQuotaUsd),
      key_rpm: Math.max(0, Number.parseInt(codeRpm, 10) || 0),
      expired_at: codeExpiredAt ? Math.floor(new Date(codeExpiredAt).getTime() / 1000) : undefined,
    })
    if (!res.success) {
      toast.error(res.message || '生成失败')
      return
    }
    const codes = res.data?.codes || []
    setGeneratedCodes(codes)
    if (codes.length > 0) {
      await navigator.clipboard.writeText(codes.join('\n'))
      toast.success('兑换码已生成并复制')
    }
    await load()
  }

  const exportCodes = async (params?: { product_id?: number; batch_id?: string }) => {
    const res = await exportSellerCodexMarketCodes({
      ...params,
      seller_id: props.sellerId,
    })
    if (!res.success) {
      toast.error(res.message || '导出失败')
      return
    }
    const codes = res.data?.codes || []
    await navigator.clipboard.writeText(codes.join('\n'))
    toast.success(`已复制 ${codes.length} 个兑换码`)
  }

  const codeStatusLabel = (code: CodexMarketCode) => {
    if (code.status === 1 && code.expired_at > 0 && code.expired_at < Math.floor(Date.now() / 1000)) return '已过期'
    if (code.status === 1) return '未用'
    if (code.status === 2) return '已兑换'
    return '失效'
  }

  const codeStatusVariant = (code: CodexMarketCode) => {
    if (code.status === 1 && code.expired_at > 0 && code.expired_at < Math.floor(Date.now() / 1000)) return 'destructive' as const
    if (code.status === 1) return 'secondary' as const
    if (code.status === 2) return 'default' as const
    return 'destructive' as const
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle className='text-base'>市场商品</CardTitle>
          <div className='flex gap-2'>
            <Button variant='ghost' size='sm' onClick={load} disabled={loading}>
              {loading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <RefreshCw className='mr-2 h-4 w-4' />}
              刷新
            </Button>
            <Button size='sm' onClick={openCreate}>
              <Plus className='mr-2 h-4 w-4' />
              新建商品
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {products.map((product) => (
              <div key={product.id} className='rounded-xl border p-4'>
                <div className='mb-2 flex items-start justify-between gap-3'>
                  <div>
                    <div className='font-medium'>{product.title}</div>
                    <div className='text-muted-foreground mt-1 text-xs'>
                      ${quotaToUsd(product.quota)} · RPM {product.key_rpm || '不限'} · {product.models}
                    </div>
                  </div>
                  <Badge variant={product.status === 1 ? 'default' : 'secondary'}>
                    {product.status === 1 ? '上架' : '下架'}
                  </Badge>
                </div>
                <p className='text-muted-foreground line-clamp-3 min-h-12 text-sm'>
                  {product.description || '暂无说明'}
                </p>
                <div className='text-muted-foreground mt-3 text-xs'>
                  未兑换码 {product.available_codes || 0} 个
                </div>
                <div className='mt-4 flex flex-wrap justify-end gap-2'>
                  <Button variant='outline' size='sm' onClick={() => openGenerateCodes(product)}>
                    <Ticket className='mr-2 h-4 w-4' />
                    生成兑换码
                  </Button>
                  <Button variant='ghost' size='sm' onClick={() => exportCodes({ product_id: product.id })}>
                    导出码
                  </Button>
                  <Button variant='ghost' size='sm' onClick={() => openEdit(product)}>
                    编辑
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={async () => {
                      await updateSellerCodexMarketProduct(product.id, {
                        ...product,
                        status: product.status === 1 ? 2 : 1,
                      })
                      await load()
                    }}
                  >
                    {product.status === 1 ? '下架' : '上架'}
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={async () => {
                      if (!window.confirm('确认删除该商品？已生成兑换码不会自动删除。')) return
                      await deleteSellerCodexMarketProduct(product.id)
                      await load()
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
            {products.length === 0 && (
              <div className='text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm md:col-span-2 xl:col-span-3'>
                暂无商品，先创建一个商品并生成兑换码。
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex items-center justify-between gap-2'>
            <CardTitle className='text-base'>最近兑换码</CardTitle>
            <Button variant='ghost' size='sm' onClick={() => exportCodes()}>
              批量导出
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
            {codes.slice(0, 60).map((code) => (
              <div key={code.id} className='rounded-lg border px-3 py-2 text-sm'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='font-mono text-xs'>{code.code_preview}</span>
                  <Badge variant={codeStatusVariant(code)}>
                    {codeStatusLabel(code)}
                  </Badge>
                </div>
                <div className='text-muted-foreground mt-1 text-xs'>
                  {productMap.get(code.product_id)?.title || `商品 #${code.product_id}`} · ${quotaToUsd(code.quota)} · RPM {code.key_rpm || '不限'}
                </div>
                {code.batch_id && (
                  <div className='text-muted-foreground mt-1 break-all text-[11px]'>
                    批次 {code.batch_id}
                  </div>
                )}
                <div className='mt-2 flex justify-end gap-1'>
                  {code.batch_id && (
                    <Button variant='ghost' size='sm' onClick={() => exportCodes({ batch_id: code.batch_id })}>
                      导出批次
                    </Button>
                  )}
                  {code.status === 1 && (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={async () => {
                        if (!window.confirm('确认作废该兑换码？')) return
                        const res = await disableSellerCodexMarketCode(code.id)
                        if (!res.success) toast.error(res.message || '作废失败')
                        await load()
                      }}
                    >
                      作废
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>支付确认</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid gap-2'>
            {payments.slice(0, 80).map((payment) => (
              <div key={payment.id} className='rounded-lg border px-3 py-2 text-sm'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='font-medium'>{payment.product_title || `商品 #${payment.product_id}`}</div>
                  <Badge variant={payment.status === 1 ? 'secondary' : payment.status === 2 ? 'default' : 'destructive'}>
                    {payment.status === 1 ? '待确认' : payment.status === 2 ? '已通过' : '已拒绝'}
                  </Badge>
                </div>
                <div className='text-muted-foreground mt-1 text-xs'>
                  买家 {payment.buyer_display_name || payment.buyer_username || `#${payment.buyer_id}`} · ${quotaToUsd(payment.quota)} · RPM {payment.key_rpm || '不限'}
                </div>
                <div className='text-muted-foreground mt-2 whitespace-pre-wrap break-words text-xs'>
                  联系方式：{payment.contact || '-'}；凭证：{payment.proof || '-'}
                </div>
                {payment.message && (
                  <div className='text-muted-foreground mt-1 whitespace-pre-wrap break-words text-xs'>
                    备注：{payment.message}
                  </div>
                )}
                {payment.status === 1 && (
                  <div className='mt-2 flex justify-end gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={async () => {
                        const res = await reviewSellerCodexMarketPayment(payment.id, { status: 3, message: '支付未确认' })
                        if (!res.success) toast.error(res.message || '操作失败')
                        await load()
                      }}
                    >
                      拒绝
                    </Button>
                    <Button
                      size='sm'
                      onClick={async () => {
                        const res = await reviewSellerCodexMarketPayment(payment.id, { status: 2 })
                        if (!res.success) {
                          toast.error(res.message || '确认失败')
                          return
                        }
                        toast.success('已确认，买家可复制市场 Key')
                        await load()
                      }}
                    >
                      确认并发 Key
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {payments.length === 0 && (
              <div className='text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm'>
                暂无支付确认。
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={productOpen} onOpenChange={setProductOpen}>
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑市场商品' : '新建市场商品'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-3'>
            <Label>商品名称</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Label>商品说明</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Label>可用模型（逗号分隔）</Label>
            <Input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} />
            <Label>默认兑换额度（USD 面值）</Label>
            <Input value={form.quotaUsd} onChange={(e) => setForm({ ...form, quotaUsd: e.target.value })} />
            <Label>默认 Key RPM（0 为不限）</Label>
            <Input value={form.keyRpm} onChange={(e) => setForm({ ...form, keyRpm: e.target.value })} />
            <Label>外部支付方式</Label>
            <Input value={form.paymentType} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} placeholder='text 或 link' />
            <Label>支付说明 / 联系方式</Label>
            <Textarea value={form.paymentText} onChange={(e) => setForm({ ...form, paymentText: e.target.value })} />
            <Label>支付链接（可选）</Label>
            <Input value={form.paymentUrl} onChange={(e) => setForm({ ...form, paymentUrl: e.target.value })} />
            <Label>支付确认说明（可选）</Label>
            <Textarea value={form.paymentConfirmText} onChange={(e) => setForm({ ...form, paymentConfirmText: e.target.value })} />
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={form.status === 1}
                onChange={(e) => setForm({ ...form, status: e.target.checked ? 1 : 2 })}
              />
              上架商品
            </label>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setProductOpen(false)}>取消</Button>
            <Button onClick={saveProduct}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>生成兑换码</DialogTitle>
          </DialogHeader>
          <div className='grid gap-3'>
            <Label>数量</Label>
            <Input value={codeCount} onChange={(e) => setCodeCount(e.target.value)} />
            <Label>每个兑换码额度（USD 面值）</Label>
            <Input value={codeQuotaUsd} onChange={(e) => setCodeQuotaUsd(e.target.value)} />
            <Label>每个兑换码 Key RPM（0 为不限）</Label>
            <Input value={codeRpm} onChange={(e) => setCodeRpm(e.target.value)} />
            <Label>过期时间（可选）</Label>
            <Input type='datetime-local' value={codeExpiredAt} onChange={(e) => setCodeExpiredAt(e.target.value)} />
            {generatedCodes.length > 0 && (
              <div className='rounded-lg border p-3'>
                <div className='mb-2 flex items-center justify-between'>
                  <span className='text-sm font-medium'>本次生成</span>
                  <Button variant='ghost' size='sm' onClick={() => navigator.clipboard.writeText(generatedCodes.join('\n'))}>
                    <Copy className='mr-2 h-4 w-4' />
                    复制
                  </Button>
                </div>
                <Textarea className='max-h-56 font-mono text-xs' readOnly value={generatedCodes.join('\n')} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCodeOpen(false)}>关闭</Button>
            <Button onClick={generateCodes}>生成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
