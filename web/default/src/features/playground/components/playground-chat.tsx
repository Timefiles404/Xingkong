import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2Icon,
  ChevronUpIcon,
  FileTextIcon,
  ImageIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Branch,
  BranchMessages,
  BranchNext,
  BranchPage,
  BranchPrevious,
  BranchSelector,
} from '@/components/ai-elements/branch'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Loader } from '@/components/ai-elements/loader'
import { Message, MessageContent } from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Response } from '@/components/ai-elements/response'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import { MESSAGE_ROLES } from '../constants'
import { getMessageContentStyles } from '../lib/message-styles'
import { parseThinkTags } from '../lib/message-utils'
import type { Message as MessageType } from '../types'
import { MessageActions } from './message-actions'
import { MessageError } from './message-error'

interface PlaygroundChatProps {
  messages: MessageType[]
  onCopyMessage?: (message: MessageType) => void
  onRegenerateMessage?: (message: MessageType) => void
  onEditMessage?: (message: MessageType) => void
  onDeleteMessage?: (message: MessageType) => void
  onApproveAgentToolCalls?: (approvalId: string, approved: boolean) => void
  isGenerating?: boolean
  editingKey?: string | null
  onSaveEdit?: (newContent: string) => void
  onCancelEdit?: (open: boolean) => void
  onSaveEditAndSubmit?: (newContent: string) => void
}

function formatToolName(tool: string): string {
  const names: Record<string, string> = {
    list_dir: '列出目录',
    read_file: '读取文件',
    search_files: '搜索文件',
    write_file: '写入文件',
    append_file: '追加文件',
    batch_edit: '批量编辑',
    create_dir: '创建目录',
  }
  return names[tool] || tool
}

