import { API_ENDPOINTS } from '../constants'
import type {
  ContentPart,
  Message,
  ParameterEnabled,
  PlaygroundConfig,
  ResponsesFunctionCallItem,
  ResponsesFunctionCallOutput,
  ResponsesFunctionTool,
  ResponsesInputContentPart,
  ResponsesInputItem,
  ResponsesInputMessage,
  ResponsesOutputHistoryItem,
  ResponsesReasoningOutputItem,
  ResponsesRequest,
  ResponsesStreamEvent,
} from '../types'
import { getCommonHeaders } from '@/lib/api'
import type { AgentHelperStatus } from './agent-helper'
import type { AgentToolCall, AgentToolName } from './agent-tools'
import { getVisibleAgentContent } from './agent-tools'
import {
  buildAgentInstructions,
  buildAgentPromptCacheKey,
} from './agent-instructions'
import { formatMessageForAPI, isValidMessage } from './message-utils'
import { isOpenAIFastMode } from './payload-builder'

const MAX_STREAM_RETRIES = 5
const STREAM_RETRY_DELAYS = [5000, 20000, 45000, 90000, 120000]

const AGENT_TOOL_NAMES = new Set<AgentToolName>([
  'list_dir',
  'read_file',
  'search_files',
  'grep',
  'write_file',
  'append_file',
  'batch_edit',
  'create_dir',
  'run_command',
])

export interface AgentStreamControl {
  source: { close: () => void } | null
  retryTimer: ReturnType<typeof setTimeout> | null
  stopped: boolean
}

interface ResponsesFunctionCallAccumulator {
  id?: string
  callId?: string
  name?: string
  arguments: string
  done: boolean
}

function toResponsesInputContent(
  role: 'user' | 'assistant',
  content: string | ContentPart[]
): ResponsesInputContentPart[] {
  const textType = role === 'assistant' ? 'output_text' : 'input_text'

  if (typeof content === 'string') {
    return content.trim()
      ? [{ type: textType, text: content }]
      : []
  }

  return content.flatMap((part) => {
    if (part.type === 'text') {
      return part.text?.trim()
        ? [{ type: textType, text: part.text } satisfies ResponsesInputContentPart]
        : []
    }
    if (part.type === 'image_url' && role === 'user' && part.image_url?.url) {
      return [
        {
          type: 'input_image',
          image_url: part.image_url.url,
        } satisfies ResponsesInputContentPart,
      ]
    }
    return []
  })
}

function messagesToResponsesInput(messages: Message[]): ResponsesInputItem[] {
  return messages.flatMap((message) => {
    if (message.isAgentToolResult) {
      return (message.agentToolResults || [])
        .filter((result) => result.id)
        .map(
          (result) =>
            ({
              type: 'function_call_output',
              call_id: result.id!,
              output: JSON.stringify({
                ok: result.ok,
                tool: result.tool,
                path: result.path,
                summary: result.summary,
                output: result.output,
                error: result.error,
              }),
            }) satisfies ResponsesFunctionCallOutput
        )
    }
    if (message.from !== 'user' && message.from !== 'assistant') return []

    const outputItems =
      message.from === 'assistant' ? message.agentResponsesOutputItems || [] : []
    if (!isValidMessage(message)) {
      return outputItems
    }

    const formatted = formatMessageForAPI(message)
    const content = toResponsesInputContent(message.from, formatted.content)
    if (content.length === 0) return outputItems
    return [
      {
        type: 'message',
        role: message.from,
        content,
      } satisfies ResponsesInputMessage,
      ...outputItems,
    ]
  })
}

function sanitizeResponsesInputItems(input: ResponsesInputItem[]): ResponsesInputItem[] {
  const kept: ResponsesInputItem[] = []
  const pendingCallPositions = new Map<string, number>()
  const seenCalls = new Set<string>()

  for (const item of input) {
    if (item.type === 'function_call') {
      seenCalls.add(item.call_id)
      pendingCallPositions.set(item.call_id, kept.length)
      kept.push(item)
      continue
    }

    if (item.type === 'function_call_output') {
      if (pendingCallPositions.has(item.call_id)) {
        pendingCallPositions.delete(item.call_id)
        kept.push(item)
      } else if (!seenCalls.has(item.call_id)) {
        // Drop orphan outputs from old browser sessions that did not persist
        // the assistant function_call item. OpenAI rejects these with
        // "No tool call found for function call output".
      }
      continue
    }

    kept.push(item)
  }

  if (pendingCallPositions.size === 0) return kept

  const unresolvedPositions = new Set(pendingCallPositions.values())
  return kept.filter((_, index) => !unresolvedPositions.has(index))
}

