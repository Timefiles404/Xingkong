import { useRef, useState } from 'react'
import {
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  ImageIcon,
  Loader2Icon,
  PaperclipIcon,
  ScreenShareIcon,
  SendIcon,
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
  ImagePlaygroundAttachment,
  ModelOption,
} from '../types'

interface ImagePlaygroundInputProps {
  onSubmit: (text: string, attachments: ImagePlaygroundAttachment[]) => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
}

const MAX_FILE_SIZE = 8 * 1024 * 1024

async function convertPromptFilesToAttachments(
  files: FileUIPart[]
): Promise<ImagePlaygroundAttachment[]> {
  return files
    .filter((file) => file.mediaType?.startsWith('image/') && file.url)
    .map((file, index) => ({
      id: `${file.filename || 'image'}-${index}`,
      type: 'image' as const,
      name: file.filename || `reference-${index + 1}`,
      mimeType: file.mediaType,
      url: file.url,
    }))
}

function SubmitButton({
  disabled,
  text,
}: {
  disabled?: boolean
  text: string
}) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()

  return (
    <PromptInputButton
      className='text-foreground rounded-full font-medium'
      disabled={disabled || (!text.trim() && attachments.files.length === 0)}
      type='submit'
      variant='secondary'
    >
      <SendIcon size={16} />
      <span className='hidden sm:inline'>{t('Generate')}</span>
      <span className='sr-only sm:hidden'>{t('Generate')}</span>
    </PromptInputButton>
  )
}

function AttachmentMenu({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  const [capturingScreen, setCapturingScreen] = useState(false)
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

      attachments.add([
        new File([blob], `reference-${Date.now()}.png`, { type: 'image/png' }),
      ])
      toast.success(t('Reference image added'))
      track.stop()
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
            <span className='hidden sm:inline'>{t('Reference')}</span>
            <span className='sr-only sm:hidden'>{t('Reference')}</span>
            <ChevronDownIcon className='hidden size-4 sm:block' />
          </PromptInputButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
            <ImageIcon className='mr-2' size={16} />
            {t('Upload reference image')}
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

export function ImagePlaygroundInput({
  onSubmit,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  groups,
  groupValue,
  onGroupChange,
}: ImagePlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const handleSubmit = async (message: PromptInputMessage) => {
    const trimmedText = message.text?.trim() || ''
    const attachments = await convertPromptFilesToAttachments(message.files || [])

    if (!trimmedText && attachments.length === 0) return
    if (disabled) return

    onSubmit(trimmedText, attachments)
    setText('')
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        accept='image/*'
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
          placeholder={t('Describe the image you want to create')}
          value={text}
        />

        <PromptInputFooter className='p-2.5'>
          <PromptInputTools>
            <AttachmentMenu disabled={disabled || isGenerating} />

            <div className='text-muted-foreground hidden items-center gap-2 text-xs lg:flex'>
              <CheckIcon className='size-3.5' />
              <span>
                {t(
                  'Only the latest generated image, your current reference images, and your prompt are sent upstream.'
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
              disabled={disabled || !models.length || !groups.length}
            />

            <SubmitButton disabled={disabled || isGenerating} text={text} />
          </div>
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
