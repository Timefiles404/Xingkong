import { api } from '@/lib/api'
import { IMAGE_PLAYGROUND_ENDPOINTS } from './constants'
import type {
  GroupOption,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageGenerationTaskCreateResponse,
  ImageGenerationTaskStatusResponse,
  ModelOption,
} from './types'

export async function getUserImageModels(): Promise<ModelOption[]> {
  const res = await api.get(IMAGE_PLAYGROUND_ENDPOINTS.USER_MODELS, {
    params: { capability: 'image-generation' },
  })
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(IMAGE_PLAYGROUND_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

export async function generateImages(
  payload: ImageGenerationRequest
): Promise<ImageGenerationResponse> {
  const res = await api.post(IMAGE_PLAYGROUND_ENDPOINTS.GENERATIONS, payload, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

function unwrapApiData<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'success' in payload &&
    'data' in payload
  ) {
    return (payload as { data: T }).data
  }
  return payload as T
}

export async function createImageGenerationTask(
  payload: ImageGenerationRequest
): Promise<ImageGenerationTaskCreateResponse> {
  const res = await api.post(IMAGE_PLAYGROUND_ENDPOINTS.GENERATION_TASKS, payload, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return unwrapApiData<ImageGenerationTaskCreateResponse>(res.data)
}

export async function editImages(
  payload: FormData
): Promise<ImageGenerationResponse> {
  const res = await api.post(IMAGE_PLAYGROUND_ENDPOINTS.EDITS, payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

export async function createImageEditTask(
  payload: FormData
): Promise<ImageGenerationTaskCreateResponse> {
  const res = await api.post(IMAGE_PLAYGROUND_ENDPOINTS.EDIT_TASKS, payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return unwrapApiData<ImageGenerationTaskCreateResponse>(res.data)
}

export async function getImageGenerationTask(
  taskId: string
): Promise<ImageGenerationTaskStatusResponse> {
  const res = await api.get(IMAGE_PLAYGROUND_ENDPOINTS.TASK_STATUS(taskId), {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return unwrapApiData<ImageGenerationTaskStatusResponse>(res.data)
}
