import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { DEFAULT_CONFIG, DEFAULT_GROUP } from './constants'
import {
  createImageEditTask,
  createImageGenerationTask,
  getImageGenerationTask,
  getUserGroups,
  getUserImageModels,
} from './api'
import { ImagePlaygroundChat } from './components/image-playground-chat'
import { ImagePlaygroundHistorySidebar } from './components/image-playground-history-sidebar'
import { ImagePlaygroundInput } from './components/image-playground-input'
import {
  createConversation,
  getConversationTitle,
  loadConfig,
  loadConversationState,
  saveConfig,
  saveConversationState,
} from './storage'
import type {
  GeneratedImage,
  GroupOption,
  ImageGenerationResponse,
  ImageGenerationTaskStatusResponse,
  ImagePlaygroundAttachment,
  ImagePlaygroundConfig,
  ImagePlaygroundConversation,
  ImagePlaygroundMessage,
  ModelOption,
} from './types'

function stringifyErrorDetails(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatImageGenerationError(error: unknown): {
  summary: string
  details: string
} {
  const fallbackSummary = 'Image generation failed'

  if (!error || typeof error !== 'object') {
    return {
      summary: fallbackSummary,
      details: fallbackSummary,
    }
  }

  const err = error as {
    response?: {
      status?: number
      data?: {
        message?: string
        error?: {
          message?: string
          type?: string
          code?: unknown
          param?: string
          metadata?: unknown
        }
      }
    }
    message?: string
  }

  const responseData = err.response?.data
  const openAIError = responseData?.error
  const summary =
    openAIError?.message ||
    responseData?.message ||
    err.message ||
    fallbackSummary

  const detailParts: string[] = [summary]

  if (err.response?.status) {
    detailParts.push(`HTTP ${err.response.status}`)
  }
  if (openAIError?.type) {
    detailParts.push(`type: ${openAIError.type}`)
  }
  if (openAIError?.code != null && openAIError.code !== '') {
    detailParts.push(`code: ${String(openAIError.code)}`)
  }
  if (openAIError?.param) {
    detailParts.push(`param: ${openAIError.param}`)
  }
  if (openAIError?.metadata != null) {
    detailParts.push(`metadata:\n${stringifyErrorDetails(openAIError.metadata)}`)
  }

  const rawPayload =
    responseData && !openAIError?.metadata
      ? stringifyErrorDetails(responseData)
      : ''
  if (rawPayload && rawPayload !== summary) {
    detailParts.push(`response:\n${rawPayload}`)
  }

  return {
    summary,
    details: detailParts.join('\n'),
  }
}

function createUserMessage(
  prompt: string,
  attachments: ImagePlaygroundAttachment[]
): ImagePlaygroundMessage {
  return {
    key: nanoid(),
    from: 'user',
    prompt,
    attachments,
    createdAt: Date.now(),
  }
}

function createLoadingAssistantMessage(): ImagePlaygroundMessage {
  return {
    key: nanoid(),
    from: 'assistant',
    prompt: '',
    status: 'loading',
    createdAt: Date.now(),
  }
}

function toGeneratedImages(response: ImageGenerationResponse): GeneratedImage[] {
  return (response.data || []).map((item, index) => ({
    id: `${Date.now()}-${index}`,
    url: item.b64_json
      ? `data:image/png;base64,${item.b64_json}`
      : (item.url ?? ''),
    revisedPrompt: item.revised_prompt,
  }))
}

function isImageGenerationResponse(
  value: unknown
): value is ImageGenerationResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as ImageGenerationResponse).data)
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildImageTaskError(task: ImageGenerationTaskStatusResponse): Error {
  const response =
    task.response && typeof task.response === 'object'
      ? JSON.stringify(task.response, null, 2)
      : ''
  const detailParts = [
    task.error || 'Image generation failed',
    task.status_code ? `HTTP ${task.status_code}` : '',
    response ? `response:\n${response}` : '',
  ].filter(Boolean)
  return new Error(detailParts.join('\n'))
}

async function buildImageEditFormData(
  model: string,
  group: string,
  prompt: string,
  referenceImages: string[]
): Promise<FormData> {
  const formData = new FormData()
  formData.append('model', model)
  formData.append('group', group)
  formData.append('prompt', prompt)
  formData.append('response_format', 'b64_json')

  const files = await Promise.all(
    referenceImages.map((url, index) => imageUrlToFile(url, index))
  )
  files.forEach((file) => {
    formData.append('image[]', file)
  })
  return formData
}

async function imageUrlToFile(url: string, index: number): Promise<File> {
  const response = await fetch(url)
  const blob = await response.blob()
  const mimeType = blob.type || 'image/png'
  const extension = mimeType.split('/')[1] || 'png'
  return new File([blob], `reference-${index + 1}.${extension}`, {
    type: mimeType,
  })
}

function findLastAssistantImages(
  messages: ImagePlaygroundMessage[]
): GeneratedImage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.from === 'assistant' && message.images?.length) {
      return message.images
    }
  }
  return []
}

