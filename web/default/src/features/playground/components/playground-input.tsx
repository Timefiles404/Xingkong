import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  PaperclipIcon,
  ScreenShareIcon,
  CameraIcon,
  GaugeIcon,
  BrainCircuitIcon,
  SendIcon,
  SquareIcon,
} from 'lucide-react'
import type { FileUIPart } from 'ai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ModelGroupSelector } from '@/components/model-group-selector'
import type {
  GroupOption,
  ModelOption,
  OpenAIReasoningEffort,
  OpenAIRequestMode,
  PlaygroundAttachment,
} from '../types'
import {
  formatFileReference,
  getFileNameFromPath,
  isOpenAIReasoningModel,
  parseFileReferenceHref,
} from '../lib'

interface PlaygroundInputProps {
  onSubmit: (text: string, attachments: PlaygroundAttachment[]) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  reasoningEffort: OpenAIReasoningEffort
  onReasoningEffortChange: (value: OpenAIReasoningEffort) => void
  requestMode: OpenAIRequestMode
  onRequestModeChange: (value: OpenAIRequestMode) => void
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  agentMode?: boolean
}

const TEXT_FILE_ACCEPT =
  '.txt,.md,.markdown,.json,.jsonl,.csv,.tsv,.yaml,.yml,.xml,.html,.css,.scss,.js,.jsx,.ts,.tsx,.py,.go,.java,.c,.cpp,.h,.hpp,.rs,.sh,.sql,.log'
const MAX_FILE_SIZE = 5 * 1024 * 1024

const REASONING_EFFORT_OPTIONS: Array<{
  value: OpenAIReasoningEffort
  label: string
}> = [
  { value: 'none', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
]

function isTextLikeFile(file: FileUIPart): boolean {
  const mimeType = file.mediaType || ''
  const fileName = (file.filename || '').toLowerCase()
  if (mimeType.startsWith('text/')) return true
  if (
    [
      'application/json',
      'application/xml',
      'application/javascript',
      'application/typescript',
    ].includes(mimeType)
  ) {
    return true
  }

  return /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|xml|html?|css|scss|js|jsx|ts|tsx|py|go|java|c|cpp|h|hpp|rs|sh|sql|log)$/i.test(
    fileName
  )
}

async function filePartToAttachment(
  file: FileUIPart,
  index: number
): Promise<PlaygroundAttachment | null> {
  const name = file.filename || `attachment-${index + 1}`
  const mimeType = file.mediaType || ''
  if (mimeType.startsWith('image/')) {
    return {
      id: `${name}-${index}`,
      type: 'image',
      name,
      mimeType,
      size: undefined,
      url: file.url,
    }
  }

  if (!isTextLikeFile(file)) {
    return null
  }

  const textContent = await fetch(file.url).then((response) => response.text())

  return {
    id: `${name}-${index}`,
    type: 'text',
    name,
    mimeType,
    size: undefined,
    textContent,
  }
}

async function convertPromptFilesToAttachments(
  files: FileUIPart[]
): Promise<PlaygroundAttachment[]> {
  const converted = await Promise.all(
    files.map((file, index) => filePartToAttachment(file, index))
  )
  return converted.filter((item): item is PlaygroundAttachment => item !== null)
}

function SubmitActionButton({
  disabled = false,
  isGenerating = false,
  text,
  onStop,
}: {
  disabled?: boolean
  isGenerating?: boolean
  text: string
  onStop?: () => void
}) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()

  if (isGenerating && onStop) {
    return (
      <PromptInputButton
        className='text-foreground rounded-full font-medium'
        onClick={onStop}
        variant='secondary'
      >
        <SquareIcon className='fill-current' size={16} />
        <span className='hidden sm:inline'>{t('Stop')}</span>
        <span className='sr-only sm:hidden'>{t('Stop')}</span>
      </PromptInputButton>
    )
  }

  return (
    <PromptInputButton
      className='text-foreground rounded-full font-medium'
      disabled={disabled || (!text.trim() && attachments.files.length === 0)}
      type='submit'
      variant='secondary'
    >
      <SendIcon size={16} />
      <span className='hidden sm:inline'>{t('Send')}</span>
      <span className='sr-only sm:hidden'>{t('Send')}</span>
    </PromptInputButton>
  )
}

