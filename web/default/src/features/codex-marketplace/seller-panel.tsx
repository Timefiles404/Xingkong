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
  generateSellerCodexMarketCodes,
  getSellerCodexMarketCodes,
  getSellerCodexMarketProducts,
  quotaToUsd,
  updateSellerCodexMarketProduct,
  usdToQuota,
  type CodexMarketCode,
  type CodexMarketProduct,
} from './api'

const MODEL_LIST = ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark']

type ProductForm = {
  title: string
  description: string
  models: string
  quotaUsd: string
  paymentType: string
  paymentText: string
  paymentUrl: string
  status: number
}

const emptyForm: ProductForm = {
  title: '',
  description: '',
  models: MODEL_LIST.join(','),
  quotaUsd: '10',
  paymentType: 'text',
  paymentText: '',
  paymentUrl: '',
  status: 2,
}

export function CodexMarketplaceSellerPanel(props: { sellerId?: number }) {
  const [products, setProducts] = useState<CodexMarketProduct[]>([])
  const [codes, setCodes] = useState<CodexMarketCode[]>([])
  const [loading, setLoading] = useState(false)
  const [productOpen, setProductOpen] = useState(false)
  const [editing, setEditing] = useState<CodexMarketProduct | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeProductId, setCodeProductId] = useState(0)
  const [codeCount, setCodeCount] = useState('1')
  const [codeQuotaUsd, setCodeQuotaUsd] = useState('')
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([])

  const productMap = useMemo(
    () => new Map(products.map((item) => [item.id, item])),
    [products]
  )

  const load = async () => {
    setLoading(true)
    try {
      const [productRes, codeRes] = await Promise.all([
        getSellerCodexMarketProducts(props.sellerId),
        getSellerCodexMarketCodes(undefined, props.sellerId),
      ])
      if (productRes.success) setProducts(productRes.data || [])
      if (codeRes.success) setCodes(codeRes.data || [])
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
      paymentType: product.payment_type || 'text',
      paymentText: product.payment_text || '',
      paymentUrl: product.payment_url || '',
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
      payment_type: form.paymentType,
      payment_text: form.paymentText,
      payment_url: form.paymentUrl,
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
    setCodeCount('1')
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
                      ${quotaToUsd(product.quota)} · {product.models}
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
          <CardTitle className='text-base'>最近兑换码</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
            {codes.slice(0, 60).map((code) => (
              <div key={code.id} className='rounded-lg border px-3 py-2 text-sm'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='font-mono text-xs'>{code.code_preview}</span>
                  <Badge variant={code.status === 1 ? 'secondary' : code.status === 2 ? 'default' : 'destructive'}>
                    {code.status === 1 ? '未用' : code.status === 2 ? '已兑换' : '失效'}
                  </Badge>
                </div>
                <div className='text-muted-foreground mt-1 text-xs'>
                  {productMap.get(code.product_id)?.title || `商品 #${code.product_id}`} · ${quotaToUsd(code.quota)}
                </div>
              </div>
            ))}
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
            <Label>外部支付方式</Label>
            <Input value={form.paymentType} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} placeholder='text 或 link' />
            <Label>支付说明 / 联系方式</Label>
            <Textarea value={form.paymentText} onChange={(e) => setForm({ ...form, paymentText: e.target.value })} />
            <Label>支付链接（可选）</Label>
            <Input value={form.paymentUrl} onChange={(e) => setForm({ ...form, paymentUrl: e.target.value })} />
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
