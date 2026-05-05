import { SSE } from 'sse.js'
import { chargeExternalAgentRequestFee } from '../api'
import { API_ENDPOINTS } from '../constants'
import type {
  AgentExternalProvider,
  ChatCompletionChunk,
  ChatCompletionRequest,
} from '../types'
import { getCommonHeaders } from '@/lib/api'
import { getCompleteAgentToolBlockEnd, getVisibleAgentContent } from './agent-tools'
import type { AgentStreamControl } from './agent-responses'

const MAX_STREAM_RETRIES = 5
const STREAM_RETRY_DELAYS = [5000, 20000, 45000, 90000, 120000]

function getAgentStreamDisplayContent(content: string): string {
  const visible = getVisibleAgentContent(content)
  if (visible) return visible
  return ''
}

export function externalEndpoint(baseUrl: string, endpoint: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
}

export async function chargeExternalRequestFeeOnce(): Promise<void> {
  await chargeExternalAgentRequestFee()
}

function removeDefaultSamplingParams(payload: Record<string, unknown>) {
  if (payload.top_p === 1) delete payload.top_p
  if (payload.frequency_penalty === 0) delete payload.frequency_penalty
  if (payload.presence_penalty === 0) delete payload.presence_penalty
}

export function streamAgentCompletion(
  payload: ChatCompletionRequest,
  onVisibleContent: (content: string) => void,
  onReconnect: (error: string, attempt: number, maxAttempts: number) => void,
  control: AgentStreamControl
): Promise<string> {
  let retryCount = 0

  const run = async (): Promise<string> => {
    try {
      return await streamAgentCompletionOnce(payload, onVisibleContent, control)
    } catch (error) {
      if (control.stopped) throw error
      if (retryCount >= MAX_STREAM_RETRIES) throw error

      retryCount += 1
      const delayMs =
        STREAM_RETRY_DELAYS[retryCount - 1] ||
        STREAM_RETRY_DELAYS[STREAM_RETRY_DELAYS.length - 1]
      onReconnect(
        error instanceof Error ? error.message : 'stream_error',
        retryCount,
        MAX_STREAM_RETRIES
      )

      await new Promise<void>((resolve, reject) => {
        control.retryTimer = setTimeout(() => {
          control.retryTimer = null
          if (control.stopped) {
            reject(new Error('agent_stopped'))
            return
          }
          resolve()
        }, delayMs)
      })

      return run()
    }
  }

  return run()
}

function streamAgentCompletionOnce(
  payload: ChatCompletionRequest,
  onVisibleContent: (content: string) => void,
  control: AgentStreamControl
): Promise<string> {
  return new Promise((resolve, reject) => {
    let rawContent = ''
    let settled = false
    const source = new SSE(API_ENDPOINTS.CHAT_COMPLETIONS, {
      headers: getCommonHeaders(),
      method: 'POST',
      payload: JSON.stringify({ ...payload, stream: true }),
    })
    control.source = source

    const close = () => {
      source.close()
      if (control.source === source) control.source = null
    }
    const finish = (content: string) => {
      if (settled) return
      settled = true
      close()
      resolve(content)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      close()
      reject(error)
    }

    source.addEventListener('message', (event: MessageEvent) => {
      if (settled || control.stopped) return
      if (event.data === '[DONE]') {
        finish(rawContent)
        return
      }

      try {
        const chunk: ChatCompletionChunk = JSON.parse(event.data)
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) {
          rawContent += delta.content
          const toolBlockEnd = getCompleteAgentToolBlockEnd(rawContent)
          if (toolBlockEnd !== null) {
            rawContent = rawContent.slice(0, toolBlockEnd)
            onVisibleContent(getAgentStreamDisplayContent(rawContent))
            finish(rawContent)
            return
          }
          onVisibleContent(getAgentStreamDisplayContent(rawContent))
        }
      } catch (error) {
        fail(error)
      }
    })

    source.addEventListener('error', (event: Event & { data?: string }) => {
      if (settled || control.stopped) return
      let message = event.data || 'stream_error'
      if (event.data) {
        try {
          const parsed = JSON.parse(event.data) as {
            error?: { message?: string }
          }
          message = parsed.error?.message || message
        } catch {
          // keep raw message
        }
      }
      fail(new Error(message))
    })

    try {
      if (control.stopped) {
        fail(new Error('agent_stopped'))
        return
      }
      source.stream()
    } catch (error) {
      fail(error)
    }
  })
}

