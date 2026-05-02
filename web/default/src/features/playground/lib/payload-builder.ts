import type {
  ChatCompletionRequest,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
} from '../types'
import { formatMessageForAPI, isValidMessage } from './message-utils'

export function isOpenAIReasoningModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return false

  return (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4') ||
    normalized.startsWith('codex') ||
    normalized.includes('-codex') ||
    normalized.startsWith('chatgpt')
  )
}

export function shouldUseOpenAICompatibleMode(
  config: PlaygroundConfig
): boolean {
  return config.openaiRequestMode === 'compatible'
}

export function isOpenAIFastMode(config: PlaygroundConfig): boolean {
  return config.openaiRequestMode
    ? config.openaiRequestMode === 'fast'
    : config.openaiFastMode
}

/**
 * Build API request payload from messages and config
 */
export function buildChatCompletionPayload(
  messages: Message[],
  config: PlaygroundConfig,
  parameterEnabled: ParameterEnabled,
  options: { promptCacheKey?: string } = {}
): ChatCompletionRequest {
  // Filter and format valid messages
  const processedMessages = messages
    .filter(isValidMessage)
    .map(formatMessageForAPI)

  const payload: ChatCompletionRequest = {
    model: config.model,
    group: config.group,
    messages: processedMessages,
    stream: config.stream,
  }

  if (
    isOpenAIReasoningModel(config.model) &&
    !shouldUseOpenAICompatibleMode(config)
  ) {
    if (options.promptCacheKey) {
      payload.prompt_cache_key = options.promptCacheKey
    }
    if (config.openaiReasoningEffort !== 'none') {
      payload.reasoning_effort = config.openaiReasoningEffort
    }
    if (isOpenAIFastMode(config)) {
      payload.service_tier = 'fast'
    }
  }

  // Add enabled parameters
  const parameterKeys: Array<keyof ParameterEnabled> = [
    'temperature',
    'top_p',
    'max_tokens',
    'frequency_penalty',
    'presence_penalty',
    'seed',
  ]

  parameterKeys.forEach((key) => {
    if (parameterEnabled[key]) {
      const value = config[key as keyof PlaygroundConfig]
      if (value !== undefined && value !== null) {
        ;(payload as unknown as Record<string, unknown>)[key] = value
      }
    }
  })

  return payload
}