function DiffPreview({ diff }: { diff?: string }) {
  if (!diff) return null

  const lines = diff.split(/\r?\n/)

  return (
    <div className='mt-1 max-h-72 overflow-auto rounded-md border bg-background/80 font-mono text-[11px] leading-4'>
      {lines.map((line, index) => {
        const type = line.startsWith('+')
          ? 'add'
          : line.startsWith('-')
            ? 'remove'
            : 'context'

        return (
          <div
            className={cn(
              'min-w-max px-2 py-0.5 whitespace-pre',
              type === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              type === 'remove' && 'bg-red-500/10 text-red-700 dark:text-red-300',
              type === 'context' && 'text-muted-foreground'
            )}
            key={`${index}-${line}`}
          >
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

function AgentToolResultCard({
  message,
  onApproveAgentToolCalls,
}: {
  message: MessageType
  onApproveAgentToolCalls?: (approvalId: string, approved: boolean) => void
}) {
  const { t } = useTranslation()
  const results = message.agentToolResults || []

  if (results.length === 0) return null

  const failedCount = results.filter((result) => !result.ok).length
  const pendingApproval = !!message.agentToolApprovalId
  const summary = results
    .map((result) => `${formatToolName(result.tool)} ${result.path || '.'}`)
    .join('，')

  if (pendingApproval) {
    return (
      <div className='sticky bottom-4 z-30 my-2 max-w-3xl rounded-xl border border-amber-500/25 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur'>
        <div className='flex flex-wrap items-center gap-2'>
          <WrenchIcon className='size-3.5 shrink-0 text-amber-600' />
          <span className='font-medium text-foreground'>{t('Review changes')}</span>
          <span className='text-muted-foreground min-w-0 flex-1 truncate'>
            {summary}
          </span>
          <Button
            className='h-7 rounded-full px-3 text-xs'
            onClick={() =>
              onApproveAgentToolCalls?.(message.agentToolApprovalId!, true)
            }
            size='sm'
            type='button'
          >
            {t('Apply')}
          </Button>
          <Button
            className='h-7 rounded-full px-3 text-xs'
            onClick={() =>
              onApproveAgentToolCalls?.(message.agentToolApprovalId!, false)
            }
            size='sm'
            type='button'
            variant='outline'
          >
            {t('Reject')}
          </Button>
        </div>
        <details className='group mt-1'>
          <summary className='text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 py-1'>
            <ChevronUpIcon className='size-3.5 transition-transform group-open:rotate-180' />
            <span>{t('Click to review diff')}</span>
          </summary>
          <div className='mt-1 max-h-[42vh] overflow-y-auto pr-1'>
            {results.map((result, index) => (
              <div className='py-1' key={`${message.key}-review-${index}`}>
                <div className='flex items-center gap-2'>
                  <span className='text-[11px] font-semibold text-foreground/80'>
                    {result.path || '.'}
                  </span>
                  <span className='text-muted-foreground text-[11px]'>
                    {formatToolName(result.tool)}
                    {result.summary ? ` · ${result.summary}` : ''}
                  </span>
                </div>
                <DiffPreview diff={result.diff || result.output} />
              </div>
            ))}
          </div>
        </details>
      </div>
    )
  }

  return (
    <details className='group my-2 max-w-3xl'>
      <summary className='text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 rounded-lg px-1 py-1 text-xs transition-colors'>
        <WrenchIcon className='size-3.5 shrink-0' />
        <span>{t('Local file tools')}</span>
        <span className='text-muted-foreground/80 min-w-0 flex-1 truncate'>
          {results.length} 个操作
          {failedCount > 0 ? `，${failedCount} 个失败` : ''} · {summary}
        </span>
        <span className='text-[11px] group-open:hidden'>{t('Expand')}</span>
        <span className='hidden text-[11px] group-open:inline'>{t('Collapse')}</span>
      </summary>
      <div className='mt-1 space-y-1.5 border-l pl-3'>
        {results.map((result, index) => {
          const StatusIcon = result.ok ? CheckCircle2Icon : XCircleIcon
          const preview = result.error || result.summary || result.output || ''
          const outputLines = (result.output || '')
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(0, 8)

          return (
            <div
              className='text-muted-foreground text-xs'
              key={`${message.key}-tool-${index}`}
            >
              <div className='flex min-w-0 items-start gap-2 py-1'>
                <StatusIcon
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0',
                    result.ok ? 'text-emerald-500' : 'text-destructive'
                  )}
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
                    <span className='font-medium text-foreground/80'>
                      {formatToolName(result.tool)}
                    </span>
                    <span className='break-all'>{result.path || '.'}</span>
                  </div>
                  {preview && <p className='mt-0.5 break-words'>{preview}</p>}
                </div>
              </div>
              {result.diff && <DiffPreview diff={result.diff} />}
              {result.ok && outputLines.length > 0 && (
                <pre className='bg-muted/30 ml-5 max-h-40 overflow-auto rounded-md px-2 py-1.5 text-[11px] leading-5 whitespace-pre-wrap'>
                  {outputLines.join('\n')}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}

export function PlaygroundChat({
  messages,
  onCopyMessage,
  onRegenerateMessage,
  onEditMessage,
  onDeleteMessage,
  onApproveAgentToolCalls,
  isGenerating = false,
  editingKey,
  onSaveEdit,
  onCancelEdit,
  onSaveEditAndSubmit,
}: PlaygroundChatProps) {
  const [editText, setEditText] = useState('')
  const [originalText, setOriginalText] = useState('')

  useEffect(() => {
    if (!editingKey) return
    const message = messages.find((m) => m.key === editingKey)
    const content = message?.versions?.[0]?.content || ''
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditText(content)

    setOriginalText(content)
  }, [editingKey, messages])

  const isEditing = (key: string) => editingKey === key
  const isEmpty = useMemo(() => !editText.trim(), [editText])
  const isChanged = useMemo(
    () => editText !== originalText,
    [editText, originalText]
  )

  const renderUserAttachments = (message: MessageType) => {
    const attachments = message.attachments || []
    if (attachments.length === 0) return null

    const imageAttachments = attachments.filter(
      (attachment) => attachment.type === 'image' && attachment.url
    )
    const textAttachments = attachments.filter(
      (attachment) => attachment.type === 'text'
    )

    return (
      <div className='mb-3 space-y-3'>
        {imageAttachments.length > 0 && (
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
            {imageAttachments.map((attachment) => (
              <div
                className='bg-background overflow-hidden rounded-2xl border'
                key={attachment.id}
              >
                <img
                  alt={attachment.name || 'attachment'}
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

        {textAttachments.length > 0 && (
          <div className='space-y-2'>
            {textAttachments.map((attachment) => (
              <div
                className='bg-background rounded-2xl border px-3 py-2'
                key={attachment.id}
              >
                <div className='flex items-center gap-2 text-sm font-medium'>
                  <FileTextIcon className='text-muted-foreground size-4 shrink-0' />
                  <span className='truncate'>{attachment.name}</span>
                </div>
                {attachment.textContent && (
                  <p className='text-muted-foreground mt-2 line-clamp-3 text-xs whitespace-pre-wrap break-all'>
                    {attachment.textContent}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Conversation>
      {/* Remove outer padding; apply padding to inner centered container to align with input */}
      <ConversationContent className='p-0'>
        <div className='mx-auto w-full max-w-4xl px-4 py-4'>
          {messages.map((message, messageIndex) => {
            const { versions = [] } = message
            const isLastAssistantMessage =
              messageIndex === messages.length - 1 &&
              message.from === MESSAGE_ROLES.ASSISTANT
            return (
              <Branch defaultBranch={0} key={message.key}>
                <BranchMessages>
                  {versions.map((version, versionIndex) => (
                    <Message
                      className='group flex-row-reverse'
                      from={
                        message.isAgentToolResult
                          ? MESSAGE_ROLES.ASSISTANT
                          : message.from
                      }
                      key={`${message.key}-${version.id}-${versionIndex}`}
                    >
                      <div className='w-full min-w-0 flex-1 basis-full py-1'>
                        {isEditing(message.key) ? (
                          <div className='space-y-2'>
                            <Textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className='font-mono text-sm'
                              rows={8}
                            />
                            <div className='flex gap-2'>
                              {/* Save & Submit only makes sense for user messages */}
                              {message.from === MESSAGE_ROLES.USER && (
                                <Button
                                  size='sm'
                                  onClick={() =>
                                    onSaveEditAndSubmit?.(editText)
                                  }
                                  disabled={isEmpty || !isChanged}
                                >
                                  Save & Submit
                                </Button>
                              )}
                              <Button
                                size='sm'
                                onClick={() => onSaveEdit?.(editText)}
                                disabled={isEmpty || !isChanged}
                              >
                                Save
                              </Button>
                              <Button
                                size='sm'
                                variant='outline'
                                onClick={() => onCancelEdit?.(false)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {(() => {
                              const isAssistant =
                                message.from === MESSAGE_ROLES.ASSISTANT
                              const hasSources = !!message.sources?.length
                              const showReasoning =
                                isAssistant && !!message.reasoning?.content
                              const showLoader =
                                isAssistant &&
                                !message.isReasoningStreaming &&
                                (message.status === 'loading' ||
                                  (message.status === 'streaming' &&
                                    !version.content))
                              const hasUserAttachments =
                                message.from === MESSAGE_ROLES.USER &&
                                !!message.attachments?.length
                              const showAgentToolResults =
                                message.isAgentToolResult &&
                                !!message.agentToolResults?.length
                              const showAgentContextEvent =
                                message.isAgentContextEvent &&
                                !!version.content
                              const showMessageContent =
                                !showAgentContextEvent &&
                                !showAgentToolResults &&
                                (((message.from === MESSAGE_ROLES.USER &&
                                  (!!version.content || hasUserAttachments)) ||
                                  !message.isReasoningStreaming) &&
                                  (!!version.content || hasUserAttachments))

                              // Extract visible content (remove <think> tags for assistant messages)
                              const displayContent = isAssistant
                                ? parseThinkTags(version.content).visibleContent
                                : version.content

                              const actions = (
                                <MessageActions
                                  message={message}
                                  onCopy={onCopyMessage}
                                  onRegenerate={onRegenerateMessage}
                                  onEdit={onEditMessage}
                                  onDelete={onDeleteMessage}
                                  isGenerating={isGenerating}
                                  alwaysVisible={isLastAssistantMessage}
                                  className='mt-1'
                                />
                              )

                              return (
                                <>
                                  {/* Sources */}
                                  {hasSources && (
                                    <Sources>
                                      <SourcesTrigger
                                        count={message.sources!.length}
                                      />
                                      <SourcesContent>
                                        {message.sources!.map(
                                          (source, sourceIndex) => (
                                            <Source
                                              href={source.href}
                                              key={`${message.key}-source-${sourceIndex}`}
                                              title={source.title}
                                            />
                                          )
                                        )}
                                      </SourcesContent>
                                    </Sources>
                                  )}

                                  {/* Reasoning */}
                                  {showReasoning && (
                                    <Reasoning
                                      defaultOpen={true}
                                      isStreaming={message.isReasoningStreaming}
                                    >
                                      <ReasoningTrigger />
                                      <ReasoningContent>
                                        {message.reasoning!.content}
                                      </ReasoningContent>
                                    </Reasoning>
                                  )}

                                  {/* Loader */}
                                  {showLoader && !showAgentContextEvent && (
                                    <div className='flex items-center gap-2 py-2'>
                                      <Loader />
                                      <Shimmer className='text-sm' duration={1}>
                                        Responding...
                                      </Shimmer>
                                    </div>
                                  )}

                                  {showAgentContextEvent && (
                                    <div className='my-4 flex items-center gap-3 text-xs text-muted-foreground'>
                                      <div className='h-px flex-1 bg-border' />
                                      <div
                                        className='flex items-center gap-2 rounded-full border bg-background px-3 py-1 shadow-xs'
                                        title={message.apiContent || undefined}
                                      >
                                        {message.status === 'loading' && (
                                          <Loader />
                                        )}
                                        <span>{version.content}</span>
                                      </div>
                                      <div className='h-px flex-1 bg-border' />
                                    </div>
                                  )}

                                  {/* Error or Content */}
                                  {message.status === 'error' ? (
                                    <>
                                      <MessageError
                                        message={message}
                                        className='mb-2'
                                      />
                                      {actions}
                                    </>
                                  ) : (
                                    (showAgentToolResults ||
                                      showMessageContent) && (
                                      <>
                                        {message.from === MESSAGE_ROLES.USER &&
                                          renderUserAttachments(message)}
                                        {showAgentToolResults && (
                                          <AgentToolResultCard
                                            message={message}
                                            onApproveAgentToolCalls={
                                              onApproveAgentToolCalls
                                            }
                                          />
                                        )}
                                        {showMessageContent && displayContent && (
                                          <MessageContent
                                            variant='flat'
                                            className={cn(
                                              getMessageContentStyles()
                                            )}
                                          >
                                            <Response>{displayContent}</Response>
                                          </MessageContent>
                                        )}
                                        {!showAgentToolResults && actions}
                                      </>
                                    )
                                  )}
                                </>
                              )
                            })()}
                          </>
                        )}
                      </div>
                    </Message>
                  ))}
                </BranchMessages>

                {/* Branch selector for multiple versions */}
                {versions.length > 1 && (
                  <BranchSelector className='px-0' from={message.from}>
                    <BranchPrevious />
                    <BranchPage />
                    <BranchNext />
                  </BranchSelector>
                )}
              </Branch>
            )
          })}
        </div>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