function assertResponsesToolCallPairs(input: ResponsesInputItem[]): void {
  const calls = new Set<string>()
  const outputs = new Set<string>()

  for (const item of input) {
    if (item.type === 'function_call') {
      if (!item.call_id) throw new Error('responses_function_call_missing_call_id')
      calls.add(item.call_id)
    } else if (item.type === 'function_call_output') {
      if (!item.call_id) throw new Error('responses_function_call_output_missing_call_id')
      if (!calls.has(item.call_id)) {
        throw new Error(`responses_orphan_function_call_output:${item.call_id}`)
      }
      outputs.add(item.call_id)
    }
  }

  for (const callId of calls) {
    if (!outputs.has(callId)) {
      throw new Error(`responses_function_call_output_missing:${callId}`)
    }
  }
}

function buildAgentResponsesTools(
  helperStatus: AgentHelperStatus | null
): ResponsesFunctionTool[] {
  const tools: ResponsesFunctionTool[] = [
    {
      type: 'function',
      name: 'list_dir',
      description: '列出工作区内某个相对目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对目录，默认为 .' },
          depth: {
            type: 'integer',
            description:
              '递归层数，默认 1，最大 5。单子项目录会继续展开且不消耗层数。',
          },
        },
      },
    },
    {
      type: 'function',
      name: 'read_file',
      description: '读取工作区内文本文件。默认读取前 100 行。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对文件路径' },
          start: { type: 'integer', description: '可选，1 起始行号' },
          end: { type: 'integer', description: '可选，结束行号' },
          maxBytes: { type: 'integer', description: '可选，最大读取字节数' },
        },
        required: ['path'],
      },
    },
    {
      type: 'function',
      name: 'search_files',
      description: '在工作区目录内搜索文本。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对目录，默认为 .' },
          query: { type: 'string', description: '搜索关键字' },
          maxResults: { type: 'integer', description: '最大结果数' },
        },
        required: ['query'],
      },
    },
    {
      type: 'function',
      name: 'grep',
      description: '在工作区目录内按关键字搜索文本行，等价于 search_files 的快捷工具。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对目录，默认为 .' },
          query: { type: 'string', description: '搜索关键字' },
          maxResults: { type: 'integer', description: '最大结果数' },
        },
        required: ['query'],
      },
    },
    {
      type: 'function',
      name: 'write_file',
      description: '覆盖写入工作区内文本文件，需要用户审批。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对文件路径' },
          content: { type: 'string', description: '完整文件内容' },
        },
        required: ['path', 'content'],
      },
    },
    {
      type: 'function',
      name: 'append_file',
      description: '向工作区内文本文件追加内容，需要用户审批。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对文件路径' },
          content: { type: 'string', description: '追加内容' },
        },
        required: ['path', 'content'],
      },
    },
    {
      type: 'function',
      name: 'batch_edit',
      description: '对同一文件执行多处精确替换，需要用户审批。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对文件路径' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                find: { type: 'string' },
                replace: { type: 'string' },
              },
              required: ['find', 'replace'],
            },
          },
        },
        required: ['path', 'edits'],
      },
    },
    {
      type: 'function',
      name: 'create_dir',
      description: '创建工作区内目录，需要用户审批。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对目录路径' },
        },
        required: ['path'],
      },
    },
  ]

  if (helperStatus) {
    tools.push({
      type: 'function',
      name: 'run_command',
      description:
        '通过用户本机的 Xingkong Agent Helper 执行终端命令。需要用户审批。只能在 helper 工作目录内运行。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            minLength: 1,
            description: '要执行的命令，例如 dir、ls -la、npm test。不能为空。',
          },
          cwd: { type: 'string', description: '相对 helper 工作目录的路径，默认为 .' },
          timeoutMs: {
            type: 'integer',
            description: '超时时间，毫秒。默认 120000，最大 300000。',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    })
  }

  return tools
}

