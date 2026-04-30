import { useMemo, useState } from 'react'
import {
  HistoryIcon,
  ImageIcon,
  PanelRightIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { ImagePlaygroundConversation } from '../types'

interface ImagePlaygroundHistorySidebarProps {
  conversations: ImagePlaygroundConversation[]
  activeConversationId: string
  isGenerating?: boolean
  onCreateConversation: () => void
  onSelectConversation: (conversationId: string) => void
  onDeleteConversation: (conversationId: string) => void
}

function formatConversationTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function ConversationList({
  conversations,
  activeConversationId,
  isGenerating = false,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
}: ImagePlaygroundHistorySidebarProps) {
  const { t } = useTranslation()
  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations]
  )

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between gap-2 border-b px-4 py-4'>
        <div className='space-y-1'>
          <h3 className='text-sm font-semibold'>{t('Image history')}</h3>
          <p className='text-muted-foreground text-xs'>
            {t('Saved only on this device.')}
          </p>
        </div>
        <Button
          className='rounded-full'
          disabled={isGenerating}
          onClick={onCreateConversation}
          size='icon'
          variant='outline'
        >
          <PlusIcon className='size-4' />
          <span className='sr-only'>{t('New image task')}</span>
        </Button>
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-2 p-3'>
          {sortedConversations.map((conversation) => {
            const conversationMessages = Array.isArray(conversation.messages)
              ? conversation.messages
              : []
            const preview =
              conversationMessages[0]?.prompt?.trim() ||
              conversationMessages[0]?.attachments?.[0]?.name ||
              t('Start a fresh image task')
            const isActive = conversation.id === activeConversationId
            return (
              <div
                className={cn(
                  'w-full rounded-2xl border px-3 py-3 text-left transition-colors',
                  isActive
                    ? 'bg-accent border-primary/20'
                    : 'bg-background hover:bg-accent/60'
                )}
                key={conversation.id}
              >
                <div className='flex items-start justify-between gap-3'>
                  <button
                    className='min-w-0 flex-1 space-y-1 text-left'
                    disabled={isGenerating}
                    onClick={() => onSelectConversation(conversation.id)}
                    type='button'
                  >
                    <div className='flex items-center gap-2'>
                      <ImageIcon className='text-muted-foreground size-3.5 shrink-0' />
                      <span className='truncate text-sm font-medium'>
                        {conversation.title || t('New image task')}
                      </span>
                    </div>
                    <p className='text-muted-foreground line-clamp-2 text-xs leading-5 break-all'>
                      {preview}
                    </p>
                    <div className='text-muted-foreground flex items-center gap-2 text-[11px]'>
                      <span>{formatConversationTime(conversation.updatedAt)}</span>
                      <span>·</span>
                      <span>
                        {t('{{count}} turns', {
                          count: conversationMessages.length,
                        })}
                      </span>
                    </div>
                  </button>

                  <Button
                    className='size-8 shrink-0 rounded-full'
                    disabled={isGenerating || conversations.length <= 1}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteConversation(conversation.id)
                    }}
                    size='icon'
                    type='button'
                    variant='ghost'
                  >
                    <Trash2Icon className='size-4' />
                    <span className='sr-only'>{t('Delete conversation')}</span>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

export function ImagePlaygroundHistorySidebar(
  props: ImagePlaygroundHistorySidebarProps
) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  if (isMobile) {
    return (
      <div className='absolute top-4 right-4 z-20'>
        <Sheet onOpenChange={setOpen} open={open}>
          <SheetTrigger asChild>
            <Button className='rounded-full shadow-sm' size='icon' variant='outline'>
              <HistoryIcon className='size-4' />
              <span className='sr-only'>{t('Image history')}</span>
            </Button>
          </SheetTrigger>
          <SheetContent className='w-[88vw] p-0 sm:max-w-sm' side='right'>
            <SheetHeader className='sr-only'>
              <SheetTitle>{t('Image history')}</SheetTitle>
              <SheetDescription>
                {t('Access previous image tasks and start new ones.')}
              </SheetDescription>
            </SheetHeader>
            <ConversationList {...props} />
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  return (
    <div className='pointer-events-none absolute inset-y-0 right-0 z-20 hidden pr-4 lg:flex'>
      <div className='pointer-events-auto flex items-start gap-3 py-4'>
        {!open && (
          <Button
            className='mt-2 rounded-full shadow-sm'
            onClick={() => setOpen(true)}
            size='icon'
            variant='outline'
          >
            <PanelRightIcon className='size-4' />
            <span className='sr-only'>{t('Image history')}</span>
          </Button>
        )}

        {open && (
          <div className='bg-background/95 flex h-full w-80 flex-col overflow-hidden rounded-3xl border shadow-sm backdrop-blur'>
            <div className='flex items-center justify-between border-b px-4 py-3'>
              <div className='space-y-1'>
                <div className='text-sm font-semibold'>{t('Image history')}</div>
                <div className='text-muted-foreground text-xs'>
                  {t('Saved only on this device.')}
                </div>
              </div>
              <Button
                className='rounded-full'
                onClick={() => setOpen(false)}
                size='icon'
                variant='ghost'
              >
                <PanelRightIcon className='size-4' />
                <span className='sr-only'>{t('Hide sidebar')}</span>
              </Button>
            </div>
            <ConversationList {...props} />
          </div>
        )}
      </div>
    </div>
  )
}
