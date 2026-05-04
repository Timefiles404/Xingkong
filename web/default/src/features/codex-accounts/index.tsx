import { useEffect, useMemo, useState } from 'react'
import {
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  addCodexSubagent,
  completeCodexAccountOAuth,
  createCodexProxyKey,
  deleteCodexAccount,
  deleteCodexProxyKey,
  deleteCodexSubagent,
  exportCodexAccounts,
  fetchCodexProxyKeySecret,
  getCodexAccountAccess,
  getCodexAccountUsage,
  getCodexAccounts,
  getCodexProxyKeys,
  getCodexProxyStats,
  getCodexSubagents,
  importCodexAccounts,
  refreshCodexAccount,
  startCodexAccountOAuth,
  updateCodexAccount,
  updateCodexProxyKey,
  type CodexAccount,
  type CodexAccountAccess,
  type CodexProxyKey,
  type CodexProxyStats,
  type CodexSubagent,
} from './api'

const QUOTA_PER_USD = 10000

function formatTime(ts?: number) {
  if (!ts || ts < 0) return '-'
  return new Date(ts * 1000).toLocaleString()
}

function formatCooldown(ts?: number) {
  if (!ts) return ''
  const seconds = Math.max(0, ts - Math.floor(Date.now() / 1000))
  if (seconds <= 0) return ''
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`
  return `${Math.ceil(seconds / 3600)}h`
}

function quotaToUsd(quota?: number) {
  return ((quota || 0) / QUOTA_PER_USD).toFixed(4)
}

function usdToQuota(value: string) {
  const usd = Number.parseFloat(value)
  if (!Number.isFinite(usd) || usd < 0) return 0
  return Math.round(usd * QUOTA_PER_USD)
}

function statNumber(value?: number) {
  return (value || 0).toLocaleString()
}

export function CodexAccounts() {
  const [access, setAccess] = useState<CodexAccountAccess | null>(null)
  const [accounts, setAccounts] = useState<CodexAccount[]>([])
  const [subagents, setSubagents] = useState<CodexSubagent[]>([])
  const [proxyKeys, setProxyKeys] = useState<CodexProxyKey[]>([])
  const [stats, setStats] = useState<CodexProxyStats | null>(null)
  const [selectedOwner, setSelectedOwner] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [oauthOpen, setOAuthOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [subagentOpen, setSubagentOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usageContent, setUsageContent] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [accountName, setAccountName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://chatgpt.com')
  const [proxy, setProxy] = useState('')
  const [importRaw, setImportRaw] = useState('')
  const [subagentUserId, setSubagentUserId] = useState('')
  const [keyName, setKeyName] = useState('Codex 托管密钥')
  const [keyUsd, setKeyUsd] = useState('100')
  const [keyUnlimited, setKeyUnlimited] = useState(false)
  const [editingAccount, setEditingAccount] = useState<CodexAccount | null>(null)
  const [editName, setEditName] = useState('')
  const [editBaseUrl, setEditBaseUrl] = useState('')
  const [editProxy, setEditProxy] = useState('')
  const [editPriority, setEditPriority] = useState('0')
  const [editNote, setEditNote] = useState('')
  const [editKey, setEditKey] = useState<CodexProxyKey | null>(null)
  const [editKeyName, setEditKeyName] = useState('')
  const [editKeyUsd, setEditKeyUsd] = useState('')
  const [editKeyUnlimited, setEditKeyUnlimited] = useState(false)

  const isAdmin = !!access?.is_admin
  const canUse = !!access && (access.is_admin || access.is_subagent)
  const ownerForRequest = isAdmin && selectedOwner >= 0 ? selectedOwner : undefined

  const enabledCount = useMemo(
    () => accounts.filter((item) => item.status === 1).length,
    [accounts]
  )

  const loadAccess = async () => {
    const res = await getCodexAccountAccess()
    if (res.success && res.data) setAccess(res.data)
  }

  const load = async () => {
    setLoading(true)
    try {
      const accountRes = await getCodexAccounts({
        page_size: 200,
        owner_user_id: ownerForRequest,
      })
      if (accountRes.success) setAccounts(accountRes.data?.items || [])
      const keyRes = await getCodexProxyKeys(ownerForRequest)
      if (keyRes.success) setProxyKeys(keyRes.data || [])
      const statRes = await getCodexProxyStats(ownerForRequest)
      if (statRes.success) setStats(statRes.data || null)
      if (isAdmin) {
        const subRes = await getCodexSubagents()
        if (subRes.success) setSubagents(subRes.data || [])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAccess()
  }, [])

  useEffect(() => {
    if (access) void load()
  }, [access, selectedOwner])

  const handleStartOAuth = async () => {
    const res = await startCodexAccountOAuth()
    if (!res.success || !res.data?.authorize_url) {
      toast.error(res.message || '无法创建授权链接')
      return
    }
    setAuthUrl(res.data.authorize_url)
    window.open(res.data.authorize_url, '_blank', 'noopener,noreferrer')
  }

  const handleCompleteOAuth = async () => {
    const res = await completeCodexAccountOAuth({
      input: callbackUrl,
      name: accountName,
      base_url: baseUrl,
      proxy,
      owner_user_id: ownerForRequest,
    })
    if (!res.success) {
      toast.error(res.message || '保存失败')
      return
    }
    toast.success('Codex 账号已保存')
    setOAuthOpen(false)
    setCallbackUrl('')
    setAccountName('')
    await load()
  }

  const handleImport = async () => {
    const res = await importCodexAccounts({
      raw: importRaw,
      base_url: baseUrl,
      proxy,
      owner_user_id: ownerForRequest,
    })
    if (!res.success) {
      toast.error(res.message || '导入失败')
      return
    }
    toast.success(`已导入 ${res.data?.imported || 0}/${res.data?.total || 0} 个账号`)
    setImportOpen(false)
    setImportRaw('')
    await load()
  }

  const handleExport = async () => {
    const res = await exportCodexAccounts(ownerForRequest)
    if (!res.success) {
      toast.error('导出失败')
      return
    }
    await navigator.clipboard.writeText(JSON.stringify(res.data || [], null, 2))
    toast.success('账号 JSON 已复制到剪贴板')
  }

  const addSubagent = async () => {
    const userId = Number.parseInt(subagentUserId, 10)
    if (!Number.isFinite(userId) || userId <= 0) {
      toast.error('请输入用户 ID')
      return
    }
    const res = await addCodexSubagent(userId)
    if (!res.success) {
      toast.error(res.message || '设置失败')
      return
    }
    toast.success('子代理已设置')
    setSubagentOpen(false)
    setSubagentUserId('')
    await load()
  }

  const removeSubagent = async (userId: number) => {
    if (!window.confirm('确认删除该子代理权限？账号和密钥不会自动删除。')) return
    const res = await deleteCodexSubagent(userId)
    if (!res.success) {
      toast.error(res.message || '删除失败')
      return
    }
    await load()
  }

  const handleImportFiles = async (files: FileList | null) => {
    const selected = Array.from(files || [])
    if (selected.length === 0) return
    try {
      const parsed = await Promise.all(
        selected.map(async (file) => JSON.parse(await file.text()) as unknown)
      )
      setImportRaw(JSON.stringify(parsed.length === 1 ? parsed[0] : parsed, null, 2))
      toast.success(`已读取 ${selected.length} 个 JSON 文件`)
    } catch (error) {
      toast.error(error instanceof Error ? `JSON 解析失败：${error.message}` : 'JSON 解析失败')
    }
  }

  const createKey = async () => {
    const res = await createCodexProxyKey({
      name: keyName,
      remain_quota: usdToQuota(keyUsd),
      unlimited_quota: keyUnlimited,
      expired_time: -1,
      owner_user_id: ownerForRequest,
    })
    if (!res.success) {
      toast.error(res.message || '创建失败')
      return
    }
    if (res.data?.key) {
      await navigator.clipboard.writeText(res.data.key)
      toast.success('密钥已创建并复制')
    }
    setKeyOpen(false)
    await load()
  }

  const saveKey = async () => {
    if (!editKey) return
    const res = await updateCodexProxyKey(editKey.id, {
      name: editKeyName,
      remain_quota: usdToQuota(editKeyUsd),
      unlimited_quota: editKeyUnlimited,
      expired_time: editKey.expired_time,
      status: editKey.status,
    })
    if (!res.success) {
      toast.error(res.message || '保存失败')
      return
    }
    setEditKey(null)
    await load()
  }

  const copyKey = async (id: number) => {
    const res = await fetchCodexProxyKeySecret(id)
    if (!res.success || !res.data?.key) {
      toast.error(res.message || '获取失败')
      return
    }
    await navigator.clipboard.writeText(res.data.key)
    toast.success('密钥已复制')
  }

  const openEditAccount = (account: CodexAccount) => {
    setEditingAccount(account)
    setEditName(account.name || '')
    setEditBaseUrl(account.base_url || 'https://chatgpt.com')
    setEditProxy(account.proxy || '')
    setEditPriority(String(account.priority || 0))
    setEditNote(account.note || '')
    setEditOpen(true)
  }

  const saveAccount = async () => {
    if (!editingAccount) return
    const priority = Number.parseInt(editPriority, 10)
    const res = await updateCodexAccount(editingAccount.id, {
      name: editName,
      base_url: editBaseUrl,
      proxy: editProxy,
      priority: Number.isFinite(priority) ? priority : 0,
      note: editNote,
    })
    if (!res.success) {
      toast.error(res.message || '保存失败')
      return
    }
    setEditOpen(false)
    setEditingAccount(null)
    await load()
  }

  const handleUsage = async (id: number) => {
    setBusyId(id)
    try {
      const res = await getCodexAccountUsage(id)
      setUsageContent(JSON.stringify(res, null, 2))
      setUsageOpen(true)
    } finally {
      setBusyId(null)
    }
  }

  if (access && !canUse) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>Codex 账号托管</SectionPageLayout.Title>
        <SectionPageLayout.Description>
          当前账号还没有子代理权限，请联系管理员开通。
        </SectionPageLayout.Description>
      </SectionPageLayout>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>Codex 账号管理</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        管理 Codex 官方号池、子代理账号和子代理分发密钥。子代理密钥只会路由到其上传的 Codex 账号。
      </SectionPageLayout.Description>
      <SectionPageLayout.Actions>
        {isAdmin && (
          <select
            className='border-input bg-background h-9 rounded-md border px-3 text-sm'
            value={selectedOwner}
            onChange={(e) => setSelectedOwner(Number(e.target.value))}
          >
            <option value={-1}>全部账号</option>
            <option value={0}>管理员公共池</option>
            {subagents.map((item) => (
              <option key={item.user_id} value={item.user_id}>
                {item.display_name || item.username || item.user_id}
              </option>
            ))}
          </select>
        )}
        <Button variant='outline' onClick={handleExport}>
          <Download className='mr-2 h-4 w-4' />
          导出账号
        </Button>
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button variant='outline' type='button'>
              <Upload className='mr-2 h-4 w-4' />
              导入 CPA 账号
            </Button>
          </DialogTrigger>
          <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
            <DialogHeader>
              <DialogTitle>导入 CLIProxyAPI 账号</DialogTitle>
              <DialogDescription>
                选择一个或多个 CPA 导出的 Codex JSON 文件；也可以在下方直接粘贴 JSON。
                管理员可先在右上角选择导入到公共池或某个子代理。
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-2'>
              <Label>选择 JSON 文件</Label>
              <Input
                type='file'
                accept='application/json,.json'
                multiple
                onChange={(e) => {
                  void handleImportFiles(e.target.files)
                  e.currentTarget.value = ''
                }}
              />
              <div className='text-muted-foreground text-xs'>
                支持一次选择多个文件，系统会合并后导入；每个文件可以是单账号对象或 CPA 导出的数组/对象。
              </div>
            </div>
            <Textarea
              className='max-h-[260px] min-h-[160px] resize-y overflow-y-auto font-mono text-xs'
              value={importRaw}
              onChange={(e) => setImportRaw(e.target.value)}
              placeholder='粘贴 CPA 导出的 Codex JSON'
            />
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label>默认 Base URL</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
              <div className='space-y-2'>
                <Label>默认代理 URL（可选）</Label>
                <Input value={proxy} onChange={(e) => setProxy(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setImportOpen(false)}>
                取消
              </Button>
              <Button onClick={handleImport} disabled={!importRaw.trim()}>
                导入
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={oauthOpen} onOpenChange={setOAuthOpen}>
          <DialogTrigger asChild>
            <Button type='button'>
              <ExternalLink className='mr-2 h-4 w-4' />
              添加 OAuth 账号
            </Button>
          </DialogTrigger>
          <DialogContent className='sm:max-w-2xl'>
            <DialogHeader>
              <DialogTitle>添加 Codex OAuth 账号</DialogTitle>
              <DialogDescription>登录完成后把完整回调 URL 粘贴回来保存。</DialogDescription>
            </DialogHeader>
            <div className='space-y-3'>
              <Label>账号备注</Label>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
              <Label>Base URL</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              <Label>代理 URL（可选）</Label>
              <Input value={proxy} onChange={(e) => setProxy(e.target.value)} />
              <Button variant='outline' onClick={handleStartOAuth}>
                打开授权页面
              </Button>
              {authUrl && (
                <div className='text-muted-foreground break-all text-xs'>{authUrl}</div>
              )}
              <Label>授权完成后的完整回调 URL</Label>
              <Input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setOAuthOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCompleteOAuth} disabled={!callbackUrl.trim()}>
                保存账号
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <Tabs defaultValue='accounts'>
          <TabsList>
            <TabsTrigger value='accounts'>账号池</TabsTrigger>
            <TabsTrigger value='keys'>分发密钥</TabsTrigger>
            {isAdmin && <TabsTrigger value='subagents'>子代理</TabsTrigger>}
          </TabsList>
          <TabsContent value='accounts'>
            <Card>
              <CardContent className='pt-6'>
                <div className='mb-4 flex items-center justify-between gap-3'>
                  <div className='text-muted-foreground text-sm'>
                    共 {accounts.length} 个账号，{enabledCount} 个启用
                  </div>
                  <Button variant='ghost' size='sm' onClick={load} disabled={loading}>
                    {loading ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : (
                      <RefreshCw className='mr-2 h-4 w-4' />
                    )}
                    刷新
                  </Button>
                </div>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>账号</TableHead>
                        {isAdmin && <TableHead>归属</TableHead>}
                        <TableHead>状态</TableHead>
                        <TableHead>优先级/备注</TableHead>
                        <TableHead>过期时间</TableHead>
                        <TableHead>请求/失败</TableHead>
                        <TableHead>错误</TableHead>
                        <TableHead className='text-right'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((account) => (
                        <TableRow key={account.id}>
                          <TableCell>
                            <div className='font-medium'>
                              {account.name || account.email || account.account_id}
                            </div>
                            <div className='text-muted-foreground max-w-[260px] truncate text-xs'>
                              {account.email || '-'} · {account.account_id}
                            </div>
                          </TableCell>
                          {isAdmin && (
                            <TableCell>
                              {account.owner_user_id > 0
                                ? account.owner_display_name ||
                                  account.owner_username ||
                                  account.owner_user_id
                                : '管理员公共池'}
                            </TableCell>
                          )}
                          <TableCell>
                            <Badge variant={account.status === 1 ? 'default' : 'secondary'}>
                              {account.status === 1 ? '启用' : '停用'}
                            </Badge>
                            {formatCooldown(account.next_retry_time) && (
                              <div className='text-destructive mt-1 text-xs'>
                                冷却 {formatCooldown(account.next_retry_time)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className='text-sm'>{account.priority || 0}</div>
                            <div className='text-muted-foreground max-w-[180px] truncate text-xs'>
                              {account.note || '-'}
                            </div>
                          </TableCell>
                          <TableCell>{formatTime(account.expired_at)}</TableCell>
                          <TableCell>
                            {account.used_count}/{account.failed_count}
                          </TableCell>
                          <TableCell className='max-w-[220px] truncate text-xs'>
                            {account.last_error || '-'}
                          </TableCell>
                          <TableCell className='space-x-1 text-right'>
                            <Button
                              variant='ghost'
                              size='sm'
                              disabled={busyId === account.id}
                              onClick={() => handleUsage(account.id)}
                            >
                              用量
                            </Button>
                            <Button
                              variant='ghost'
                              size='sm'
                              disabled={busyId === account.id || !account.has_refresh_token}
                              onClick={async () => {
                                await refreshCodexAccount(account.id)
                                await load()
                              }}
                            >
                              刷新
                            </Button>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={async () => {
                                await updateCodexAccount(account.id, {
                                  status: account.status === 1 ? 2 : 1,
                                })
                                await load()
                              }}
                            >
                              {account.status === 1 ? '停用' : '启用'}
                            </Button>
                            <Button
                              variant='ghost'
                              size='icon'
                              onClick={() => openEditAccount(account)}
                            >
                              <Pencil className='h-4 w-4' />
                            </Button>
                            <Button
                              variant='ghost'
                              size='icon'
                              onClick={async () => {
                                if (!window.confirm('确认删除该 Codex 账号？')) return
                                await deleteCodexAccount(account.id)
                                await load()
                              }}
                            >
                              <Trash2 className='h-4 w-4' />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value='keys'>
            <div className='grid gap-4 lg:grid-cols-4'>
              <Card className='lg:col-span-4'>
                <CardHeader className='flex flex-row items-center justify-between'>
                  <CardTitle className='text-base'>子代理看板</CardTitle>
                  <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
                    <DialogTrigger asChild>
                      <Button size='sm' disabled={isAdmin && selectedOwner <= 0}>
                        <KeyRound className='mr-2 h-4 w-4' />
                        生成密钥
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>生成 Codex 分发密钥</DialogTitle>
                        <DialogDescription>
                          该密钥只能调用当前归属下上传的 Codex 账号。
                        </DialogDescription>
                      </DialogHeader>
                      <Label>密钥名称</Label>
                      <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} />
                      <Label>托管额度限制（USD 面值，仅限制此 key）</Label>
                      <Input value={keyUsd} onChange={(e) => setKeyUsd(e.target.value)} />
                      <label className='flex items-center gap-2 text-sm'>
                        <input
                          type='checkbox'
                          checked={keyUnlimited}
                          onChange={(e) => setKeyUnlimited(e.target.checked)}
                        />
                        不限制该 key 托管额度
                      </label>
                      <DialogFooter>
                        <Button variant='outline' onClick={() => setKeyOpen(false)}>
                          取消
                        </Button>
                        <Button onClick={createKey}>生成并复制</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  <div className='grid gap-3 md:grid-cols-5'>
                    <Stat label='请求数' value={statNumber(stats?.total?.requests)} />
                    <Stat label='输入 Token' value={statNumber(stats?.total?.prompt_tokens)} />
                    <Stat label='输出 Token' value={statNumber(stats?.total?.completion_tokens)} />
                    <Stat label='缓存 Token' value={statNumber(stats?.total?.cache_tokens)} />
                    <Stat label='已用托管额度' value={`$${quotaToUsd(stats?.total?.quota)}`} />
                  </div>
                </CardContent>
              </Card>
              <Card className='lg:col-span-4'>
                <CardContent className='pt-6'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>密钥</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>托管额度</TableHead>
                        <TableHead>最近使用</TableHead>
                        <TableHead>用量</TableHead>
                        <TableHead className='text-right'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {proxyKeys.map((key) => {
                        const keyStat = stats?.keys?.find((item) => item.token_id === key.id)
                        return (
                          <TableRow key={key.id}>
                            <TableCell>
                              <div className='font-medium'>{key.name}</div>
                              <div className='text-muted-foreground text-xs'>{key.key}</div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={key.status === 1 ? 'default' : 'secondary'}>
                                {key.status === 1 ? '启用' : '停用'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {key.unlimited_quota
                                ? '无限'
                                : `$${quotaToUsd(key.remain_quota)} / 已用 $${quotaToUsd(key.used_quota)}`}
                            </TableCell>
                            <TableCell>{formatTime(key.accessed_time)}</TableCell>
                            <TableCell className='text-xs'>
                              <div>输入 {statNumber(keyStat?.prompt_tokens)}</div>
                              <div>输出 {statNumber(keyStat?.completion_tokens)}</div>
                              <div>缓存 {statNumber(keyStat?.cache_tokens)}</div>
                            </TableCell>
                            <TableCell className='space-x-1 text-right'>
                              <Button variant='ghost' size='sm' onClick={() => copyKey(key.id)}>
                                复制
                              </Button>
                              <Button
                                variant='ghost'
                                size='sm'
                                onClick={() => {
                                  setEditKey(key)
                                  setEditKeyName(key.name)
                                  setEditKeyUsd(quotaToUsd(key.remain_quota))
                                  setEditKeyUnlimited(key.unlimited_quota)
                                }}
                              >
                                编辑
                              </Button>
                              <Button
                                variant='ghost'
                                size='sm'
                                onClick={async () => {
                                  await updateCodexProxyKey(key.id, {
                                    status: key.status === 1 ? 2 : 1,
                                    name: key.name,
                                    remain_quota: key.remain_quota,
                                    unlimited_quota: key.unlimited_quota,
                                    expired_time: key.expired_time,
                                  })
                                  await load()
                                }}
                              >
                                {key.status === 1 ? '停用' : '启用'}
                              </Button>
                              <Button
                                variant='ghost'
                                size='sm'
                                onClick={async () => {
                                  if (!window.confirm('确认删除该密钥？')) return
                                  await deleteCodexProxyKey(key.id)
                                  await load()
                                }}
                              >
                                删除
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          {isAdmin && (
            <TabsContent value='subagents'>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between'>
                  <CardTitle className='text-base'>子代理管理</CardTitle>
                  <Dialog open={subagentOpen} onOpenChange={setSubagentOpen}>
                    <DialogTrigger asChild>
                      <Button size='sm'>
                        <UsersRound className='mr-2 h-4 w-4' />
                        添加子代理
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>添加子代理</DialogTitle>
                        <DialogDescription>
                          输入现有普通用户 ID。子代理可管理自己的 Codex 账号和分发密钥。
                        </DialogDescription>
                      </DialogHeader>
                      <Label>用户 ID</Label>
                      <Input
                        value={subagentUserId}
                        onChange={(e) => setSubagentUserId(e.target.value)}
                      />
                      <DialogFooter>
                        <Button variant='outline' onClick={() => setSubagentOpen(false)}>
                          取消
                        </Button>
                        <Button onClick={addSubagent}>添加</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>用户</TableHead>
                        <TableHead>账号/密钥</TableHead>
                        <TableHead>已用托管额度</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead className='text-right'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subagents.map((item) => (
                        <TableRow key={item.user_id}>
                          <TableCell>
                            <div className='font-medium'>
                              {item.display_name || item.username || item.user_id}
                            </div>
                            <div className='text-muted-foreground text-xs'>
                              ID {item.user_id} · {item.email || '-'}
                            </div>
                          </TableCell>
                          <TableCell>
                            {item.account_count} / {item.key_count}
                          </TableCell>
                          <TableCell>${quotaToUsd(item.used_quota)}</TableCell>
                          <TableCell>{formatTime(item.created_at)}</TableCell>
                          <TableCell className='space-x-1 text-right'>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => setSelectedOwner(item.user_id)}
                            >
                              查看
                            </Button>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => removeSubagent(item.user_id)}
                            >
                              删除权限
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </SectionPageLayout.Content>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>编辑 Codex 账号</DialogTitle>
          </DialogHeader>
          <div className='grid gap-3'>
            <Label>账号备注名</Label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            <Label>Base URL</Label>
            <Input value={editBaseUrl} onChange={(e) => setEditBaseUrl(e.target.value)} />
            <Label>代理 URL</Label>
            <Input value={editProxy} onChange={(e) => setEditProxy(e.target.value)} />
            <Label>优先级（数字越大越优先）</Label>
            <Input value={editPriority} onChange={(e) => setEditPriority(e.target.value)} />
            <Label>备注</Label>
            <Textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button onClick={saveAccount}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editKey} onOpenChange={(open) => !open && setEditKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑分发密钥</DialogTitle>
          </DialogHeader>
          <Label>名称</Label>
          <Input value={editKeyName} onChange={(e) => setEditKeyName(e.target.value)} />
          <Label>剩余托管额度（USD 面值）</Label>
          <Input value={editKeyUsd} onChange={(e) => setEditKeyUsd(e.target.value)} />
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={editKeyUnlimited}
              onChange={(e) => setEditKeyUnlimited(e.target.checked)}
            />
            不限制该 key 托管额度
          </label>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditKey(null)}>
              取消
            </Button>
            <Button onClick={saveKey}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>Codex 上游用量</DialogTitle>
          </DialogHeader>
          <pre className='bg-muted max-h-[60vh] overflow-auto rounded-md p-3 text-xs'>
            {usageContent}
          </pre>
        </DialogContent>
      </Dialog>
    </SectionPageLayout>
  )
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className='rounded-lg border p-3'>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div className='mt-1 text-lg font-semibold'>{props.value}</div>
    </div>
  )
}