export function buildAgentResponsesPayload(
  messages: Message[],
  config: PlaygroundConfig,
  parameterEnabled: ParameterEnabled,
  workspaceName: string,
  conversationId: string | null,
  helperStatus: AgentHelperStatus | null,
  extraSystemPrompt = ''
): ResponsesRequest {
  const input = sanitizeResponsesInputItems(messagesToResponsesInput(messages))
  assertResponsesToolCallPairs(input)

  const payload: ResponsesRequest = {
    model: config.model,
    group: config.group,
    input,
    instructions: buildAgentInstructions(
      workspaceName,
      true,
      helperStatus,
      extraSystemPrompt
    ),
    stream: true,
    store: false,
    prompt_cache_key: buildAgentPromptCacheKey(conversationId),
    tools: buildAgentResponsesTools(helperStatus),
    tool_choice: 'auto',
    parallel_tool_calls: true,
  }

  if (config.openaiReasoningEffort !== 'none') {
    payload.reasoning = {
      effort: config.openaiReasoningEffort,
      summary: 'detailed',
    }
    payload.include = ['reasoning.encrypted_content']
  }
  if (isOpenAIFastMode(config)) {
    payload.service_tier = 'priority'
  }

  if (parameterEnabled.temperature) payload.temperature = config.temperature
  if (parameterEnabled.top_p) payload.top_p = config.top_p
  if (parameterEnabled.max_tokens) payload.max_output_tokens = config.max_tokens
  if (parameterEnabled.frequency_penalty) {
    payload.frequency_penalty = config.frequency_penalty
  }
  if (parameterEnabled.presence_penalty) {
    payload.presence_penalty = config.presence_penalty
  }
  if (parameterEnabled.seed && config.seed !== null) payload.seed = config.seed

  return payload
}

function extractResponsesOutputText(event: ResponsesStreamEvent): string {
  const output = event.response?.output || []
  return output
    .flatMap((item) => item.content || [])
    .map((part) => part.text || '')
    .join('')
}

function extractResponsesItemText(event: ResponsesStreamEvent): string {
  return [
    ...(event.item?.content || []).map((part) => part.text || ''),
    event.part?.text || '',
  ].join('')
}