function serializeAgentEditor(root: HTMLDivElement | null): string {
  if (!root) return ''

  const serializeNode = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (!(node instanceof HTMLElement)) return node.textContent || ''

    const filePath = node.dataset.filePath
    if (filePath) return formatFileReference(filePath)
    if (node.tagName === 'BR') return '\n'

    const childText = Array.from(node.childNodes).map(serializeNode).join('')
    if (node.tagName === 'DIV' || node.tagName === 'P') return `${childText}\n`
    return childText
  }

  return Array.from(root.childNodes).map(serializeNode).join('').trim()
}

function getFileTokenIcon(kind?: string): string {
  if (kind === 'directory') {
    return `<svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`
  }
  return `<svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`
}

function createFileToken(path: string, kind?: string): HTMLSpanElement {
  const token = document.createElement('span')
  token.contentEditable = 'false'
  token.dataset.filePath = path
  token.dataset.fileKind = kind || 'file'
  token.className =
    'mx-0.5 inline-flex max-w-[14rem] select-all items-center gap-1 rounded-[5px] border bg-muted px-1.5 py-0.5 align-baseline text-xs font-medium text-foreground shadow-xs'
  token.innerHTML = `${getFileTokenIcon(kind)}<span class="truncate">${getFileNameFromPath(path)}</span>`
  token.title = path
  return token
}

function insertNodeAtSelection(node: Node) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  range.deleteContents()
  range.insertNode(document.createTextNode(' '))
  range.insertNode(node)
  range.insertNode(document.createTextNode(' '))
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function getDroppedFileEntry(
  event: DragEvent<HTMLDivElement>
): { path: string; kind?: string } | null {
  const direct = event.dataTransfer.getData('application/x-newapi-file-path')
  const kind = event.dataTransfer.getData('application/x-newapi-file-kind')
  if (direct) return { path: direct, kind }
  const text = event.dataTransfer.getData('text/plain')
  const markdownHref = text.match(/\]\((file:\/\/[^)]+)\)/i)?.[1]
  const path = parseFileReferenceHref(markdownHref) || parseFileReferenceHref(text)
  return path ? { path } : null
}

function AgentPromptEditor({
  disabled = false,
  value,
  onChange,
  placeholder,
}: {
  disabled?: boolean
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [isEmpty, setIsEmpty] = useState(true)

  const syncValue = useCallback(() => {
    const nextValue = serializeAgentEditor(editorRef.current)
    onChange(nextValue)
    setIsEmpty(!nextValue)
  }, [onChange])

  useEffect(() => {
    if (value) return
    if (editorRef.current && editorRef.current.textContent) {
      editorRef.current.innerHTML = ''
      setIsEmpty(true)
    }
  }, [value])

  return (
    <div className='relative w-full min-w-0 self-stretch px-5 py-3'>
      {isEmpty && (
        <div className='text-muted-foreground pointer-events-none absolute top-3 left-5 text-base'>
          {placeholder}
        </div>
      )}
      <div
        aria-label={placeholder}
        className='max-h-48 min-h-16 w-full min-w-0 overflow-y-auto whitespace-pre-wrap break-words text-base leading-6 outline-none empty:min-h-16'
        contentEditable={!disabled}
        onBlur={syncValue}
        onDragOver={(event) => {
          if (getDroppedFileEntry(event)) event.preventDefault()
        }}
        onDrop={(event) => {
          const entry = getDroppedFileEntry(event)
          if (!entry) return
          event.preventDefault()
          insertNodeAtSelection(createFileToken(entry.path, entry.kind))
          syncValue()
        }}
        onInput={syncValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            editorRef.current?.closest('form')?.requestSubmit()
          }
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text/plain')
          if (!text) return
          event.preventDefault()
          document.execCommand('insertText', false, text)
          syncValue()
        }}
        ref={editorRef}
        role='textbox'
        spellCheck={false}
        suppressContentEditableWarning
      />
    </div>
  )
}

