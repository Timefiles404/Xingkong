import { useMemo, useState } from 'react'
import { HistoryIcon, PanelRightIcon, PlusIcon, Trash2Icon } from 'lucide-react'
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
import type { PlaygroundConversation } from '../types'

interface PlaygroundHistorySidebarProps {
  conversations: PlaygroundConversation[]
  activeConversationId: string | null
  isGenerating?: boolean
  onCreateConversation: () => void
  onSelectConversation: (conversationId: string) => void
  onDeleteConversation: (conversationId: string) => void
}

function ConversationList({
  conversations,
  activeConversationId,
  isGenerating = false,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
}: PlaygroundHistorySidebarProps) {
  const { t } = useTranslation()
  const getDisplayTitle = (conversation: PlaygroundConversation) => {
    const lastUserMessage = [...conversation.messages]
      .reverse()
      .find((message) => {
        if (message.from !== 'user') return false
        if (message.isAgentToolResult) return false
        const content = message.versions?.[0]?.content || ''
        return !/<agent_tool_results\b/i.test(content)
      })
    const text = lastUserMessage?.versions?.[0]?.content
      ?.replace(/\s+/g, ' ')
      .trim()
    if (text) return text
    const attachment = lastUserMessage?.attachments?.[0]?.name
    const fallbackTitle = /<agent_tool_results\b/i.test(conversation.title || '')
      ? ''
      : conversation.title
    return attachment || fallbackTitle || t('New conversation')
  }
  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        return b.updatedAt - a.updatedAt
      }),
    [conversations]
  )

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3'>
        <div className='min-w-0'>
          <h3 className='text-sm font-semibold'>{t('Conversation history')}</h3>
        </div>
        <Button
          className='size-8 rounded-full'
          disabled={isGenerating}
          onClick={onCreateConversation}
          size='icon'
          variant='outline'
        >
          <PlusIcon className='size-4' />
          <span className='sr-only'>{t('New conversation')}</span>
        </Button>
      </div>

      <ScrollArea className='h-full min-h-0 flex-1'>
        <div className='space-y-1.5 p-2'>
          {sortedConversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId
            return (
              <div
                className={cn(
                  'w-full max-w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                  isActive
                    ? 'bg-accent border-primary/20'
                    : 'bg-background hover:bg-accent/60'
                )}
                key={conversation.id}
              >
                <div className='flex items-center justify-between gap-2'>
                  <button
                    className='min-w-0 flex-1 overflow-hidden text-left'
                    disabled={isGenerating}
                    onClick={() => onSelectConversation(conversation.id)}
                    type='button'
                  >
                    <div className='flex min-w-0 items-center overflow-hidden'>
                      <span className='line-clamp-2 min-w-0 break-all text-xs leading-4 font-medium'>
                        {getDisplayTitle(conversation)}
                      </span>
                    </div>
                  </button>

                  <Button
                    className='size-7 shrink-0 rounded-full opacity-70 hover:opacity-100'
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

export function PlaygroundHistorySidebar(
  props: PlaygroundHistorySidebarProps
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
              <span className='sr-only'>{t('Conversation history')}</span>
            </Button>
          </SheetTrigger>
          <SheetContent className='w-[88vw] p-0 sm:max-w-sm' side='right'>
            <SheetHeader className='sr-only'>
              <SheetTitle>{t('Conversation history')}</SheetTitle>
              <SheetDescription>
                {t('Access previous conversations and start new ones.')}
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
      <div className='pointer-events-auto flex h-full min-h-0 items-start gap-3 py-4'>
        {!open && (
          <Button
            className='mt-2 rounded-full shadow-sm'
            onClick={() => setOpen(true)}
            size='icon'
            variant='outline'
          >
            <PanelRightIcon className='size-4' />
            <span className='sr-only'>{t('Conversation history')}</span>
          </Button>
        )}

        {open && (
          <div className='bg-background/95 flex h-full min-h-0 w-72 flex-col overflow-hidden rounded-2xl border shadow-sm backdrop-blur'>
            <div className='flex shrink-0 items-center justify-between border-b px-3 py-2.5'>
              <div className='min-w-0'>
                <div className='text-sm font-semibold'>
                  {t('Conversation history')}
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