function parseResponsesToolArguments(
  value: string | Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!value) return {}
  if (typeof value !== 'string') return value
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function numberArg(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseResponsesToolCallItem(
  item?: ResponsesStreamEvent['item']
): AgentToolCall | null {
  if (!item || item.type !== 'function_call') return null
  const tool = item.name as AgentToolName
  if (!AGENT_TOOL_NAMES.has(tool)) return null
  const args = parseResponsesToolArguments(item.arguments)
  const edits = Array.isArray(args.edits)
    ? args.edits
        .filter((edit): edit is Record<string, unknown> => !!edit && typeof edit === 'object')
        .map((edit) => ({
          find: stringArg(edit.find) || '',
          replace: stringArg(edit.replace) || '',
        }))
        .filter((edit) => edit.find)
    : undefined

  return {
    id: item.call_id || item.id,
    tool,
    path: stringArg(args.path) || '.',
    cwd: stringArg(args.cwd),
    command: stringArg(args.command),
    content: stringArg(args.content),
    query: stringArg(args.query),
    start: numberArg(args.start),
    end: numberArg(args.end),
    maxBytes: numberArg(args.maxBytes),
    maxResults: numberArg(args.maxResults),
    depth: numberArg(args.depth),
    timeoutMs: numberArg(args.timeoutMs) || numberArg(args.timeout_ms),
    edits,
  }
}

function mergeResponsesFunctionCallItem(
  callsByItemId: Map<string, ResponsesFunctionCallAccumulator>,
  callsByCallId: Map<string, ResponsesFunctionCallAccumulator>,
  item?: ResponsesStreamEvent['item'],
  done = false
): void {
  if (!item || item.type !== 'function_call') return

  const itemId = item.id || undefined
  const callId = item.call_id || undefined
  const key = callId || itemId
  if (!key) return

  const existing =
    (itemId && callsByItemId.get(itemId)) ||
    (callId && callsByCallId.get(callId)) ||
    {
      arguments: '',
      done: false,
    }

  existing.id = itemId || existing.id
  existing.callId = callId || existing.callId
  existing.name = item.name || existing.name
  const args =
    typeof item.arguments === 'string'
      ? item.arguments
      : item.arguments
        ? JSON.stringify(item.arguments)
        : ''
  if (args) existing.arguments = args
  existing.done = existing.done || done

  if (existing.id) callsByItemId.set(existing.id, existing)
  if (existing.callId) callsByCallId.set(existing.callId, existing)
}

function appendResponsesFunctionCallArgumentsDelta(
  callsByItemId: Map<string, ResponsesFunctionCallAccumulator>,
  callsByCallId: Map<string, ResponsesFunctionCallAccumulator>,
  event: ResponsesStreamEvent
): void {
  const itemId = event.item_id || undefined
  const callId = event.call_id || undefined
  const key = itemId || callId
  if (!key) return

  const existing =
    (itemId && callsByItemId.get(itemId)) ||
    (callId && callsByCallId.get(callId)) ||
    {
      id: itemId,
      callId,
      arguments: '',
      done: false,
    }

  existing.id = itemId || existing.id
  existing.callId = callId || existing.callId
  if (typeof event.delta === 'string') {
    existing.arguments += event.delta
  }
  const args =
    typeof event.arguments === 'string'
      ? event.arguments
      : event.arguments
        ? JSON.stringify(event.arguments)
        : ''
  if (args) existing.arguments = args

  if (existing.id) callsByItemId.set(existing.id, existing)
  if (existing.callId) callsByCallId.set(existing.callId, existing)
}

function markResponsesFunctionCallArgumentsDone(
  callsByItemId: Map<string, ResponsesFunctionCallAccumulator>,
  callsByCallId: Map<string, ResponsesFunctionCallAccumulator>,
  event: ResponsesStreamEvent
): void {
  appendResponsesFunctionCallArgumentsDelta(callsByItemId, callsByCallId, event)
  const itemId = event.item_id || undefined
  const callId = event.call_id || undefined
  const existing =
    (itemId && callsByItemId.get(itemId)) ||
    (callId && callsByCallId.get(callId))
  if (existing) existing.done = true
}

function getCompletedResponsesFunctionCallItems(
  callsByCallId: Map<string, ResponsesFunctionCallAccumulator>
): ResponsesFunctionCallItem[] {
  return [...callsByCallId.values()]
    .filter((item) => item.done && item.callId && item.name)
    .map((item) => ({
      type: 'function_call' as const,
      id: item.id,
      call_id: item.callId!,
      name: item.name!,
      arguments: item.arguments || '{}',
      status: 'completed',
    }))
}

function getCompletedResponsesToolCalls(
  callsByCallId: Map<string, ResponsesFunctionCallAccumulator>
): AgentToolCall[] {
  return getCompletedResponsesFunctionCallItems(callsByCallId)
    .map((item) =>
      parseResponsesToolCallItem({
        type: 'function_call',
        id: item.id,
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      })
    )
    .filter((call): call is AgentToolCall => !!call)
}

function parseResponsesReasoningItem(
  item?: ResponsesStreamEvent['item']
): ResponsesReasoningOutputItem | null {
  if (!item || item.type !== 'reasoning' || !item.encrypted_content) return null
  return {
    type: 'reasoning',
    summary: Array.isArray(item.summary) ? item.summary : [],
    encrypted_content: item.encrypted_content,
  }
}

function appendUniqueReasoningItem(
  items: ResponsesReasoningOutputItem[],
  item: ResponsesReasoningOutputItem | null
): void {
  if (!item?.encrypted_content) return
  if (
    items.some(
      (existing) => existing.encrypted_content === item.encrypted_content
    )
  ) {
    return
  }
  items.push(item)
}

function getResponsesErrorMessage(event: ResponsesStreamEvent): string {
  return (
    event.error?.message ||
    event.response?.error?.message ||
    event.type ||
    'responses_stream_error'
  )
}

function getAgentStreamDisplayContent(content: string): string {
  const visible = getVisibleAgentContent(content)
  if (visible) return visible
  return ''
}

function summarizeResponsesStreamEvent(
  type: string,
  data: string,
  event?: ResponsesStreamEvent
): string {
  const message = event ? getResponsesErrorMessage(event) : ''
  const raw = data.length > 600 ? `${data.slice(0, 600)}...` : data
  return [message, `event=${type}`, raw].filter(Boolean).join(' | ')
}

function isNonRetryableAgentStreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('HTTP 400') ||
    message.includes('invalid_request') ||
    message.includes('responses_orphan_function_call_output') ||
    message.includes('responses_function_call_output_missing')
  )
}