function AttachmentMenu({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  const [capturingScreen, setCapturingScreen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  const pushFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    attachments.add(fileList)
  }

  const captureScreen = async () => {
    if (
      disabled ||
      capturingScreen ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      return
    }

    let stream: MediaStream | null = null

    try {
      setCapturingScreen(true)
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })

      const track = stream.getVideoTracks()[0]
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      await video.play()
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve()
          return
        }
        video.onloadeddata = () => resolve()
      })

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('canvas_context_unavailable')
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png')
      })

      if (!blob) {
        throw new Error('screen_capture_failed')
      }

      const screenshotFile = new File(
        [blob],
        `screenshot-${Date.now()}.png`,
        { type: 'image/png' }
      )

      attachments.add([screenshotFile])
      toast.success(t('Screenshot added'))
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? t('Screen capture cancelled')
          : t('Unable to capture screen')
      toast.error(message)
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
      setCapturingScreen(false)
    }
  }

  return (
    <>
      <input
        accept={TEXT_FILE_ACCEPT}
        className='hidden'
        onChange={(event) => {
          pushFiles(event.target.files)
          event.target.value = ''
        }}
        ref={fileInputRef}
        type='file'
      />
      <input
        accept='image/*'
        className='hidden'
        multiple
        onChange={(event) => {
          pushFiles(event.target.files)
          event.target.value = ''
        }}
        ref={imageInputRef}
        type='file'
      />
      <input
        accept='image/*'
        capture='environment'
        className='hidden'
        onChange={(event) => {
          pushFiles(event.target.files)
          event.target.value = ''
        }}
        ref={cameraInputRef}
        type='file'
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PromptInputButton
            className='!rounded-full border font-medium'
            disabled={disabled}
            variant='outline'
          >
            <PaperclipIcon size={16} />
            <span className='hidden sm:inline'>{t('Attach')}</span>
            <span className='sr-only sm:hidden'>{t('Attach')}</span>
            <ChevronDownIcon className='hidden size-4 sm:block' />
          </PromptInputButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <FileIcon className='mr-2' size={16} />
            {t('Upload file')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
            <ImageIcon className='mr-2' size={16} />
            {t('Upload photo')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={capturingScreen}
            onClick={() => void captureScreen()}
          >
            {capturingScreen ? (
              <Loader2Icon className='mr-2 animate-spin' size={16} />
            ) : (
              <ScreenShareIcon className='mr-2' size={16} />
            )}
            {capturingScreen ? t('Capturing...') : t('Take screenshot')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
            <CameraIcon className='mr-2' size={16} />
            {t('Take photo')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

function OpenAIRequestControls({
  disabled = false,
  reasoningEffort,
  onReasoningEffortChange,
  requestMode,
  onRequestModeChange,
}: {
  disabled?: boolean
  reasoningEffort: OpenAIReasoningEffort
  onReasoningEffortChange: (value: OpenAIReasoningEffort) => void
  requestMode: OpenAIRequestMode
  onRequestModeChange: (value: OpenAIRequestMode) => void
}) {
  const { t } = useTranslation()
  const selectedEffort =
    REASONING_EFFORT_OPTIONS.find((item) => item.value === reasoningEffort) ||
    REASONING_EFFORT_OPTIONS[3]
  const requestModeOptions: Array<{
    value: OpenAIRequestMode
    label: string
    description: string
  }> = [
    {
      value: 'standard',
      label: 'Standard mode',
      description: 'Use Responses endpoint when available',
    },
    {
      value: 'fast',
      label: 'Fast mode',
      description: 'Request priority/fast service tier',
    },
    {
      value: 'compatible',
      label: 'OpenAI compatible mode',
      description: 'Use Chat Completions and XML tools',
    },
  ]
  const selectedRequestMode =
    requestModeOptions.find((item) => item.value === requestMode) ||
    requestModeOptions[0]

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PromptInputButton
            className='!rounded-full border font-medium'
            disabled={disabled}
            variant='outline'
          >
            <BrainCircuitIcon size={16} />
            <span className='hidden sm:inline'>
              {t('Reasoning')}: {t(selectedEffort.label)}
            </span>
            <span className='sr-only sm:hidden'>{t('Reasoning')}</span>
            <ChevronDownIcon className='hidden size-4 sm:block' />
          </PromptInputButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>{t('Reasoning effort')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={reasoningEffort}
            onValueChange={(value) =>
              onReasoningEffortChange(value as OpenAIReasoningEffort)
            }
          >
            {REASONING_EFFORT_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {t(option.label)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PromptInputButton
            className='!rounded-full border font-medium'
            disabled={disabled}
            type='button'
            variant={requestMode === 'standard' ? 'outline' : 'secondary'}
          >
            <GaugeIcon size={16} />
            <span className='hidden sm:inline'>{t(selectedRequestMode.label)}</span>
            <span className='sr-only sm:hidden'>{t('Request mode')}</span>
            <ChevronDownIcon className='hidden size-4 sm:block' />
          </PromptInputButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <DropdownMenuLabel>{t('Request mode')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={requestMode}
            onValueChange={(value) =>
              onRequestModeChange(value as OpenAIRequestMode)
            }
          >
            {requestModeOptions.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <div className='grid gap-0.5'>
                  <span>{t(option.label)}</span>
                  <span className='text-muted-foreground text-xs'>
                    {t(option.description)}
                  </span>
                </div>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

export function PlaygroundInput({
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  reasoningEffort,
  onReasoningEffortChange,
  requestMode,
  onRequestModeChange,
  groups,
  groupValue,
  onGroupChange,
  agentMode = false,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const isModelSelectDisabled =
    disabled || isModelLoading || models.length === 0
  const isGroupSelectDisabled = disabled || groups.length === 0
  const showOpenAIControls = isOpenAIReasoningModel(modelValue)

  const handleSubmit = async (message: PromptInputMessage) => {
    const trimmedText = message.text?.trim() || ''
    const attachments = await convertPromptFilesToAttachments(message.files || [])
    const skippedFileCount = (message.files || []).length - attachments.length

    if (!trimmedText && attachments.length === 0) return
    if (disabled) return

    if (skippedFileCount > 0) {
      toast.warning(t('Unsupported files were skipped'), {
        description: t('Only text and image files are supported'),
      })
    }

    onSubmit(trimmedText, attachments)
    setText('')
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        accept={undefined}
        groupClassName='rounded-[20px] [--radius:20px]'
        maxFileSize={MAX_FILE_SIZE}
        maxFiles={8}
        multiple
        onSubmit={handleSubmit}
      >
        <PromptInputHeader className='px-3 pt-3'>
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
        </PromptInputHeader>

        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className={agentMode ? 'hidden' : 'px-5 md:text-base'}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Ask anything')}
          value={text}
        />
        {agentMode && (
          <AgentPromptEditor
            disabled={disabled}
            onChange={setText}
            placeholder={t('Ask anything')}
            value={text}
          />
        )}

        <PromptInputFooter className='p-2.5'>
          <PromptInputTools>
            <AttachmentMenu disabled={disabled} />

            <div className='text-muted-foreground hidden items-center gap-2 text-xs lg:flex'>
              <CheckIcon className='size-3.5' />
              <span>
                {t(
                  'Supports text files, images, screenshots, and camera photos'
                )}
              </span>
            </div>
          </PromptInputTools>

          <div className='flex items-center gap-1.5 md:gap-2'>
            <ModelGroupSelector
              selectedModel={modelValue}
              models={models}
              onModelChange={onModelChange}
              selectedGroup={groupValue}
              groups={groups}
              onGroupChange={onGroupChange}
              disabled={isModelSelectDisabled || isGroupSelectDisabled}
            />

            {showOpenAIControls && (
              <OpenAIRequestControls
                disabled={disabled}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={onReasoningEffortChange}
                requestMode={requestMode}
                onRequestModeChange={onRequestModeChange}
              />
            )}

            <SubmitActionButton
              disabled={disabled}
              isGenerating={isGenerating}
              onStop={onStop}
              text={text}
            />
          </div>
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
