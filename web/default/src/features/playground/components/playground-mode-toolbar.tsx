import {
  BotIcon,
  ChevronDownIcon,
  DownloadIcon,
  FolderOpenIcon,
  MessageCircleIcon,
  PlayIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { AgentHelperStatus } from '../lib'
import type { PlaygroundMode } from '../types'

interface PlaygroundModeToolbarProps {
  mode: PlaygroundMode
  isBusy: boolean
  activeWorkspaceName: string
  hasBrowserWorkspace: boolean
  helperStatus: AgentHelperStatus | null
  isHelperConnected: boolean
  isHelperDownloading: boolean
  isHelperPairing: boolean
  onModeChange: (mode: PlaygroundMode) => void
  onPickWorkspace: () => void
  onDownloadHelper: () => void
  onStartHelper: () => void
  onOpenPairDialog: () => void
}

export function PlaygroundModeToolbar({
  mode,
  isBusy,
  activeWorkspaceName,
  hasBrowserWorkspace,
  helperStatus,
  isHelperConnected,
  isHelperDownloading,
  isHelperPairing,
  onModeChange,
  onPickWorkspace,
  onDownloadHelper,
  onStartHelper,
  onOpenPairDialog,
}: PlaygroundModeToolbarProps) {
  const { t } = useTranslation()
  const isAgentMode = mode === 'agent'

  return (
    <div className='mx-auto hidden w-full max-w-4xl px-4 pt-4 sm:block'>
      <div className='bg-muted/35 flex flex-col gap-3 rounded-2xl border p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex gap-1 rounded-xl bg-background/80 p-1'>
          <Button
            className={cn(
              'h-9 rounded-lg px-3',
              mode === 'chat' && 'bg-primary text-primary-foreground'
            )}
            disabled={isBusy}
            onClick={() => onModeChange('chat')}
            size='sm'
            type='button'
            variant={mode === 'chat' ? 'default' : 'ghost'}
          >
            <MessageCircleIcon className='mr-2 size-4' />
            {t('Chat mode')}
          </Button>
          <Button
            className={cn(
              'h-9 rounded-lg px-3',
              isAgentMode && 'bg-primary text-primary-foreground'
            )}
            disabled={isBusy}
            onClick={() => onModeChange('agent')}
            size='sm'
            type='button'
            variant={isAgentMode ? 'default' : 'ghost'}
          >
            <BotIcon className='mr-2 size-4' />
            {t('Agent mode')}
          </Button>
        </div>

        {isAgentMode && (
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='text-muted-foreground'>
              {hasBrowserWorkspace || isHelperConnected
                ? t('Workspace: {{name}}', { name: activeWorkspaceName })
                : t('No workspace selected')}
            </span>
            <span
              className={cn(
                'rounded-full border px-2 py-1 text-xs',
                isHelperConnected
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : helperStatus
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-muted-foreground/20 text-muted-foreground'
              )}
              title={
                helperStatus
                  ? helperStatus.workspace_warning
                    ? `${helperStatus.workspace}\n${helperStatus.workspace_warning}`
                    : helperStatus.workspace
                  : t('Start local helper to enable terminal tools')
              }
            >
              {helperStatus?.workspace_warning
                ? t('Helper workspace warning')
                : isHelperConnected
                  ? t('Helper connected')
                  : helperStatus
                    ? t('Helper pairing required')
                    : t('Helper offline')}
            </span>
            {!isHelperConnected && (
              <Button
                disabled={isBusy}
                onClick={onPickWorkspace}
                size='sm'
                type='button'
                variant='outline'
              >
                <FolderOpenIcon className='mr-2 size-4' />
                {hasBrowserWorkspace ? t('Change folder') : t('Select folder')}
              </Button>
            )}
            {!isHelperConnected && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={isBusy || isHelperDownloading || isHelperPairing}
                    size='sm'
                    type='button'
                    variant='outline'
                  >
                    <DownloadIcon className='mr-2 size-4' />
                    {isHelperDownloading
                      ? t('Downloading helper')
                      : t('Helper actions')}
                    <ChevronDownIcon className='ml-2 size-3.5' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-48'>
                  <DropdownMenuItem
                    disabled={isHelperDownloading}
                    onClick={onDownloadHelper}
                  >
                    <DownloadIcon className='mr-2 size-4' />
                    {t('Download helper')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onStartHelper}>
                    <PlayIcon className='mr-2 size-4' />
                    {t('Start helper')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isHelperPairing}
                    onClick={onOpenPairDialog}
                  >
                    <BotIcon className='mr-2 size-4' />
                    {t('Pair helper')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