export function streamExternalAgentChatCompletion(
  provider: AgentExternalProvider,
  payload: ChatCompletionRequest,
  onVisibleContent: (content: string) => void,
  onReconnect: (error: string, attempt: number, maxAttempts: number) => void,
  control: AgentStreamControl
): Promise<string> {
  let retryCount = 0

  const run = async (): Promise<string> => {
    try {
      await chargeExternalRequestFeeOnce()
      return await streamExternalAgentChatCompletionOnce(
        provider,
        payload,
        onVisibleContent,
        control
      )
    } catch (error) {
      if (control.stopped) throw error
      if (retryCount >= MAX_STREAM_RETRIES) throw error
      retryCount += 1
      const delayMs =
        STREAM_RETRY_DELAYS[retryCount - 1] ||
        STREAM_RETRY_DELAYS[STREAM_RETRY_DELAYS.length - 1]
      onReconnect(
        error instanceof Error ? error.message : 'external_stream_error',
        retryCount,
        MAX_STREAM_RETRIES
      )
      await new Promise<void>((resolve, reject) => {
        control.retryTimer = setTimeout(() => {
          control.retryTimer = null
          if (control.stopped) reject(new Error('agent_stopped'))
          else resolve()
        }, delayMs)
      })
      return run()
    }
  }

  return run()
}

function streamExternalAgentChatCompletionOnce(
  provider: AgentExternalProvider,
  payload: ChatCompletionRequest,
  onVisibleContent: (content: string) => void,
  control: AgentStreamControl
): Promise<string> {
  return new Promise((resolve, reject) => {
    let rawContent = ''
    let settled = false
    const externalPayload = {
      ...payload,
      model: provider.selectedModel || payload.model,
      stream: true,
    } as Record<string, unknown>
    delete externalPayload.group
    delete externalPayload.prompt_cache_key
    removeDefaultSamplingParams(externalPayload)
    const source = new SSE(externalEndpoint(provider.baseUrl, '/chat/completions'), {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      method: 'POST',
      payload: JSON.stringify(externalPayload),
    })
    control.source = source

    const close = () => {
      source.close()
      if (control.source === source) control.source = null
    }
    const finish = (content: string) => {
      if (settled) return
      settled = true
      close()
      resolve(content)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      close()
      reject(error)
    }

    source.addEventListener('message', (event: MessageEvent) => {
      if (settled || control.stopped) return
      if (event.data === '[DONE]') {
        finish(rawContent)
        return
      }
      try {
        const chunk: ChatCompletionChunk = JSON.parse(event.data)
        const content = chunk.choices?.[0]?.delta?.content
        if (content) {
          rawContent += content
          const toolBlockEnd = getCompleteAgentToolBlockEnd(rawContent)
          if (toolBlockEnd !== null) {
            rawContent = rawContent.slice(0, toolBlockEnd)
            onVisibleContent(getAgentStreamDisplayContent(rawContent))
            finish(rawContent)
            return
          }
          onVisibleContent(getAgentStreamDisplayContent(rawContent))
        }
      } catch (error) {
        fail(error)
      }
    })
    source.addEventListener('error', (event: Event & { data?: string }) => {
      if (settled || control.stopped) return
      fail(new Error(event.data || 'external_stream_error'))
    })

    try {
      source.stream()
    } catch (error) {
      fail(error)
    }
  })
}
