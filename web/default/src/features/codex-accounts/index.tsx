import { useEffect, useMemo, useState } from 'react'
import {
  Download,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import {
  completeCodexAccountOAuth,
  deleteCodexAccount,
  exportCodexAccounts,
  getCodexAccountUsage,
  getCodexAccounts,
  importCodexAccounts,
  refreshCodexAccount,
  startCodexAccountOAuth,
  updateCodexAccount,
  type CodexAccount,
} from './api'

function formatTime(ts?: number) {
  if (!ts) return '-'
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

export function CodexAccounts() {
  const [accounts, setAccounts] = useState<CodexAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [oauthOpen, setOAuthOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usageContent, setUsageContent] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [accountName, setAccountName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://chatgpt.com')
  const [proxy, setProxy] = useState('')
  const [editingAccount, setEditingAccount] = useState<CodexAccount | null>(null)
  const [editName, setEditName] = useState('')
  const [editBaseUrl, setEditBaseUrl] = useState('')
  const [editProxy, setEditProxy] = useState('')
  const [editPriority, setEditPriority] = useState('0')
  const [editNote, setEditNote] = useState('')
  const [importRaw, setImportRaw] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [oauthBusy, setOAuthBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const enabledCount = useMemo(
    () => accounts.filter((item) => item.status === 1).length,
    [accounts]
  )

  const load = async () => {
    setLoading(true)
    try {
      const res = await getCodexAccounts({ page_size: 100 })
      if (!res.success) throw new Error(res.message || '加载失败')
      setAccounts(res.data?.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleStartOAuth = async () => {
    setOAuthBusy(true)
    try {
      const res = await startCodexAccountOAuth()
      if (!res.success || !res.data?.authorize_url) {
        toast.error(res.message || '无法创建授权链接')
        return
      }
      setAuthUrl(res.data.authorize_url)
      window.open(res.data.authorize_url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法创建授权链接')
    } finally {
      setOAuthBusy(false)
    }
  }

  const handleCompleteOAuth = async () => {
    setOAuthBusy(true)
    try {
      const res = await completeCodexAccountOAuth({
        input: callbackUrl,
        name: accountName,
        base_url: baseUrl,
        proxy,
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setOAuthBusy(false)
    }
  }

  const handleImport = async () => {
    setImportBusy(true)
    try {
      const res = await importCodexAccounts({
        raw: importRaw,
        base_url: baseUrl,
        proxy,
      })
      if (!res.success) {
        toast.error(res.message || '导入失败')
        return
      }
      toast.success(`已导入 ${res.data?.imported || 0}/${res.data?.total || 0} 个账号`)
      setImportOpen(false)
      setImportRaw('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setImportBusy(false)
    }
  }

  const handleExport = async () => {
    setExportBusy(true)
    try {
      const res = await exportCodexAccounts()
      if (!res.success) {
        toast.error('导出失败')
        return
      }
      const text = JSON.stringify(res.data || [], null, 2)
      await navigator.clipboard.writeText(text)
      toast.success('账号 JSON 已复制到剪贴板')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      setExportBusy(false)
    }
  }

  const handleRefresh = async (id: number) => {
    setBusyId(id)
    try {
      const res = await refreshCodexAccount(id)
      if (!res.success) throw new Error(res.message || '刷新失败')
      toast.success('账号凭证已刷新')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleUsage = async (id: number) => {
    setBusyId(id)
    try {
      const res = await getCodexAccountUsage(id)
      setUsageContent(JSON.stringify(res, null, 2))
      setUsageOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '查询失败')
    } finally {
      setBusyId(null)
    }
  }

  const toggleStatus = async (account: CodexAccount) => {
    const nextStatus = account.status === 1 ? 2 : 1
    await updateCodexAccount(account.id, { status: nextStatus })
    await load()
  }

  const openEdit = (account: CodexAccount) => {
    setEditingAccount(account)
    setEditName(account.name || '')
    setEditBaseUrl(account.base_url || 'https://chatgpt.com')
    setEditProxy(account.proxy || '')
    setEditPriority(String(account.priority || 0))
    setEditNote(account.note || '')
    setEditOpen(true)
  }

  const saveEdit = async () => {
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
    toast.success('账号配置已保存')
    setEditOpen(false)
    setEditingAccount(null)
    await load()
  }

  const removeAccount = async (account: CodexAccount) => {
    if (!window.confirm(`确认删除 ${account.email || account.account_id}？`)) return
    await deleteCodexAccount(account.id)
    await load()
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>Codex 账号管理</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        管理 Codex 官方号池。前台只暴露一个 Codex 官方渠道，实际账号按会话亲和、优先级和冷却状态选择。
      </SectionPageLayout.Description>
      <SectionPageLayout.Actions>
        <Button variant='outline' onClick={handleExport} disabled={exportBusy}>
          {exportBusy ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <Download className='mr-2 h-4 w-4' />
          )}
          导出账号
        </Button>
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button variant='outline' type='button'>
              <Upload className='mr-2 h-4 w-4' />
              导入 CPA 账号
            </Button>
          </DialogTrigger>
          <DialogContent className='sm:max-w-3xl'>
            <DialogHeader>
              <DialogTitle>导入 CLIProxyAPI 账号</DialogTitle>
              <DialogDescription>
                粘贴 CPA 导出的 Codex JSON。支持单个对象、数组、或包含 auths/accounts
                的对象。
              </DialogDescription>
            </DialogHeader>
            <Textarea
              className='min-h-[320px] font-mono text-xs'
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
                <Input
                  value={proxy}
                  onChange={(e) => setProxy(e.target.value)}
                  placeholder='为空时使用账号 JSON 内的 proxy_url'
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setImportOpen(false)}
                disabled={importBusy}
              >
                取消
              </Button>
              <Button onClick={handleImport} disabled={!importRaw.trim() || importBusy}>
                {importBusy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
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
              <DialogDescription>
                先打开授权页面，登录完成后把完整回调 URL 粘贴回来保存。
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-3'>
              <Label>账号备注</Label>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
              <Label>Base URL</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              <Label>代理 URL（可选）</Label>
              <Input value={proxy} onChange={(e) => setProxy(e.target.value)} />
              <Button variant='outline' onClick={handleStartOAuth} disabled={oauthBusy}>
                {oauthBusy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                打开授权页面
              </Button>
              {authUrl && (
                <div className='text-muted-foreground break-all text-xs'>{authUrl}</div>
              )}
              <Label>授权完成后的完整回调 URL</Label>
              <Input
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder='http://localhost:1455/auth/callback?code=...&state=...'
              />
            </div>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setOAuthOpen(false)}
                disabled={oauthBusy}
              >
                取消
              </Button>
              <Button
                onClick={handleCompleteOAuth}
                disabled={!callbackUrl.trim() || oauthBusy}
              >
                {oauthBusy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                保存账号
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
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
                    <TableHead>状态</TableHead>
                    <TableHead>优先级/备注</TableHead>
                    <TableHead>过期时间</TableHead>
                    <TableHead>最近使用</TableHead>
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
                      <TableCell>
                        <Badge variant={account.status === 1 ? 'default' : 'secondary'}>
                          {account.status === 1 ? '启用' : '停用'}
                        </Badge>
                        {formatCooldown(account.next_retry_time) && (
                          <div className='text-destructive mt-1 text-xs'>
                            冷却 {formatCooldown(account.next_retry_time)}
                          </div>
                        )}
                        {(account.model_states || [])
                          .filter((item) => formatCooldown(item.next_retry_time))
                          .slice(0, 2)
                          .map((item) => (
                            <div
                              key={item.id}
                              className='text-destructive/80 mt-1 max-w-[160px] truncate text-xs'
                              title={item.last_error || item.model}
                            >
                              {item.model} {formatCooldown(item.next_retry_time)}
                            </div>
                          ))}
                      </TableCell>
                      <TableCell>
                        <div className='text-sm'>{account.priority || 0}</div>
                        <div className='text-muted-foreground max-w-[180px] truncate text-xs'>
                          {account.note || '-'}
                        </div>
                      </TableCell>
                      <TableCell>{formatTime(account.expired_at)}</TableCell>
                      <TableCell>{formatTime(account.last_used_time)}</TableCell>
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
                          onClick={() => handleRefresh(account.id)}
                        >
                          刷新
                        </Button>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => toggleStatus(account)}
                        >
                          {account.status === 1 ? '停用' : '启用'}
                        </Button>
                        <Button variant='ghost' size='icon' onClick={() => openEdit(account)}>
                          <Pencil className='h-4 w-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => removeAccount(account)}
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
            <Input
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value)}
              inputMode='numeric'
            />
            <Label>备注</Label>
            <Textarea
              className='min-h-[96px]'
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button onClick={saveEdit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className='sm:max-w-3xl'>
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
