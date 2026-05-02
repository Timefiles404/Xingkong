import { DownloadIcon, ImageIcon, SparklesIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import type { ImagePlaygroundMessage } from '../types'

interface ImagePlaygroundChatProps {
  messages: ImagePlaygroundMessage[]
}

function LoadingCard() {
  const { t } = useTranslation()

  return (
    <div className='bg-background w-fit max-w-full rounded-2xl border p-4 shadow-sm'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <SparklesIcon className='text-primary size-4 animate-pulse' />
        <span>{t('Generating image')}</span>
      </div>
      <p className='text-muted-foreground mt-2 text-sm'>
        {t('This usually takes 60 to 180 seconds.')}
      </p>
      <div className='mt-4'>
        <div className='from-primary/10 via-primary/20 to-primary/10 aspect-square w-[min(30rem,calc(100vw-4rem))] animate-pulse rounded-2xl border bg-gradient-to-br' />
      </div>
    </div>
  )
}

export function ImagePlaygroundChat({ messages }: ImagePlaygroundChatProps) {
  const { t } = useTranslation()

  return (
    <Conversation>
      <ConversationContent className='p-0'>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-4'>
          {messages.map((message) => {
            const isUser = message.from === 'user'
            return (
              <div
                className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
                key={message.key}
              >
                <div
                  className={cn(
                    'rounded-2xl border shadow-sm',
                    isUser
                      ? 'bg-primary/5 border-primary/10 w-full max-w-3xl p-5'
                      : message.status === 'complete'
                        ? 'bg-background w-fit max-w-full p-3'
                        : message.status === 'loading'
                          ? 'w-fit max-w-full border-transparent bg-transparent p-0 shadow-none'
                        : 'bg-background w-fit max-w-full p-0'
                  )}
                >
                  {isUser ? (
                    <div className='space-y-4'>
                      <div className='text-sm leading-7 whitespace-pre-wrap break-words'>
                        {message.prompt}
                      </div>
                      {!!message.attachments?.length && (
                        <div className='grid gap-3 sm:grid-cols-2'>
                          {message.attachments.map((attachment) => (
                            <div
                              className='bg-background overflow-hidden rounded-2xl border'
                              key={attachment.id}
                            >
                              <img
                                alt={attachment.name}
                                className='aspect-square w-full object-cover'
                                src={attachment.url}
                              />
                              <div className='flex items-center gap-2 px-3 py-2 text-xs'>
                                <ImageIcon className='text-muted-foreground size-3.5 shrink-0' />
                                <span className='truncate'>{attachment.name}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : message.status === 'loading' ? (
                    <LoadingCard />
                  ) : message.status === 'error' ? (
                    <div className='max-w-3xl space-y-2 p-5'>
                      <div className='text-sm font-medium text-red-500'>
                        {t('Image generation failed')}
                      </div>
                      <div className='text-muted-foreground text-sm whitespace-pre-wrap break-words'>
                        {message.errorMessage}
                      </div>
                    </div>
                  ) : (
                    <div className='space-y-4'>
                      {!!message.images?.length && (
                        <div
                          className={cn(
                            'grid max-w-full gap-3',
                            message.images.length > 1
                              ? 'w-full sm:grid-cols-2'
                              : 'w-fit'
                          )}
                        >
                          {message.images.map((image) => (
                            <div
                              className='bg-background w-fit max-w-full overflow-hidden rounded-2xl border'
                              key={image.id}
                            >
                              <img
                                alt={image.revisedPrompt || t('Generated image')}
                                className='aspect-square w-[min(34rem,calc(100vw-4rem))] max-w-full object-cover'
                                src={image.url}
                              />
                              {image.revisedPrompt && (
                                <div className='text-muted-foreground px-4 py-3 text-xs leading-6 whitespace-pre-wrap break-words'>
                                  {image.revisedPrompt}
                                </div>
                              )}
                              <div className='border-t px-4 py-3'>
                                <Button
                                  asChild
                                  className='w-full rounded-xl'
                                  size='sm'
                                  variant='outline'
                                >
                                  <a
                                    download={`generated-image-${image.id}.png`}
                                    href={image.url}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                  >
                                    <DownloadIcon className='size-4' />
                                    {t('Download')}
                                  </a>
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {!message.images?.length && (
                        <div className='text-muted-foreground p-5 text-sm'>
                          {t('No image was returned.')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </ConversationContent>
    </Conversation>
  )
}
