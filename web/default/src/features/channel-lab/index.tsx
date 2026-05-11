import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  FileText,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
  Table2,
  UploadCloud,
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
  importChannelLabCPAChannels,
  testChannelLabModel,
  type ChannelLabAttempt,
  type ChannelLabCPAImportItem,
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

type TestStatus = 'pending' | 'running' | 'success' | 'failed'

const CSV_TARGET_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
]

type CsvModelStatus = {
  status: TestStatus
  endpointType?: string
  message?: string
}

type CsvChannelRow = {
  id: string
  baseUrl: string
  rawKey: string
  key: string
  declaredModels: string[]
  status: TestStatus
  message?: string
  endpointTypes: string[]
  availableModels: string[]
  modelStatuses: Record<string, CsvModelStatus>
  imported?: boolean
  importedName?: string
}

function clampConcurrency(value: string) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return 4
  return Math.min(20, Math.max(1, parsed))
}

function normalizeCsvKey(key: string) {
  return key.trim().replace(/^sk-/, '')
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      i += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function parseCsvChannelRows(text: string): CsvChannelRow[] {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  const startIndex = lines[0]?.includes('访问地址') ? 1 : 0
  const rows: CsvChannelRow[] = []
  for (let index = startIndex; index < lines.length; index += 1) {
    const cells = parseCsvLine(lines[index] || '')
    const baseUrl = (cells[0] || '').trim()
    const rawKey = (cells[1] || '').trim()
    if (!baseUrl || !rawKey) continue
    const declaredRaw = (cells[2] || '').trim()
    const declaredModels =
      declaredRaw === '(empty)' || declaredRaw === 'empty'
        ? []
        : declaredRaw
            .split(',')
            .map((modelName) => modelName.trim())
            .filter(Boolean)
    rows.push({
      id: `${Date.now()}-${index}-${baseUrl}`,
      baseUrl,
      rawKey,
      key: normalizeCsvKey(rawKey),
      declaredModels,
      status: 'pending',
      endpointTypes: [],
      availableModels: [],
      modelStatuses: Object.fromEntries(
        CSV_TARGET_MODELS.map((modelName) => [modelName, { status: 'pending' as TestStatus }])
      ),
    })
  }
  return rows
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
  const [concurrency, setConcurrency] = useState('4')
  const [fetching, setFetching] = useState(false)
  const [testingModel, setTestingModel] = useState('')
  const [testingAll, setTestingAll] = useState(false)
  const [testingModels, setTestingModels] = useState<Set<string>>(() => new Set())
  const [testStatuses, setTestStatuses] = useState<Record<string, TestStatus>>({})
  const [successResults, setSuccessResults] = useState<ChannelLabTestResult[]>([])
  const [failedResults, setFailedResults] = useState<ChannelLabTestResult[]>([])
  const [detail, setDetail] = useState<ChannelLabTestResult | null>(null)
  const [csvText, setCsvText] = useState('')
  const [csvRows, setCsvRows] = useState<CsvChannelRow[]>([])
  const [csvTesting, setCsvTesting] = useState(false)
  const [csvImporting, setCsvImporting] = useState(false)

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

  const csvImportableRows = useMemo(
    () => csvRows.filter((row) => row.availableModels.length > 0 && !row.imported),
    [csvRows]
  )

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
    setTestingModels((prev) => new Set(prev).add(modelName))
    setTestStatuses((prev) => ({ ...prev, [modelName]: 'running' }))
    try {
      const res = await testChannelLabModel({ ...basePayload(), model: modelName })
      upsertResult(res)
      setTestStatuses((prev) => ({
        ...prev,
        [modelName]: res.success ? 'success' : 'failed',
      }))
      setDetail(res)
    } catch (error) {
      const failed = buildLocalFailedResult(modelName, error)
      upsertResult(failed)
      setTestStatuses((prev) => ({ ...prev, [modelName]: 'failed' }))
      toast.error(error instanceof Error ? error.message : '测试失败')
    } finally {
      setTestingModel('')
      setTestingModels((prev) => {
        const next = new Set(prev)
        next.delete(modelName)
        return next
      })
    }
  }

  const handleTestAll = async () => {
    if (mergedModels.length === 0) {
      toast.error('请先拉取或手动填写模型')
      return
    }
    const payload = basePayload()
    const queue = [...mergedModels]
    const workerCount = Math.min(clampConcurrency(concurrency), queue.length)
    let cursor = 0
    let successCount = 0
    let failedCount = 0

    setSuccessResults([])
    setFailedResults([])
    setDetail(null)
    setTestStatuses(
      Object.fromEntries(queue.map((modelName) => [modelName, 'pending' as TestStatus]))
    )
    setTestingAll(true)
    try {
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (cursor < queue.length) {
            const modelName = queue[cursor]
            cursor += 1
            setTestingModels((prev) => new Set(prev).add(modelName))
            setTestStatuses((prev) => ({ ...prev, [modelName]: 'running' }))
            try {
              const res = await testChannelLabModel({ ...payload, model: modelName })
              upsertResult(res)
              if (res.success) successCount += 1
              else failedCount += 1
              setTestStatuses((prev) => ({
                ...prev,
                [modelName]: res.success ? 'success' : 'failed',
              }))
            } catch (error) {
              const failed = buildLocalFailedResult(modelName, error)
              upsertResult(failed)
              failedCount += 1
              setTestStatuses((prev) => ({ ...prev, [modelName]: 'failed' }))
            } finally {
              setTestingModels((prev) => {
                const next = new Set(prev)
                next.delete(modelName)
                return next
              })
            }
          }
        })
      )
      toast.success(`测试完成：成功 ${successCount}，失败 ${failedCount}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量测试失败')
    } finally {
      setTestingAll(false)
      setTestingModels(new Set())
    }
  }

  const updateCsvRow = (rowId: string, updater: (row: CsvChannelRow) => CsvChannelRow) => {
    setCsvRows((prev) => prev.map((row) => (row.id === rowId ? updater(row) : row)))
  }

  const handleCsvFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      setCsvText(text)
      const rows = parseCsvChannelRows(text)
      setCsvRows(rows)
      toast.success(`已读取 ${rows.length} 条 CSV 渠道`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取 CSV 文件失败')
    }
  }

  const handleParseCsv = () => {
    try {
      const rows = parseCsvChannelRows(csvText)
      setCsvRows(rows)
      toast.success(`已解析 ${rows.length} 条 CSV 渠道`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '解析 CSV 失败')
    }
  }

  const handleCsvBatchTest = async () => {
    let rows = csvRows
    if (rows.length === 0) {
      try {
        rows = parseCsvChannelRows(csvText)
        setCsvRows(rows)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '解析 CSV 失败')
        return
      }
    }
    if (rows.length === 0) {
      toast.error('没有可测试的 CSV 渠道')
      return
    }

    const workerCount = Math.min(clampConcurrency(concurrency), rows.length)
    const payloadBase = basePayload()
    let cursor = 0
    let usableCount = 0
    setCsvTesting(true)
    setCsvRows((prev) =>
      prev.map((row) => ({
        ...row,
        status: 'pending',
        message: '',
        endpointTypes: [],
        availableModels: [],
        imported: false,
        importedName: undefined,
        modelStatuses: Object.fromEntries(
          CSV_TARGET_MODELS.map((modelName) => [modelName, { status: 'pending' as TestStatus }])
        ),
      }))
    )

    try {
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (cursor < rows.length) {
            const row = rows[cursor]
            cursor += 1
            updateCsvRow(row.id, (current) => ({
              ...current,
              status: 'running',
              message: '正在测试目标模型',
            }))

            const availableModels: string[] = []
            const endpointSet = new Set<string>()
            const modelStatuses: Record<string, CsvModelStatus> = {}
            for (const modelName of CSV_TARGET_MODELS) {
              updateCsvRow(row.id, (current) => ({
                ...current,
                modelStatuses: {
                  ...current.modelStatuses,
                  [modelName]: { status: 'running' },
                },
              }))
              try {
                const res = await testChannelLabModel({
                  ...payloadBase,
                  base_url: row.baseUrl,
                  key: row.key,
                  model: modelName,
                })
                if (res.success) {
                  availableModels.push(modelName)
                  endpointSet.add(res.endpoint_type || 'auto')
                }
                modelStatuses[modelName] = {
                  status: res.success ? 'success' : 'failed',
                  endpointType: res.endpoint_type,
                  message: res.message,
                }
              } catch (error) {
                modelStatuses[modelName] = {
                  status: 'failed',
                  message: error instanceof Error ? error.message : '测试失败',
                }
              }
              updateCsvRow(row.id, (current) => ({
                ...current,
                modelStatuses: {
                  ...current.modelStatuses,
                  [modelName]: modelStatuses[modelName],
                },
              }))
            }

            if (availableModels.length > 0) usableCount += 1
            updateCsvRow(row.id, (current) => ({
              ...current,
              status: availableModels.length > 0 ? 'success' : 'failed',
              message:
                availableModels.length > 0
                  ? `可用 ${availableModels.length} 个目标模型`
                  : '四个目标模型均不可用',
              endpointTypes: Array.from(endpointSet),
              availableModels,
              modelStatuses: {
                ...current.modelStatuses,
                ...modelStatuses,
              },
            }))
          }
        })
      )
      toast.success(`CSV 批测完成：${usableCount}/${rows.length} 个渠道有可用目标模型`)
    } finally {
      setCsvTesting(false)
    }
  }

  const handleImportCsvCPAChannels = async () => {
    if (csvImportableRows.length === 0) {
      toast.error('没有可导入的可用渠道')
      return
    }
    const items: ChannelLabCPAImportItem[] = csvImportableRows.map((row) => ({
      client_id: row.id,
      base_url: row.baseUrl,
      type,
      key: row.key,
      proxy: proxy.trim(),
      skip_tls_verify: skipTLSVerify,
      available_models: row.availableModels,
      model_endpoint_types: Object.fromEntries(
        Object.entries(row.modelStatuses)
          .filter(([, value]) => value.status === 'success' && value.endpointType)
          .map(([modelName, value]) => [modelName, value.endpointType as string])
      ),
    }))
    setCsvImporting(true)
    try {
      const res = await importChannelLabCPAChannels(items)
      if (!res.success) throw new Error(res.message || '导入失败')
      const importedByClientId = new Map(
        (res.data?.items || []).map((item) => [item.client_id || '', item.name])
      )
      setCsvRows((prev) =>
        prev.map((row) => {
          const importedName = importedByClientId.get(row.id)
          return importedName
            ? { ...row, imported: true, importedName }
            : row
        })
      )
      toast.success(res.message || `已导入 ${res.data?.total || items.length} 个渠道`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setCsvImporting(false)
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
              <div className='space-y-2'>
                <Label>批量测试并发数</Label>
                <Input
                  value={concurrency}
                  onChange={(event) => setConcurrency(event.target.value)}
                  onBlur={() => setConcurrency(String(clampConcurrency(concurrency)))}
                  inputMode='numeric'
                  placeholder='1-20'
                />
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
                        <span className='break-all'>{modelName}</span>
                        {testStatuses[modelName] && (
                          <span className='mt-1 block'>
                            <StatusBadge status={testStatuses[modelName]} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {Object.keys(testStatuses).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className='flex items-center justify-between'>
                    <span>实时测试状态</span>
                    <Badge variant='secondary'>
                      {testingModels.size} 个正在测试，并发 {clampConcurrency(concurrency)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusSummary statuses={testStatuses} />
                </CardContent>
              </Card>
            )}

            <div className='grid gap-4 lg:grid-cols-2'>
              <ResultColumn
                title='成功模型'
                tone='success'
                items={successResults}
                busyModels={testingModels}
                onOpen={setDetail}
                onRetest={handleTestModel}
              />
              <ResultColumn
                title='失败模型'
                tone='danger'
                items={failedResults}
                busyModels={testingModels}
                onOpen={setDetail}
                onRetest={handleTestModel}
              />
            </div>
          </div>
        </div>

        <Card className='mt-4'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Table2 className='h-4 w-4' />
              CSV 批量探测与 CPA 导入
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid gap-4 lg:grid-cols-[1fr_260px]'>
              <div className='space-y-2'>
                <Label>CSV 内容</Label>
                <Textarea
                  className='min-h-36 font-mono text-xs'
                  value={csvText}
                  onChange={(event) => setCsvText(event.target.value)}
                  placeholder='访问地址,可用密钥,可用模型'
                />
              </div>
              <div className='space-y-3 rounded-lg border p-3'>
                <div className='text-sm font-medium'>固定测试模型</div>
                <div className='flex flex-wrap gap-2'>
                  {CSV_TARGET_MODELS.map((modelName) => (
                    <Badge key={modelName} variant='outline' className='font-mono'>
                      {modelName}
                    </Badge>
                  ))}
                </div>
                <label className='hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm transition'>
                  <UploadCloud className='h-4 w-4' />
                  读取 CSV 文件
                  <input
                    className='hidden'
                    type='file'
                    accept='.csv,text/csv,text/plain'
                    onChange={(event) => {
                      void handleCsvFile(event.target.files?.[0])
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                <div className='flex flex-wrap gap-2'>
                  <Button variant='outline' onClick={handleParseCsv}>
                    <FileText className='h-4 w-4' />
                    解析
                  </Button>
                  <Button onClick={handleCsvBatchTest} disabled={csvTesting}>
                    {csvTesting ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <RefreshCw className='h-4 w-4' />
                    )}
                    批量测试
                  </Button>
                </div>
                <Button
                  className='w-full'
                  variant='default'
                  onClick={handleImportCsvCPAChannels}
                  disabled={csvImporting || csvImportableRows.length === 0 || csvTesting}
                >
                  {csvImporting ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <PlusCircle className='h-4 w-4' />
                  )}
                  导入可用渠道到 CPA
                </Button>
                <div className='text-muted-foreground text-xs'>
                  导入时会自动去掉密钥开头的 sk-，渠道名为 auto-随机值-GPT/CLAUDE/GPTCLAUDE。
                </div>
              </div>
            </div>
            <CsvResultTable rows={csvRows} testing={csvTesting} />
          </CardContent>
        </Card>

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

function buildLocalFailedResult(modelName: string, error: unknown): ChannelLabTestResult {
  const message = error instanceof Error ? error.message : '测试失败'
  return {
    success: false,
    model: modelName,
    endpoint_type: 'local',
    message,
    time: 0,
    detail: {
      model: modelName,
      endpoint_type: 'local',
      request_path: '-',
      error_message: message,
      duration_ms: 0,
      stream: false,
      channel_type: 0,
      channel_type_name: '-',
      base_url: '-',
      detected_by: 'local',
    },
  }
}

function StatusBadge({ status }: { status: TestStatus }) {
  if (status === 'running') {
    return (
      <Badge variant='outline' className='gap-1'>
        <Loader2 className='h-3 w-3 animate-spin' />
        测试中
      </Badge>
    )
  }
  if (status === 'success') return <Badge variant='default'>成功</Badge>
  if (status === 'failed') return <Badge variant='destructive'>失败</Badge>
  return <Badge variant='secondary'>等待</Badge>
}

function CsvResultTable({
  rows,
  testing,
}: {
  rows: CsvChannelRow[]
  testing: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm'>
        CSV 解析或测试后，会在这里显示端点地址、端点类型和四个目标模型的实际可用情况。
      </div>
    )
  }
  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='bg-muted/50 grid grid-cols-[minmax(220px,1.2fr)_140px_minmax(260px,1fr)_110px] gap-3 px-3 py-2 text-xs font-medium'>
        <div>端点地址</div>
        <div>端点类型</div>
        <div>实际可用模型</div>
        <div>状态</div>
      </div>
      <div className='divide-y'>
        {rows.map((row) => (
          <div
            key={row.id}
            className='grid grid-cols-[minmax(220px,1.2fr)_140px_minmax(260px,1fr)_110px] gap-3 px-3 py-3 text-sm'
          >
            <div className='min-w-0'>
              <div className='break-all font-mono text-xs'>{row.baseUrl}</div>
              <div className='text-muted-foreground mt-1 text-xs'>
                CSV 声明 {row.declaredModels.length || 0} 个模型，Key 已去除 sk- 前缀
              </div>
            </div>
            <div className='flex flex-wrap content-start gap-1'>
              {row.endpointTypes.length === 0 ? (
                <span className='text-muted-foreground text-xs'>-</span>
              ) : (
                row.endpointTypes.map((endpointType) => (
                  <Badge key={endpointType} variant='outline'>
                    {endpointType}
                  </Badge>
                ))
              )}
            </div>
            <div className='space-y-2'>
              <div className='flex flex-wrap gap-1'>
                {row.availableModels.length === 0 ? (
                  <span className='text-muted-foreground text-xs'>暂无可用目标模型</span>
                ) : (
                  row.availableModels.map((modelName) => (
                    <Badge key={modelName} variant='default' className='font-mono'>
                      {modelName}
                    </Badge>
                  ))
                )}
              </div>
              <div className='flex flex-wrap gap-1'>
                {CSV_TARGET_MODELS.map((modelName) => {
                  const status = row.modelStatuses[modelName]?.status || 'pending'
                  return (
                    <Badge
                      key={modelName}
                      variant={
                        status === 'success'
                          ? 'default'
                          : status === 'failed'
                            ? 'destructive'
                            : 'outline'
                      }
                      className='font-mono text-[10px]'
                      title={row.modelStatuses[modelName]?.message || modelName}
                    >
                      {status === 'running' && <Loader2 className='h-3 w-3 animate-spin' />}
                      {modelName}
                    </Badge>
                  )
                })}
              </div>
            </div>
            <div className='flex flex-col items-start gap-1'>
              <StatusBadge status={row.status} />
              {row.imported && (
                <Badge variant='secondary' className='max-w-full truncate' title={row.importedName}>
                  已导入 {row.importedName}
                </Badge>
              )}
              {testing && row.status === 'running' && (
                <span className='text-muted-foreground text-xs'>测试中...</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusSummary({ statuses }: { statuses: Record<string, TestStatus> }) {
  const entries = Object.entries(statuses)
  const counts = entries.reduce(
    (acc, [, status]) => {
      acc[status] += 1
      return acc
    },
    { pending: 0, running: 0, success: 0, failed: 0 } as Record<TestStatus, number>
  )
  const running = entries.filter(([, status]) => status === 'running').map(([name]) => name)
  const pending = entries.filter(([, status]) => status === 'pending').map(([name]) => name)

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-2'>
        <Badge variant='secondary'>等待 {counts.pending}</Badge>
        <Badge variant='outline'>测试中 {counts.running}</Badge>
        <Badge variant='default'>成功 {counts.success}</Badge>
        <Badge variant='destructive'>失败 {counts.failed}</Badge>
      </div>
      <div className='grid gap-3 md:grid-cols-2'>
        <StatusList title='正在测试' items={running} empty='暂无正在测试的模型' />
        <StatusList title='等待队列' items={pending.slice(0, 80)} empty='暂无等待模型' />
      </div>
    </div>
  )
}

function StatusList({
  title,
  items,
  empty,
}: {
  title: string
  items: string[]
  empty: string
}) {
  return (
    <div className='rounded-lg border p-3'>
      <div className='mb-2 text-sm font-medium'>{title}</div>
      {items.length === 0 ? (
        <div className='text-muted-foreground text-xs'>{empty}</div>
      ) : (
        <div className='max-h-32 space-y-1 overflow-auto pr-1'>
          {items.map((item) => (
            <div key={item} className='bg-muted/60 rounded px-2 py-1 font-mono text-xs'>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ResultColumn({
  title,
  tone,
  items,
  busyModels,
  onOpen,
  onRetest,
}: {
  title: string
  tone: 'success' | 'danger'
  items: ChannelLabTestResult[]
  busyModels: Set<string>
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
                  disabled={busyModels.has(item.model)}
                >
                  {busyModels.has(item.model) && <Loader2 className='h-3 w-3 animate-spin' />}
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