export function ImagePlayground() {
  const [config, setConfig] = useState<ImagePlaygroundConfig>(() => loadConfig())
  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const inFlightTaskIdsRef = useRef<Set<string>>(new Set())
  const [conversationState, setConversationState] = useState(() => {
    const loaded = loadConversationState()
    if (loaded.conversations.length > 0 && loaded.activeConversationId) {
      return loaded
    }

    const initialConversation = createConversation()
    return {
      conversations: [initialConversation],
      activeConversationId: initialConversation.id,
    }
  })

  const { conversations, activeConversationId } = conversationState
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ||
    conversations[0]
  const messages = activeConversation?.messages || []

  const persistConversationState = useCallback(
    (
      nextConversations: ImagePlaygroundConversation[],
      nextActiveConversationId: string | null
    ) => {
      saveConversationState(nextConversations, nextActiveConversationId)
      return {
        conversations: nextConversations,
        activeConversationId: nextActiveConversationId,
      }
    },
    []
  )

  const updateConversationMessages = useCallback(
    (
      conversationId: string,
      updater:
        | ImagePlaygroundMessage[]
        | ((prev: ImagePlaygroundMessage[]) => ImagePlaygroundMessage[])
    ) => {
      setConversationState((prevState) => {
        const now = Date.now()
        const nextConversations = prevState.conversations.map((conversation) => {
          if (conversation.id !== conversationId) return conversation

          const newMessages =
            typeof updater === 'function'
              ? updater(conversation.messages)
              : updater

          return {
            ...conversation,
            messages: newMessages,
            title: getConversationTitle(newMessages),
            updatedAt: now,
          }
        })

        return persistConversationState(
          nextConversations,
          prevState.activeConversationId
        )
      })
    },
    [persistConversationState]
  )

  const updateTaskMessage = useCallback(
    (taskId: string, patch: Partial<ImagePlaygroundMessage>) => {
      setConversationState((prevState) => {
        const nextConversations = prevState.conversations.map((conversation) => {
          let changed = false
          const newMessages = conversation.messages.map((message) => {
            if (message.taskId !== taskId) return message
            changed = true
            return {
              ...message,
              ...patch,
            }
          })
          if (!changed) return conversation
          return {
            ...conversation,
            messages: newMessages,
            title: getConversationTitle(newMessages),
            updatedAt: Date.now(),
          }
        })

        return persistConversationState(
          nextConversations,
          prevState.activeConversationId
        )
      })
    },
    [persistConversationState]
  )

  const createNewConversation = useCallback(() => {
    setConversationState((prevState) => {
      const conversation = createConversation()
      const nextConversations = [conversation, ...prevState.conversations]
      return persistConversationState(nextConversations, conversation.id)
    })
  }, [persistConversationState])

  const switchConversation = useCallback(
    (conversationId: string) => {
      setConversationState((prevState) => {
        if (!prevState.conversations.some((item) => item.id === conversationId)) {
          return prevState
        }
        return persistConversationState(prevState.conversations, conversationId)
      })
    },
    [persistConversationState]
  )

  const deleteConversation = useCallback(
    (conversationId: string) => {
      setConversationState((prevState) => {
        const remaining = prevState.conversations.filter(
          (conversation) => conversation.id !== conversationId
        )
        if (remaining.length === 0) {
          const replacement = createConversation()
          return persistConversationState([replacement], replacement.id)
        }

        const nextActiveConversationId =
          prevState.activeConversationId === conversationId
            ? remaining[0].id
            : prevState.activeConversationId

        return persistConversationState(remaining, nextActiveConversationId)
      })
    },
    [persistConversationState]
  )

  const { data: modelsData } = useQuery({
    queryKey: ['image-playground-models'],
    queryFn: getUserImageModels,
  })

  const { data: groupsData } = useQuery({
    queryKey: ['image-playground-groups'],
    queryFn: getUserGroups,
  })

  useEffect(() => {
    if (!modelsData) return
    setModels(modelsData)
    const nextModel = modelsData[0]?.value || ''
    const isCurrentModelValid = modelsData.some((m) => m.value === config.model)
    if (!isCurrentModelValid && config.model !== nextModel) {
      setConfig((prev) => {
        const updated = {
          ...prev,
          model: nextModel,
        }
        saveConfig(updated)
        return updated
      })
    }
  }, [config.model, modelsData])

  useEffect(() => {
    if (!groupsData) return
    const processedGroups = groupsData.filter((group) => group.value !== 'auto')
    setGroups(processedGroups)
    const nextGroup = processedGroups[0]?.value || DEFAULT_GROUP
    const isCurrentGroupValid = processedGroups.some(
      (group) => group.value === config.group
    )
    if (!isCurrentGroupValid && config.group !== nextGroup) {
      setConfig((prev) => {
        const updated = {
          ...prev,
          group: nextGroup,
        }
        saveConfig(updated)
        return updated
      })
    }
  }, [config.group, groupsData])

  const updateConfig = useCallback(
    <K extends keyof ImagePlaygroundConfig>(
      key: K,
      value: ImagePlaygroundConfig[K]
    ) => {
      setConfig((prev) => {
        const updated = { ...prev, [key]: value }
        saveConfig(updated)
        return updated
      })
    },
    []
  )

  const canSubmit = useMemo(
    () => Boolean(config.model && config.group),
    [config.group, config.model]
  )
  const activeConversationIsGenerating = useMemo(
    () => messages.some((message) => message.status === 'loading'),
    [messages]
  )

  const waitForImageTask = useCallback(
    async (taskId: string) => {
      const maxAttempts = 120
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const task = await getImageGenerationTask(taskId)
        if (task.status === 'succeeded') {
          if (!isImageGenerationResponse(task.response)) {
            throw new Error('No image was returned.')
          }
          const images = toGeneratedImages(task.response).filter((item) => item.url)
          updateTaskMessage(taskId, {
            status: 'complete',
            images,
            errorMessage: undefined,
          })
          return
        }
        if (task.status === 'failed') {
          throw buildImageTaskError(task)
        }
        await sleep(3000)
      }
      throw new Error('图片生成仍在进行，请稍后打开历史记录查看。')
    },
    [updateTaskMessage]
  )

  const handleSubmit = useCallback(
    async (prompt: string, attachments: ImagePlaygroundAttachment[]) => {
      if (!canSubmit || activeConversationIsGenerating || !activeConversation?.id) {
        return
      }

      const conversationId = activeConversation.id
      const userMessage = createUserMessage(prompt, attachments)
      const loadingMessage = createLoadingAssistantMessage()
      const nextMessages = [...messages, userMessage, loadingMessage]
      updateConversationMessages(conversationId, nextMessages)
      let submittedTaskId: string | null = null

      try {
        const latestAssistantImages = findLastAssistantImages(messages)
        const referenceImages = [
          ...latestAssistantImages.map((item) => item.url),
          ...attachments.map((item) => item.url),
        ]

        const task =
          referenceImages.length > 0
            ? await createImageEditTask(
                await buildImageEditFormData(
                  config.model,
                  config.group,
                  prompt,
                  referenceImages
                )
              )
            : await createImageGenerationTask({
                model: config.model,
                group: config.group,
                prompt,
                response_format: 'b64_json',
              })
        submittedTaskId = task.id
        inFlightTaskIdsRef.current.add(task.id)

        updateConversationMessages(conversationId, (prev) =>
          prev.map((message) =>
            message.key === loadingMessage.key
              ? {
                  ...message,
                  taskId: task.id,
                }
              : message
          )
        )
        await waitForImageTask(task.id)
      } catch (error: unknown) {
        const { summary, details } = formatImageGenerationError(error)
        toast.error(summary)
        updateConversationMessages(conversationId, (prev) =>
          prev.map((message) =>
            message.key === loadingMessage.key ||
            (submittedTaskId && message.taskId === submittedTaskId)
              ? {
                  ...message,
                  status: 'error',
                  errorMessage: details,
                }
              : message
          )
        )
      } finally {
        if (submittedTaskId) {
          inFlightTaskIdsRef.current.delete(submittedTaskId)
        }
      }
    },
    [
      activeConversation?.id,
      activeConversationIsGenerating,
      canSubmit,
      config.group,
      config.model,
      messages,
      updateConversationMessages,
      waitForImageTask,
    ]
  )

  useEffect(() => {
    const pendingTaskIds = Array.from(
      new Set(
        conversations.flatMap((conversation) =>
          conversation.messages
            .filter((message) => message.status === 'loading' && message.taskId)
            .map((message) => message.taskId as string)
        )
      )
    ).filter((taskId) => !inFlightTaskIdsRef.current.has(taskId))

    if (pendingTaskIds.length === 0) return

    pendingTaskIds.forEach((taskId) => {
      inFlightTaskIdsRef.current.add(taskId)
      void (async () => {
        try {
          await waitForImageTask(taskId)
        } catch (error) {
          const { details } = formatImageGenerationError(error)
          updateTaskMessage(taskId, {
            status: 'error',
            errorMessage: details,
          })
        } finally {
          inFlightTaskIdsRef.current.delete(taskId)
        }
      })()
    })
  }, [conversations, updateTaskMessage, waitForImageTask])

  return (
    <div className='relative flex size-full flex-col overflow-hidden'>
      {activeConversationId && (
        <ImagePlaygroundHistorySidebar
          activeConversationId={activeConversationId}
          conversations={conversations}
          onCreateConversation={createNewConversation}
          onDeleteConversation={deleteConversation}
          onSelectConversation={switchConversation}
        />
      )}

      <div className='flex flex-1 flex-col overflow-hidden'>
        <ImagePlaygroundChat messages={messages} />
      </div>

      <div className='mx-auto w-full max-w-5xl'>
        <ImagePlaygroundInput
          disabled={activeConversationIsGenerating}
          groupValue={config.group}
          groups={groups}
          isGenerating={activeConversationIsGenerating}
          modelValue={config.model}
          models={models}
          onGroupChange={(value) => updateConfig('group', value)}
          onModelChange={(value) => updateConfig('model', value)}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  )
}