export function streamAgentResponsesCompletion(
  payload: ResponsesRequest,
  onVisibleContent: (content: string) => void,
  onReconnect: (error: string, attempt: number, maxAttempts: number) => void,
  control: AgentStreamControl,
  options: {
    endpoint?: string
    headers?: Record<string, string>
    chargeBeforeRequest?: () => Promise<void>
  } = {}
): Promise<{
  rawContent: string
  nativeToolCalls: AgentToolCall[]
  nativeOutputItems: ResponsesOutputHistoryItem[]
}> {
  let retryCount = 0

  const run = async (): Promise<{
    rawContent: string
    nativeToolCalls: AgentToolCall[]
    nativeOutputItems: ResponsesOutputHistoryItem[]
  }> => {
    try {
      if (options.chargeBeforeRequest) {
        await options.chargeBeforeRequest()
      }
      return await streamAgentResponsesCompletionOnce(
        payload,
        onVisibleContent,
        control,
        options
      )
    } catch (error) {
      if (control.stopped) throw error
      if (isNonRetryableAgentStreamError(error)) throw error
      if (retryCount >= MAX_STREAM_RETRIES) throw error

      retryCount += 1
      const delayMs =
        STREAM_RETRY_DELAYS[retryCount - 1] ||
        STREAM_RETRY_DELAYS[STREAM_RETRY_DELAYS.length - 1]
      onReconnect(
        error instanceof Error ? error.message : 'responses_stream_error',
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

function streamAgentResponsesCompletionOnce(
  payload: ResponsesRequest,
  onVisibleContent: (content: string) => void,
  control: AgentStreamControl,
  options: {
    endpoint?: string
    headers?: Record<string, string>
  } = {}
): Promise<{
  rawContent: string
  nativeToolCalls: AgentToolCall[]
  nativeOutputItems: ResponsesOutputHistoryItem[]
}> {
  return new Promise((resolve, reject) => {
    let rawContent = ''
    let responseCompleted = false
    const callsByItemId = new Map<string, ResponsesFunctionCallAccumulator>()
    const callsByCallId = new Map<string, ResponsesFunctionCallAccumulator>()
    const reasoningItems: ResponsesReasoningOutputItem[] = []
    let settled = false
    const abortController = new AbortController()
    const source = {
      close: () => abortController.abort(),
    }
    control.source = source

    const close = () => {
      source.close()
      if (control.source === source) control.source = null
    }
    const finish = (completed = false) => {
      if (settled) return
      settled = true
      responseCompleted = completed
      close()
      resolve({
        rawContent,
        nativeToolCalls: getCompletedResponsesToolCalls(callsByCallId),
        nativeOutputItems: [
          ...reasoningItems,
          ...getCompletedResponsesFunctionCallItems(callsByCallId),
        ],
      })
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      close()
      reject(error)
    }

    const updateVisibleContent = () => {
      onVisibleContent(getAgentStreamDisplayContent(rawContent))
    }

    const handleResponseEvent = (type: string, data: string) => {
      if (settled || control.stopped) return
      if (data === '[DONE]') {
        if (responseCompleted) {
          finish(true)
        } else {
          fail(new Error('responses_stream_closed_before_completed'))
        }
        return
      }

      try {
        const parsed = JSON.parse(data) as ResponsesStreamEvent
        const eventType = parsed.type || type
        if (eventType === 'response.output_item.added') {
          mergeResponsesFunctionCallItem(
            callsByItemId,
            callsByCallId,
            parsed.item,
            false
          )
        } else if (eventType === 'response.output_item.done') {
          mergeResponsesFunctionCallItem(
            callsByItemId,
            callsByCallId,
            parsed.item,
            true
          )
        } else if (eventType === 'response.function_call_arguments.delta') {
          appendResponsesFunctionCallArgumentsDelta(
            callsByItemId,
            callsByCallId,
            parsed
          )
        } else if (eventType === 'response.function_call_arguments.done') {
          markResponsesFunctionCallArgumentsDone(
            callsByItemId,
            callsByCallId,
            parsed
          )
        }
        if (eventType === 'response.output_item.done') {
          appendUniqueReasoningItem(
            reasoningItems,
            parseResponsesReasoningItem(parsed.item)
          )
        }
        ;(parsed.response?.output || []).forEach((item) =>
          mergeResponsesFunctionCallItem(
            callsByItemId,
            callsByCallId,
            item,
            true
          )
        )
        ;(parsed.response?.output || []).forEach((item) =>
          appendUniqueReasoningItem(reasoningItems, parseResponsesReasoningItem(item))
        )
        if (parsed.error || parsed.response?.error) {
          fail(new Error(summarizeResponsesStreamEvent(eventType, data, parsed)))
          return
        }

        switch (eventType) {
          case 'response.output_text.delta':
            if (parsed.delta) {
              rawContent += parsed.delta
              updateVisibleContent()
            }
            break
          case 'response.output_item.done':
          case 'response.content_part.done': {
            const itemText = extractResponsesItemText(parsed)
            if (itemText && itemText !== rawContent) {
              rawContent = itemText.includes(rawContent)
                ? itemText
                : rawContent.includes(itemText)
                  ? rawContent
                  : rawContent + itemText
              updateVisibleContent()
            }
            break
          }
          case 'response.completed': {
            const outputText = extractResponsesOutputText(parsed)
            if (outputText && outputText.length >= rawContent.length) {
              rawContent = outputText
              updateVisibleContent()
            }
            finish(true)
            break
          }
          case 'response.failed':
          case 'response.incomplete':
          case 'response.error':
            fail(new Error(summarizeResponsesStreamEvent(eventType, data, parsed)))
            break
          default:
            break
        }
      } catch (error) {
        fail(
          new Error(
            `responses_stream_parse_error: ${
              error instanceof Error ? error.message : String(error)
            } | event=${type} | data=${data.slice(0, 600)}`
          )
        )
      }
    }

    const run = async () => {
      if (control.stopped) {
        fail(new Error('agent_stopped'))
        return
      }

      try {
        const response = await fetch(options.endpoint || API_ENDPOINTS.RESPONSES, {
          method: 'POST',
          headers: options.headers || getCommonHeaders(),
          body: JSON.stringify(payload),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          fail(
            new Error(
              `HTTP ${response.status}: ${body.slice(0, 1000) || response.statusText}`
            )
          )
          return
        }
        if (!response.body) {
          fail(new Error('responses_stream_body_empty'))
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        const dispatchBlock = (block: string) => {
          const lines = block.split('\n')
          let eventType = 'message'
          const dataLines: string[] = []

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice('event:'.length).trim() || eventType
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice('data:'.length).trimStart())
            }
          }

          if (dataLines.length > 0) {
            handleResponseEvent(eventType, dataLines.join('\n').trim())
          }
        }

        while (!settled && !control.stopped) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
          let separatorIndex = buffer.indexOf('\n\n')

          while (separatorIndex >= 0) {
            const block = buffer.slice(0, separatorIndex).trim()
            buffer = buffer.slice(separatorIndex + 2)
            if (block) dispatchBlock(block)
            if (settled || control.stopped) break
            separatorIndex = buffer.indexOf('\n\n')
          }
        }

        if (!settled && !control.stopped) {
          const trailing = buffer.trim()
          if (trailing) dispatchBlock(trailing)
          if (!settled) fail(new Error('responses_stream_closed_before_completed'))
        }
      } catch (error) {
        if (control.stopped || abortController.signal.aborted) return
        fail(error)
      }
    }

    void run()
  })
}
