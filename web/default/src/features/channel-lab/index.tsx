import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CHANNEL_TYPE_OPTIONS } from '@/features/channels/constants'
import {
  fetchChannelLabModels,
  testAllChannelLabModels,
  testChannelLabModel,
  type ChannelLabAttempt,
  type ChannelLabPayload,
  type ChannelLabTestResult,
} from './api'

const ENDPOINT_OPTIONS = [
  { value: 'auto', label: '自动检测' },
  { value: 'openai', label: 'Chat Completions' },
  { value: 'openai-response', label: 'Responses' },
  { value: 'embeddings', label: 'Embeddings' },
  { value: 'image-generation', label: 'Images' },
  { value: 'anthropic', label: 'Anthropic Messages' },
  { value: 'gemini', label: 'Gemini GenerateContent' },
  { value: 'jina-rerank', label: 'Rerank' },
]

function safeJson(value: unknown) {
  if (value == null || value === '') return '-'
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

function resultKey(item: ChannelLabTestResult) {
  return `${item.model}:${item.endpoint_type}:${item.success ? 'ok' : 'fail'}`
}

export function ChannelLab() {
  const [type, setType] = useState(1)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [proxy, setProxy] = useState('')
  const [skipTLSVerify, setSkipTLSVerify] = useState(false)
  const [endpointType, setEndpointType] = useState('auto')
  const [stream, setStream] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [manualModels, setManualModels] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [fetching, setFetching] = useState(false)
  const [testingModel, setTestingModel] = useState('')
  const [testingAll, setTestingAll] = useState(false)
  const [successResults, setSuccessResults] = useState<ChannelLabTestResult[]>([])
  const [failedResults, setFailedResults] = useState<ChannelLabTestResult[]>([])
  const [detail, setDetail] = useState<ChannelLabTestResult | null>(null)

  const mergedModels = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of [...models, ...manualModels.split(/\n|,/g)]) {
      const name = item.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
    return out
  }, [manualModels, models])

  const basePayload = (): ChannelLabPayload => ({
    base_url: baseUrl.trim(),
    type,
    key: apiKey.trim(),
    proxy: proxy.trim(),
    skip_tls_verify: skipTLSVerify,
    endpoint_type: endpointType === 'auto' ? '' : endpointType,
    stream,
  })

  const handleFetchModels = async () => {
    setFetching(true)
    try {
      const res = await fetchChannelLabModels(basePayload())
      if (!res.success) throw new Error(res.message || '拉取模型失败')
      const list = res.data || []
      setModels(list)
      if (!selectedModel && list[0]) setSelectedModel(list[0])
      toast.success(`已拉取 ${list.length} 个模型`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '拉取模型失败')
    } finally {
      setFetching(false)
    }
  }

  const upsertResult = (item: ChannelLabTestResult) => {
    setSuccessResults((prev) =>
      item.success
        ? [item, ...prev.filter((x) => x.model !== item.model)]
        : prev.filter((x) => x.model !== item.model)
    )
    setFailedResults((prev) =>
      item.success
        ? prev.filter((x) => x.model !== item.model)
        : [item, ...prev.filter((x) => x.model !== item.model)]
    )
  }

  const handleTestModel = async (modelName = selectedModel) => {
    if (!modelName) {
      toast.error('请先选择模型')
      return
    }
    setTestingModel(modelName)
    try {
      const res = await testChannelLabModel({ ...basePayload(), model: modelName })
      upsertResult(res)
      setDetail(res)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '测试失败')
    } finally {
      setTestingModel('')
    }
  }

  const handleTestAll = async () => {
    if (mergedModels.length === 0) {
      toast.error('请先拉取或手动填写模型')
      return
    }
    setTestingAll(true)
    try {
      const res = await testAllChannelLabModels({
        ...basePayload(),
        models: mergedModels,
      })
      if (!res.success) throw new Error(res.message || '批量测试失败')
      setSuccessResults(res.data?.success || [])
      setFailedResults(res.data?.failed || [])
      toast.success(
        `测试完成：成功 ${res.data?.success?.length || 0}，失败 ${res.data?.failed?.length || 0}`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量测试失败')
    } finally {
      setTestingAll(false)
    }
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>渠道测试场</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        临时检测上游 Base URL、API Key、模型列表与端点可用性，不创建正式渠道，不进入用户可用模型。
      </SectionPageLayout.Description>
      <SectionPageLayout.Content>
        <div className='grid gap-4 xl:grid-cols-[420px_1fr]'>
          <Card>
            <CardHeader>
              <CardTitle>临时渠道信息</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label>渠道类型</Label>
                <Select value={String(type)} onValueChange={(value) => setType(Number(value))}>
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_TYPE_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={String(item.value)}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-2'>
                <Label>Base URL</Label>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder='留空使用该类型默认地址'
                />
              </div>
              <div className='space-y-2'>
                <Label>API Key</Label>
                <Textarea
                  className='min-h-24 font-mono text-xs'
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder='只用于本次测试，不保存'
                />
              </div>
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-2'>
                  <Label>代理 URL</Label>
                  <Input value={proxy} onChange={(event) => setProxy(event.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label>端点</Label>
                  <Select value={endpointType} onValueChange={setEndpointType}>
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENDPOINT_OPTIONS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className='flex flex-wrap gap-4 text-sm'>
                <label className='flex items-center gap-2'>
                  <Checkbox
                    checked={skipTLSVerify}
                    onCheckedChange={(checked) => setSkipTLSVerify(checked === true)}
                  />
                  跳过 TLS 校验
                </label>
                <label className='flex items-center gap-2'>
                  <Checkbox
                    checked={stream}
                    onCheckedChange={(checked) => setStream(checked === true)}
                  />
                  流式测试
                </label>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button onClick={handleFetchModels} disabled={fetching}>
                  {fetching ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <Search className='h-4 w-4' />
                  )}
                  拉取模型
                </Button>
                <Button
                  variant='outline'
                  onClick={() => handleTestModel()}
                  disabled={!selectedModel || !!testingModel || testingAll}
                >
                  {testingModel ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <Send className='h-4 w-4' />
                  )}
                  测试选中模型
                </Button>
                <Button
                  variant='outline'
                  onClick={handleTestAll}
                  disabled={mergedModels.length === 0 || testingAll}
                >
                  {testingAll ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <RefreshCw className='h-4 w-4' />
                  )}
                  一键全部测试
                </Button>
              </div>
              <div className='space-y-2'>
                <Label>手动补充模型（逗号或换行分隔）</Label>
                <Textarea
                  className='min-h-24 font-mono text-xs'
                  value={manualModels}
                  onChange={(event) => setManualModels(event.target.value)}
                  placeholder='例如 gpt-5.5, claude-sonnet-4-5'
                />
              </div>
            </CardContent>
          </Card>

          <div className='space-y-4'>
            <Card>
              <CardHeader>
                <CardTitle>模型池</CardTitle>
              </CardHeader>
              <CardContent>
                {mergedModels.length === 0 ? (
                  <div className='text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm'>
                    先点击“拉取模型”，或手动输入待测模型。
                  </div>
                ) : (
                  <div className='flex max-h-56 flex-wrap gap-2 overflow-auto'>
                    {mergedModels.map((modelName) => (
                      <button
                        key={modelName}
                        type='button'
                        onClick={() => setSelectedModel(modelName)}
                        onDoubleClick={() => handleTestModel(modelName)}
                        className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                          selectedModel === modelName
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'hover:bg-accent'
                        }`}
                      >
                        {modelName}
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className='grid gap-4 lg:grid-cols-2'>
              <ResultColumn
                title='成功模型'
                tone='success'
                items={successResults}
                busyModel={testingModel}
                onOpen={setDetail}
                onRetest={handleTestModel}
              />
              <ResultColumn
                title='失败模型'
                tone='danger'
                items={failedResults}
                busyModel={testingModel}
                onOpen={setDetail}
                onRetest={handleTestModel}
              />
            </div>
          </div>
        </div>

        <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
          <DialogContent className='max-h-[86vh] overflow-hidden sm:max-w-5xl'>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2'>
                测试详情
                {detail && (
                  <Badge variant={detail.success ? 'default' : 'destructive'}>
                    {detail.success ? '成功' : '失败'}
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>
            {detail && <DetailView result={detail} />}
          </DialogContent>
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function ResultColumn({
  title,
  tone,
  items,
  busyModel,
  onOpen,
  onRetest,
}: {
  title: string
  tone: 'success' | 'danger'
  items: ChannelLabTestResult[]
  busyModel: string
  onOpen: (item: ChannelLabTestResult) => void
  onRetest: (model: string) => void
}) {
  const Icon = tone === 'success' ? CheckCircle2 : CircleAlert
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center justify-between'>
          <span className='flex items-center gap-2'>
            <Icon
              className={`h-4 w-4 ${
                tone === 'success' ? 'text-emerald-500' : 'text-destructive'
              }`}
            />
            {title}
          </span>
          <Badge variant='secondary'>{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className='text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm'>
            暂无结果
          </div>
        ) : (
          <div className='max-h-[520px] space-y-2 overflow-auto pr-1'>
            {items.map((item) => (
              <div
                key={resultKey(item)}
                className='hover:bg-accent/60 rounded-lg border p-3 transition'
              >
                <button
                  type='button'
                  className='block w-full text-left'
                  onClick={() => onOpen(item)}
                >
                  <div className='break-all text-sm font-medium'>{item.model}</div>
                  <div className='text-muted-foreground mt-1 line-clamp-2 text-xs'>
                    {item.message || '-'}
                  </div>
                  <div className='mt-2 flex flex-wrap gap-2 text-xs'>
                    <Badge variant='outline'>{item.endpoint_type || 'auto'}</Badge>
                    <Badge variant='outline'>{item.time.toFixed(2)}s</Badge>
                  </div>
                </button>
                <Button
                  className='mt-2'
                  size='sm'
                  variant='ghost'
                  onClick={() => onRetest(item.model)}
                  disabled={busyModel === item.model}
                >
                  {busyModel === item.model && <Loader2 className='h-3 w-3 animate-spin' />}
                  再测一次
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DetailView({ result }: { result: ChannelLabTestResult }) {
  const detail = result.detail
  const attempts = result.attempts || []
  return (
    <div className='min-h-0 overflow-auto pr-2'>
      <div className='grid gap-3 text-sm md:grid-cols-2'>
        <InfoItem label='模型' value={result.model} />
        <InfoItem label='最终端点' value={result.endpoint_type || '-'} />
        <InfoItem label='耗时' value={`${result.time.toFixed(2)}s`} />
        <InfoItem label='状态' value={result.success ? '成功' : '失败'} />
        <InfoItem label='请求路径' value={detail?.request_path || '-'} />
        <InfoItem label='请求 URL' value={detail?.request_url || '-'} />
        <InfoItem label='HTTP 状态' value={String(detail?.response_status || '-')} />
        <InfoItem label='错误码' value={detail?.error_code || '-'} />
      </div>
      {attempts.length > 1 && (
        <div className='mt-4'>
          <div className='mb-2 text-sm font-medium'>自动检测尝试</div>
          <div className='flex flex-wrap gap-2'>
            {attempts.map((attempt: ChannelLabAttempt) => (
              <Badge
                key={`${attempt.endpoint_type}-${attempt.success ? 'ok' : 'fail'}`}
                variant={attempt.success ? 'default' : 'destructive'}
              >
                {attempt.endpoint_type}: {attempt.success ? '成功' : '失败'}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <DetailBlock title='请求体' content={safeJson(detail?.request_body)} />
      <DetailBlock title='响应内容' content={safeJson(detail?.response_body)} />
      <DetailBlock title='错误信息' content={detail?.error_message || result.message || '-'} />
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md border px-3 py-2'>
      <div className='text-muted-foreground text-xs'>{label}</div>
      <div className='mt-1 break-all font-mono text-xs'>{value}</div>
    </div>
  )
}

function DetailBlock({ title, content }: { title: string; content: string }) {
  return (
    <div className='mt-4'>
      <div className='mb-2 text-sm font-medium'>{title}</div>
      <pre className='bg-muted max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap'>
        {content}
      </pre>
    </div>
  )
}
