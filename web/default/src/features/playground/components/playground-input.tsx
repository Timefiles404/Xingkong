import { useRef, useState } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  PaperclipIcon,
  ScreenShareIcon,
  CameraIcon,
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
  PlaygroundAttachment,
} from '../types'

interface PlaygroundInputProps {
  onSubmit: (text: string, attachments: PlaygroundAttachment[]) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
}

const TEXT_FILE_ACCEPT =
  '.txt,.md,.markdown,.json,.jsonl,.csv,.tsv,.yaml,.yml,.xml,.html,.css,.scss,.js,.jsx,.ts,.tsx,.py,.go,.java,.c,.cpp,.h,.hpp,.rs,.sh,.sql,.log'
const MAX_FILE_SIZE = 5 * 1024 * 1024

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

export function PlaygroundInput({
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const isModelSelectDisabled =
    disabled || isModelLoading || models.length === 0
  const isGroupSelectDisabled = disabled || groups.length === 0

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
          className='px-5 md:text-base'
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Ask anything')}
          value={text}
        />

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
