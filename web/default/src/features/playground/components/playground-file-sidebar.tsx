import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  PanelLeftIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  formatFileReference,
  listHelperWorkspaceEntries,
  listWorkspaceEntries,
  isAgentHelperPaired,
  type AgentHelperStatus,
  type WorkspaceEntry,
} from '../lib'

interface PlaygroundFileSidebarProps {
  root?: FileSystemDirectoryHandle
  helperStatus?: AgentHelperStatus | null
  workspaceName?: string
  disabled?: boolean
  refreshKey?: number
}

interface FileTreeNodeProps {
  entry: WorkspaceEntry
  depth: number
  root?: FileSystemDirectoryHandle
  helperStatus?: AgentHelperStatus | null
  disabled?: boolean
  refreshKey?: number
}

async function listEntries(
  root: FileSystemDirectoryHandle | undefined,
  helperStatus: AgentHelperStatus | null | undefined,
  path: string
): Promise<WorkspaceEntry[]> {
  if (isAgentHelperPaired(helperStatus)) {
    return listHelperWorkspaceEntries(path)
  }
  if (!root) return []
  return listWorkspaceEntries(root, path)
}

function FileTreeNode({
  entry,
  depth,
  root,
  helperStatus,
  disabled = false,
  refreshKey = 0,
}: FileTreeNodeProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null)
  const isDirectory = entry.kind === 'directory'

  const loadChildren = useCallback(async () => {
    if (!isDirectory || children) return
    setLoading(true)
    try {
      setChildren(await listEntries(root, helperStatus, entry.path))
    } catch {
      toast.error(t('Failed to read folder'))
      setChildren([])
    } finally {
      setLoading(false)
    }
  }, [children, entry.path, helperStatus, isDirectory, root, t])

  useEffect(() => {
    if (!open || !isDirectory) return
    let cancelled = false
    setLoading(true)
    listEntries(root, helperStatus, entry.path)
      .then((nextChildren) => {
        if (!cancelled) setChildren(nextChildren)
      })
      .catch(() => {
        if (!cancelled) {
          setChildren([])
          toast.error(t('Failed to read folder'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [entry.path, helperStatus, isDirectory, open, refreshKey, root, t])

  const toggle = async () => {
    if (!isDirectory) return
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen) await loadChildren()
  }

  const copyPath = async () => {
    if (!navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(entry.path)
    toast.success(t('Path copied'))
  }

  return (
    <div>
      <div
        className='group flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs hover:bg-accent/70'
        draggable={!disabled}
        onDragStart={(event) => {
          const reference = formatFileReference(entry.path)
          event.dataTransfer.setData('text/plain', reference)
          event.dataTransfer.setData('application/x-newapi-file-path', entry.path)
          event.dataTransfer.setData('application/x-newapi-file-kind', entry.kind)
          event.dataTransfer.effectAllowed = 'copy'
        }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          className='flex size-5 shrink-0 items-center justify-center rounded hover:bg-background'
          disabled={!isDirectory || disabled}
          onClick={() => void toggle()}
          type='button'
        >
          {isDirectory ? (
            <ChevronRightIcon
              className={cn(
                'size-3.5 text-muted-foreground transition-transform',
                open && 'rotate-90'
              )}
            />
          ) : null}
        </button>
        {isDirectory ? (
          open ? (
            <FolderOpenIcon className='size-3.5 shrink-0 text-sky-500' />
          ) : (
            <FolderIcon className='size-3.5 shrink-0 text-sky-500' />
          )
        ) : (
          <FileIcon className='size-3.5 shrink-0 text-muted-foreground' />
        )}
        <button
          className='min-w-0 flex-1 truncate text-left'
          disabled={disabled}
          onClick={isDirectory ? () => void toggle() : copyPath}
          title={entry.path}
          type='button'
        >
          {entry.name}
        </button>
        <button
          className='text-muted-foreground hidden size-6 shrink-0 items-center justify-center rounded hover:bg-background group-hover:flex'
          disabled={disabled}
          onClick={copyPath}
          title={t('Copy path')}
          type='button'
        >
          <CopyIcon className='size-3.5' />
        </button>
      </div>

      {open && (
        <div>
          {loading && (
            <div
              className='text-muted-foreground px-1 py-0.5 text-xs'
              style={{ paddingLeft: `${(depth + 1) * 12 + 28}px` }}
            >
              {t('Loading...')}
            </div>
          )}
          {children?.map((child) => (
            <FileTreeNode
              depth={depth + 1}
              disabled={disabled}
              entry={child}
              key={child.path}
              refreshKey={refreshKey}
              root={root}
              helperStatus={helperStatus}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function PlaygroundFileSidebar({
  root,
  helperStatus,
  workspaceName,
  disabled = false,
  refreshKey = 0,
}: PlaygroundFileSidebarProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])

  useEffect(() => {
    if (!root && !isAgentHelperPaired(helperStatus)) {
      setEntries([])
      return
    }

    let cancelled = false
    setLoading(true)
    listEntries(root, helperStatus, '.')
      .then((nextEntries) => {
        if (!cancelled) setEntries(nextEntries)
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([])
          toast.error(t('Failed to read folder'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [helperStatus, refreshKey, root, t])

  const title = useMemo(
    () => workspaceName || root?.name || helperStatus?.workspace || t('Workspace files'),
    [helperStatus?.workspace, root?.name, t, workspaceName]
  )

  if (!root && !isAgentHelperPaired(helperStatus)) return null

  return (
    <div className='pointer-events-none absolute inset-y-0 left-0 z-20 hidden pl-4 lg:flex'>
      <div className='pointer-events-auto flex items-start gap-3 py-4'>
        {!open && (
          <Button
            className='mt-2 rounded-full shadow-sm'
            onClick={() => setOpen(true)}
            size='icon'
            variant='outline'
          >
            <PanelLeftIcon className='size-4' />
            <span className='sr-only'>{t('Workspace files')}</span>
          </Button>
        )}

        {open && (
          <div className='bg-background/95 flex h-full w-80 flex-col overflow-hidden rounded-3xl border shadow-sm backdrop-blur'>
            <div className='flex items-center justify-between border-b px-4 py-3'>
              <div className='min-w-0 space-y-1'>
                <div className='truncate text-sm font-semibold'>
                  {t('Workspace files')}
                </div>
                <div className='text-muted-foreground truncate text-xs'>
                  {title}
                </div>
              </div>
              <Button
                className='rounded-full'
                onClick={() => setOpen(false)}
                size='icon'
                variant='ghost'
              >
                <PanelLeftIcon className='size-4' />
                <span className='sr-only'>{t('Hide sidebar')}</span>
              </Button>
            </div>

            <ScrollArea className='min-h-0 flex-1'>
              <div className='p-2'>
                {loading ? (
                  <div className='text-muted-foreground px-2 py-3 text-xs'>
                    {t('Loading...')}
                  </div>
                ) : (
                  entries.map((entry) => (
                    <FileTreeNode
                      depth={0}
                      disabled={disabled}
                      entry={entry}
                      key={entry.path}
                      refreshKey={refreshKey}
                      root={root}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  )
}
