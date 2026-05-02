import { useCallback, useRef, useState } from 'react'
import { SSE } from 'sse.js'
import { getCommonHeaders } from '@/lib/api'
import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants'
import type { ChatCompletionRequest, ChatCompletionChunk } from '../types'

const MAX_STREAM_RETRIES = 5
const STREAM_RETRY_DELAYS = [5000, 20000, 45000, 90000, 120000]

/**
 * Hook for handling streaming chat completion requests
 */
export function useStreamRequest() {
  const sseSourceRef = useRef<SSE | null>(null)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isStreamCompleteRef = useRef(false)
  const stoppedRef = useRef(false)
  const [isStreaming, setIsStreaming] = useState(false)

  const sendStreamRequest = useCallback(
    (
      payload: ChatCompletionRequest,
      onUpdate: (type: 'reasoning' | 'content', chunk: string) => void,
      onComplete: () => void,
      onError: (error: string, errorCode?: string) => void,
      onReconnect?: (
        error: string,
        attempt: number,
        maxAttempts: number,
        delayMs: number,
        errorCode?: string
      ) => void
    ) => {
      isStreamCompleteRef.current = false
      stoppedRef.current = false
      setIsStreaming(true)
      let retryCount = 0

      const clearRetryTimer = () => {
        if (!retryTimeoutRef.current) return
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }

      const closeSource = () => {
        sseSourceRef.current?.close()
        sseSourceRef.current = null
      }

      const finishWithError = (errorMessage: string, errorCode?: string) => {
        if (!isStreamCompleteRef.current && !stoppedRef.current) {
          setIsStreaming(false)
          onError(errorMessage, errorCode)
          closeSource()
        }
      }

      const handleError = (errorMessage: string, errorCode?: string) => {
        if (isStreamCompleteRef.current || stoppedRef.current) return

        closeSource()
        if (retryCount >= MAX_STREAM_RETRIES) {
          finishWithError(errorMessage, errorCode)
          return
        }

        retryCount += 1
        const delayMs =
          STREAM_RETRY_DELAYS[retryCount - 1] ||
          STREAM_RETRY_DELAYS[STREAM_RETRY_DELAYS.length - 1]
        onReconnect?.(
          errorMessage,
          retryCount,
          MAX_STREAM_RETRIES,
          delayMs,
          errorCode
        )
        clearRetryTimer()
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null
          startStream()
        }, delayMs)
      }

      const startStream = () => {
        if (stoppedRef.current || isStreamCompleteRef.current) return

        const source = new SSE(API_ENDPOINTS.CHAT_COMPLETIONS, {
          headers: getCommonHeaders(),
          method: 'POST',
          payload: JSON.stringify(payload),
        })

        sseSourceRef.current = source

        source.addEventListener('message', (e: MessageEvent) => {
          if (stoppedRef.current) return
          if (e.data === '[DONE]') {
            isStreamCompleteRef.current = true
            setIsStreaming(false)
            closeSource()
            clearRetryTimer()
            onComplete()
            return
          }

          try {
            const chunk: ChatCompletionChunk = JSON.parse(e.data)
            const delta = chunk.choices?.[0]?.delta

            if (delta) {
              if (delta.reasoning_content) {
                onUpdate('reasoning', delta.reasoning_content)
              }
              if (delta.content) {
                onUpdate('content', delta.content)
              }
            }
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to parse SSE message:', error)
            handleError(ERROR_MESSAGES.PARSE_ERROR)
          }
        })

        source.addEventListener('error', (e: Event & { data?: string }) => {
          if (stoppedRef.current) return
          // Only handle errors if stream didn't complete normally
          if (source.readyState !== 2) {
            // eslint-disable-next-line no-console
            console.error('SSE Error:', e)
            let errorMessage = e.data || ERROR_MESSAGES.API_REQUEST_ERROR
            let errorCode: string | undefined
            if (e.data) {
              try {
                const parsed = JSON.parse(e.data) as {
                  error?: { message?: string; code?: string }
                }
                if (parsed?.error) {
                  errorMessage = parsed.error.message || errorMessage
                  errorCode = parsed.error.code || undefined
                }
              } catch {
                // not JSON, use raw string
              }
            }
            handleError(errorMessage, errorCode)
          }
        })

        source.addEventListener(
          'readystatechange',
          (e: Event & { readyState?: number }) => {
            if (stoppedRef.current) return
            const status = (source as unknown as { status?: number }).status
            if (
              e.readyState !== undefined &&
              e.readyState >= 2 &&
              status !== undefined &&
              status !== 200
            ) {
              handleError(`HTTP ${status}: ${ERROR_MESSAGES.CONNECTION_CLOSED}`)
            }
          }
        )

        try {
          source.stream()
        } catch (error: unknown) {
          // eslint-disable-next-line no-console
          console.error('Failed to start SSE stream:', error)
          handleError(ERROR_MESSAGES.STREAM_START_ERROR)
        }
      }

      startStream()
    },
    []
  )

  const stopStream = useCallback(() => {
    stoppedRef.current = true
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
    if (sseSourceRef.current) sseSourceRef.current.close()
    sseSourceRef.current = null
    setIsStreaming(false)
  }, [])

  return {
    sendStreamRequest,
    stopStream,
    isStreaming,
  }
}
