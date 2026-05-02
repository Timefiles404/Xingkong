import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BotIcon,
  DownloadIcon,
  FolderOpenIcon,
  MessageCircleIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SSE } from 'sse.js'
import { Button } from '@/components/ui/button'
import { getCommonHeaders } from '@/lib/api'
import { cn } from '@/lib/utils'
import { getUserModels, getUserGroups } from './api'
import { PlaygroundHistorySidebar } from './components/playground-history-sidebar'
import { PlaygroundFileSidebar } from './components/playground-file-sidebar'
import { PlaygroundChat } from './components/playground-chat'
import { PlaygroundInput } from './components/playground-input'
import { API_ENDPOINTS, DEFAULT_GROUP } from './constants'
import { usePlaygroundState, useChatHandler } from './hooks'
import {
  AGENT_SYSTEM_PROMPT,
  buildAgentToolReviewResults,
  buildChatCompletionPayload,
  checkAgentHelperStatus,
  createMessageVersion,
  createUserMessage,
  createLoadingAssistantMessage,
  downloadAgentHelperToWorkspace,
  executeAgentToolCalls,
  finalizeMessage,
  formatMessageForAPI,
  formatAgentToolResults,
  getCompleteAgentToolBlockEnd,
  getAgentHelperDownloadTarget,
  getVisibleAgentContent,
  isOpenAIReasoningModel,
  isValidMessage,
  isFileSystemAccessSupported,
  launchAgentHelperProtocol,
  parseAgentToolCalls,
  requestWorkspaceDirectory,
  requiresAgentToolApproval,
  stripAgentToolBlocks,
} from './lib'
import type {
  AgentHelperStatus,
  AgentToolCall,
  AgentToolName,
  AgentToolResult,
} from './lib'
import type {
  Message as MessageType,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ContentPart,
  ParameterEnabled,
  PlaygroundAttachment,
  PlaygroundConfig,
  PlaygroundMode,
  ResponsesFunctionTool,
  ResponsesFunctionCallItem,
  ResponsesFunctionCallOutput,
  ResponsesInputContentPart,
  ResponsesInputItem,
  ResponsesInputMessage,
  ResponsesOutputHistoryItem,
  ResponsesReasoningOutputItem,
  ResponsesRequest,
  ResponsesStreamEvent,
} from './types'

const MAX_AGENT_STEPS = 30
const MAX_STREAM_RETRIES = 5
const STREAM_RETRY_DELAYS = [5000, 20000, 45000, 90000, 120000]

interface AgentStreamControl {
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

const AGENT_TOOL_NAMES = new Set<AgentToolName>([
  'list_dir',
  'read_file',
  'search_files',
  'write_file',
  'append_file',
  'batch_edit',
  'create_dir',
  'run_command',
])

function createAgentSystemMessage(
  workspaceName: string,
  helperStatus: AgentHelperStatus | null
): MessageType {
  return {
    key: 'agent-system',
    from: 'system',
    versions: [
      createMessageVersion(
        buildAgentInstructions(workspaceName, false, helperStatus)
      ),
    ],
  }
}

function buildAgentInstructions(
  workspaceName: string,
  useNativeResponsesTools: boolean,
  helperStatus: AgentHelperStatus | null
): string {
  const workspaceLine = `当前工作目录: ${workspaceName || '未选择'}`
  const helperLine = helperStatus
    ? `本地 helper: 已连接，命令工作目录 ${helperStatus.workspace}，Shell ${helperStatus.shell}`
    : '本地 helper: 未连接；不要尝试运行终端命令。'
  if (!useNativeResponsesTools) {
    return `${AGENT_SYSTEM_PROMPT}\n\n${workspaceLine}\n${helperLine}`
  }

  return `你是运行在浏览器网页端的 Agent。你不能访问服务器文件系统；你只能通过用户已授权的本地工作目录使用文件工具。若本地 helper 已连接，你还可以在用户审批后调用本地命令行工具。

回答风格:
- 直接、务实、像资深工程师一样给结论和关键依据。
- 默认用短段落或简短列表，避免寒暄、套话和自我说明。
- 非必要不要频繁分段；不要连续输出多个空行。
- 简单结果用 1-2 段说明即可；复杂结果最多使用少量扁平项目符号。
- 当你提到工作区内文件时，优先使用 Markdown 文件引用: [文件名](file://相对路径)，不要使用绝对路径。

工具规则:
- 当前运行环境支持 OpenAI Responses 原生 function tools。
- 需要使用工具时，必须调用已提供的 function tool。
- 不要输出 <agent_tools> XML 或 agent_tools 代码块。
- 工具返回后继续分析；任务完成时直接给用户自然语言答复。
- ${helperStatus ? '本地 helper 已连接，可以按需调用 run_command。' : '本地 helper 未连接，不要调用 run_command。'}
- 调用 run_command 时必须填写非空 command；cwd 只表示相对工作目录，不是命令。列目录优先用 list_dir；若用户明确要求命令行列目录，Windows 用 dir，macOS/Linux 用 ls -la。

${workspaceLine}
${helperLine}`
}

function buildAgentPromptCacheKey(
  conversationId?: string | null
): string | undefined {
  if (!conversationId) return undefined
  return `xingkong-playground-agent:${conversationId}`
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

function messagesToResponsesInput(
  messages: MessageType[]
): ResponsesInputItem[] {
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

function buildAgentResponsesPayload(
  messages: MessageType[],
  config: PlaygroundConfig,
  parameterEnabled: ParameterEnabled,
  workspaceName: string,
  conversationId: string | null,
  helperStatus: AgentHelperStatus | null
): ResponsesRequest {
  const input = sanitizeResponsesInputItems(messagesToResponsesInput(messages))
  assertResponsesToolCallPairs(input)

  const payload: ResponsesRequest = {
    model: config.model,
    group: config.group,
    input,
    instructions: buildAgentInstructions(workspaceName, true, helperStatus),
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
  if (config.openaiFastMode) {
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

function streamAgentCompletion(
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
    content: stringArg(args.content),
    query: stringArg(args.query),
    start: numberArg(args.start),
    end: numberArg(args.end),
    maxBytes: numberArg(args.maxBytes),
    maxResults: numberArg(args.maxResults),
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

function hasAgentToolSyntax(content: string): boolean {
  return /<agent_tools\b/i.test(content) || /```agent_tools/i.test(content)
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

function streamAgentResponsesCompletion(
  payload: ResponsesRequest,
  onVisibleContent: (content: string) => void,
  onReconnect: (error: string, attempt: number, maxAttempts: number) => void,
  control: AgentStreamControl
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
      return await streamAgentResponsesCompletionOnce(
        payload,
        onVisibleContent,
        control
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
  control: AgentStreamControl
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
        const response = await fetch(API_ENDPOINTS.RESPONSES, {
          method: 'POST',
          headers: getCommonHeaders(),
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

export function Playground() {
  const { t } = useTranslation()
  const {
    config,
    parameterEnabled,
    messages,
    mode,
    workspaceName,
    models,
    groups,
    conversations,
    activeConversationId,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    createNewConversation,
    switchConversation,
    switchMode,
    deleteConversation,
    updateActiveConversationMeta,
  } = usePlaygroundState()
  const [workspaceHandles, setWorkspaceHandles] = useState<
    Record<string, FileSystemDirectoryHandle>
  >({})
  const [agentHelperStatus, setAgentHelperStatus] =
    useState<AgentHelperStatus | null>(null)
  const [isHelperDownloading, setIsHelperDownloading] = useState(false)
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const pendingAgentApprovalsRef = useRef<
    Map<string, (approved: boolean) => void>
  >(new Map())
  const agentStreamControlRef = useRef<AgentStreamControl>({
    source: null,
    retryTimer: null,
    stopped: false,
  })

  const activeWorkspaceHandle = activeConversationId
    ? workspaceHandles[activeConversationId]
    : undefined
  const isAgentMode = mode === 'agent'
  const visibleConversations = conversations.filter(
    (conversation) => (conversation.mode || 'chat') === mode
  )

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
  })
  const isBusy = isGenerating || isAgentRunning

  useEffect(() => {
    if (!isAgentMode) return

    let cancelled = false
    const refresh = async () => {
      const status = await checkAgentHelperStatus()
      if (!cancelled) setAgentHelperStatus(status)
    }

    void refresh()
    const timer = window.setInterval(refresh, 10000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isAgentMode])

  // Edit dialog state
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  useEffect(() => {
    setEditingMessageKey(null)
  }, [activeConversationId])

  // Load models
  const { data: modelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['playground-models'],
    queryFn: getUserModels,
  })

  // Load groups
  const { data: groupsData } = useQuery({
    queryKey: ['playground-groups'],
    queryFn: getUserGroups,
  })

  // Update models when data changes
  useEffect(() => {
    if (!modelsData) return

    setModels(modelsData)

    // Set default model if current model is not available
    const isCurrentModelValid = modelsData.some((m) => m.value === config.model)
    if (modelsData.length > 0 && !isCurrentModelValid) {
      updateConfig('model', modelsData[0].value)
    }
  }, [modelsData, config.model, setModels, updateConfig])

  // Update groups when data changes
  useEffect(() => {
    if (!groupsData) return

    const processedGroups = groupsData.filter((group) => group.value !== 'auto')

    setGroups(processedGroups)

    const isCurrentGroupValid = processedGroups.some(
      (group) => group.value === config.group
    )
    if (!isCurrentGroupValid) {
      updateConfig('group', processedGroups[0]?.value || DEFAULT_GROUP)
    }
  }, [groupsData, config.group, setGroups, updateConfig])

  const pickWorkspace = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      toast.error(t('This browser does not support local folder access'))
      return null
    }

    if (!activeConversationId) return null

    try {
      const handle = await requestWorkspaceDirectory()
      setWorkspaceHandles((prev) => ({
        ...prev,
        [activeConversationId]: handle,
      }))
      updateActiveConversationMeta({ workspaceName: handle.name })
      toast.success(t('Workspace selected'))
      return handle
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null
      }
      toast.error(t('Failed to select workspace'))
      return null
    }
  }, [activeConversationId, t, updateActiveConversationMeta])

  const handleInstallOrLaunchHelper = useCallback(async () => {
    let workspace = activeWorkspaceHandle
    if (!workspace) {
      workspace = await pickWorkspace()
    }
    if (!workspace) return

    const target = getAgentHelperDownloadTarget()
    setIsHelperDownloading(true)
    try {
      const fileName = await downloadAgentHelperToWorkspace(
        workspace,
        target,
        getCommonHeaders()
      )
      toast.success(
        t('Helper downloaded to workspace: {{fileName}}', { fileName })
      )
      launchAgentHelperProtocol()
      window.setTimeout(async () => {
        const status = await checkAgentHelperStatus(2500)
        setAgentHelperStatus(status)
        if (!status) {
          toast.info(
            t(
              'If helper is not started, run it from the selected folder. Protocol launch requires --install-protocol.'
            )
          )
        }
      }, 2000)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to download helper')
      )
    } finally {
      setIsHelperDownloading(false)
    }
  }, [activeWorkspaceHandle, pickWorkspace, t])

  const handleModeChange = useCallback(
    (nextMode: PlaygroundMode) => {
      if (isBusy || mode === nextMode) return
      switchMode(nextMode)
    },
    [isBusy, mode, switchMode]
  )

  const handleApproveAgentToolCalls = useCallback(
    (approvalId: string, approved: boolean) => {
      const resolver = pendingAgentApprovalsRef.current.get(approvalId)
      if (!resolver) return
      pendingAgentApprovalsRef.current.delete(approvalId)
      resolver(approved)

      updateMessages((prev) =>
        prev.map((message) =>
          message.agentToolApprovalId === approvalId
            ? {
                ...message,
                agentToolApprovalId: undefined,
                agentToolResults: (message.agentToolResults || []).map(
                  (result) => ({
                    ...result,
                    status: approved
                      ? 'running'
                      : result.requiresApproval
                        ? 'denied'
                        : 'running',
                    ok: approved || !result.requiresApproval,
                    summary: approved || !result.requiresApproval
                      ? t('Running')
                      : t('Permission denied'),
                    error:
                      approved || !result.requiresApproval
                        ? undefined
                        : 'permission_denied',
                  })
                ),
              }
            : message
        )
      )
    },
    [t, updateMessages]
  )

  const stopAgentGeneration = useCallback(() => {
    const control = agentStreamControlRef.current
    control.stopped = true
    if (control.retryTimer) {
      clearTimeout(control.retryTimer)
      control.retryTimer = null
    }
    control.source?.close()
    control.source = null
    pendingAgentApprovalsRef.current.forEach((resolve) => resolve(false))
    pendingAgentApprovalsRef.current.clear()
    setIsAgentRunning(false)

    updateMessages((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      if (last.from !== 'assistant') return prev
      if (last.status !== 'loading' && last.status !== 'streaming') return prev

      const content = last.versions[0]?.content?.trim()
      const next = [...prev]
      next[next.length - 1] = {
        ...finalizeMessage({
          ...last,
          versions: [
            {
              ...last.versions[0],
              content: content || t('Generation was interrupted'),
            },
          ],
        }),
        status: 'complete',
        errorCode: null,
      }
      return next
    })
  }, [t, updateMessages])

  const requestToolApproval = useCallback(
    (
      calls: AgentToolCall[],
      workingMessages: MessageType[],
      reviewResults: AgentToolResult[]
    ): {
      approvalMessage: MessageType
      promise: Promise<boolean>
    } => {
      const approvalId =
        globalThis.crypto?.randomUUID?.() || `tool-approval-${Date.now()}`
      const approvalMessage: MessageType = {
        ...createUserMessage(''),
        isAgentToolResult: true,
        agentToolApprovalId: approvalId,
        agentToolResults: calls.map((call, index) => ({
          ...reviewResults[index],
          id: call.id,
          tool: call.tool,
          path: call.path || '.',
          ok: false,
          status: 'pending',
          requiresApproval: requiresAgentToolApproval(call),
          summary:
            reviewResults[index]?.summary ||
            (requiresAgentToolApproval(call)
              ? t('Waiting for permission')
              : t('Ready to run')),
        })),
      }

      const promise = new Promise<boolean>((resolve) => {
        pendingAgentApprovalsRef.current.set(approvalId, resolve)
      })
      updateMessages([...workingMessages, approvalMessage])
      return { approvalMessage, promise }
    },
    [t, updateMessages]
  )

  const executeToolCallsWithApproval = useCallback(
    async (
      workspace: FileSystemDirectoryHandle,
      calls: AgentToolCall[],
      workingMessages: MessageType[]
    ): Promise<{ results: AgentToolResult[]; messages: MessageType[] }> => {
      const needsApproval = calls.some(requiresAgentToolApproval)
      const createToolMessage = (
        status: 'pending' | 'running' | 'denied' | 'complete',
        results?: AgentToolResult[]
      ): MessageType => {
        const displayResults = results
          ? results.map((result) => ({
              ...result,
              status: 'complete' as const,
            }))
          : calls.map((call) => {
              const requiresApproval = requiresAgentToolApproval(call)
              const denied = status === 'denied' && requiresApproval
              return {
                id: call.id,
                tool: call.tool,
                path: call.path || '.',
                ok: !denied,
                status: denied ? ('denied' as const) : status,
                requiresApproval,
                summary: denied
                  ? t('Permission denied')
                  : status === 'pending'
                    ? requiresApproval
                      ? t('Waiting for permission')
                      : t('Ready to run')
                    : t('Running'),
                error: denied ? 'permission_denied' : undefined,
              }
            })

        return {
          ...createUserMessage(results ? formatAgentToolResults(results) : ''),
          isAgentToolResult: true,
          agentToolResults: displayResults,
        }
      }

      if (!needsApproval) {
        const runningMessage = createToolMessage('running')
        updateMessages([...workingMessages, runningMessage])
        const results = await executeAgentToolCalls(workspace, calls)
        return {
          results,
          messages: [...workingMessages, createToolMessage('complete', results)],
        }
      }

      const reviewResults = await buildAgentToolReviewResults(workspace, calls)
      const { approvalMessage, promise } = requestToolApproval(
        calls,
        workingMessages,
        reviewResults
      )
      const approved = await promise

      if (approved) {
        const runningMessage = {
          ...createToolMessage('running'),
          key: approvalMessage.key,
        }
        updateMessages([...workingMessages, runningMessage])
        const results = await executeAgentToolCalls(workspace, calls)
        const completedMessage = {
          ...createToolMessage('complete', results),
          key: approvalMessage.key,
        }
        return {
          results,
          messages: [...workingMessages, completedMessage],
        }
      }

      const safeCalls = calls.filter((call) => !requiresAgentToolApproval(call))
      const deniedResults: AgentToolResult[] = calls
        .filter(requiresAgentToolApproval)
        .map((call) => ({
          id: call.id,
          tool: call.tool,
          path: call.path || '.',
          ok: false,
          summary: t('Permission denied'),
          error: 'permission_denied',
        }))
      const deniedMessage = {
        ...createToolMessage('denied'),
        key: approvalMessage.key,
      }
      updateMessages([...workingMessages, deniedMessage])
      const results =
        safeCalls.length > 0
          ? [
              ...(await executeAgentToolCalls(workspace, safeCalls)),
              ...deniedResults,
            ]
          : deniedResults
      const completedMessage = {
        ...createToolMessage('complete', results),
        key: approvalMessage.key,
      }

      return {
        results,
        messages: [...workingMessages, completedMessage],
      }
    },
    [requestToolApproval, t, updateMessages]
  )

  const runAgentConversation = useCallback(
    async (
      initialMessages: MessageType[],
      workspace: FileSystemDirectoryHandle,
      conversationId: string | null
    ) => {
      const control = agentStreamControlRef.current
      control.stopped = false
      if (control.retryTimer) {
        clearTimeout(control.retryTimer)
        control.retryTimer = null
      }
      control.source?.close()
      control.source = null
      setIsAgentRunning(true)

      let workingMessages = initialMessages
      const useNativeResponses = isOpenAIReasoningModel(config.model)

      try {
        for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
          const updateLastAssistantContent = (
            content: string,
            status: 'loading' | 'streaming' = 'streaming',
            errorCode: string | null = null
          ) => {
            workingMessages = workingMessages.map((message, index) => {
              if (index !== workingMessages.length - 1) return message
              return {
                ...message,
                versions: [
                  {
                    ...message.versions[0],
                    content,
                  },
                ],
                status,
                errorCode,
              }
            })
            updateMessages(workingMessages)
          }

          let rawContent = ''
          let nativeToolCalls: AgentToolCall[] = []
          let nativeOutputItems: ResponsesOutputHistoryItem[] = []
          const handleReconnect = (
            error: string,
            attempt: number,
            maxAttempts: number
          ) => {
            updateLastAssistantContent(
              t('{{error}}，正在重连（{{attempt}}/{{max}}）...', {
                error,
                attempt,
                max: maxAttempts,
              }),
              'loading',
              'reconnecting'
            )
          }

          if (useNativeResponses) {
            const payload = buildAgentResponsesPayload(
              workingMessages,
              { ...config, stream: true },
              parameterEnabled,
              workspace.name,
              conversationId,
              agentHelperStatus
            )
            if (payload.input.length === 0) {
              throw new Error('responses_input_empty')
            }
            const result = await streamAgentResponsesCompletion(
              payload,
              (content) => updateLastAssistantContent(content, 'streaming', null),
              handleReconnect,
              control
            )
            rawContent = result.rawContent
            nativeToolCalls = result.nativeToolCalls
            nativeOutputItems = result.nativeOutputItems
          } else {
            const payload = buildChatCompletionPayload(
              [
                createAgentSystemMessage(workspace.name, agentHelperStatus),
                ...workingMessages,
              ],
              { ...config, stream: true },
              parameterEnabled,
              {
                promptCacheKey: buildAgentPromptCacheKey(conversationId),
              }
            )
            rawContent = await streamAgentCompletion(
              payload,
              (content) => updateLastAssistantContent(content, 'streaming', null),
              handleReconnect,
              control
            )
          }

          if (control.stopped) return
          const visibleContent = stripAgentToolBlocks(rawContent)
          const toolCalls = useNativeResponses
            ? nativeToolCalls
            : parseAgentToolCalls(rawContent)
          if (hasAgentToolSyntax(rawContent) && toolCalls.length === 0) {
            throw new Error(
              `工具调用格式不完整或无法解析：${rawContent.slice(0, 600)}`
            )
          }

          workingMessages = workingMessages.map((message, index) => {
            if (index !== workingMessages.length - 1) return message
            return {
              ...finalizeMessage({
                ...message,
                apiContent: toolCalls.length > 0 ? rawContent : undefined,
                agentResponsesOutputItems:
                  useNativeResponses && nativeOutputItems.length > 0
                    ? nativeOutputItems
                    : undefined,
                versions: [
                  {
                    ...message.versions[0],
                    content: visibleContent,
                  },
                ],
              }),
              status: 'complete',
            }
          })
          updateMessages(workingMessages)

          if (toolCalls.length === 0) return

          const toolExecution = await executeToolCallsWithApproval(
            workspace,
            toolCalls,
            workingMessages
          )
          const nextAssistantMessage = createLoadingAssistantMessage()
          workingMessages = [
            ...toolExecution.messages,
            nextAssistantMessage,
          ]
          updateMessages(workingMessages)
        }

        workingMessages = workingMessages.map((message, index) => {
          if (index !== workingMessages.length - 1) return message
          return {
            ...message,
            versions: [
              {
                ...message.versions[0],
                content: t('Agent stopped after reaching the tool step limit'),
              },
            ],
            status: 'complete',
          }
        })
        updateMessages(workingMessages)
      } catch (error) {
        if (agentStreamControlRef.current.stopped) return
        const message =
          error instanceof Error ? error.message : t('Agent request failed')
        toast.error(message)
        workingMessages = workingMessages.map((item, index) => {
          if (index !== workingMessages.length - 1) return item
          return {
            ...item,
            versions: [
              {
                ...item.versions[0],
                content: `${t('Agent request failed')}: ${message}`,
              },
            ],
            status: 'error',
            errorCode: 'agent_error',
          }
        })
        updateMessages(workingMessages)
      } finally {
        if (!agentStreamControlRef.current.stopped) {
          agentStreamControlRef.current.source?.close()
          agentStreamControlRef.current.source = null
          if (agentStreamControlRef.current.retryTimer) {
            clearTimeout(agentStreamControlRef.current.retryTimer)
            agentStreamControlRef.current.retryTimer = null
          }
          setIsAgentRunning(false)
        }
      }
    },
    [
      config,
      executeToolCallsWithApproval,
      agentHelperStatus,
      parameterEnabled,
      t,
      updateMessages,
    ]
  )

  const handleSendMessage = async (
    text: string,
    attachments: PlaygroundAttachment[] = []
  ) => {
    if (isAgentMode) {
      let workspace = activeWorkspaceHandle
      if (!workspace) {
        workspace = await pickWorkspace()
      }
      if (!workspace) return
      if (isAgentRunning) return

      updateActiveConversationMeta({ workspaceName: workspace.name })
      const userMessage = createUserMessage(text, attachments)
      const assistantMessage = createLoadingAssistantMessage()
      const newMessages = [...messages, userMessage, assistantMessage]
      const conversationId = activeConversationId
      updateMessages(newMessages)
      void runAgentConversation(newMessages, workspace, conversationId)
      return
    }

    const userMessage = createUserMessage(text, attachments)
    const assistantMessage = createLoadingAssistantMessage()

    const newMessages = [...messages, userMessage, assistantMessage]
    updateMessages(newMessages)

    // Send chat request
    sendChat(newMessages)
  }

  const handleCopyMessage = (message: MessageType) => {
    // Copy is handled in MessageActions component
    // eslint-disable-next-line no-console
    console.log('Message copied:', message.key)
  }

  const handleRegenerateMessage = (message: MessageType) => {
    // Find the message index and regenerate from there
    const messageIndex = messages.findIndex((m) => m.key === message.key)
    if (messageIndex === -1) return

    // Remove messages after this one and regenerate
    const messagesUpToHere = messages.slice(0, messageIndex)
    const loadingMessage = createLoadingAssistantMessage()
    const newMessages = [...messagesUpToHere, loadingMessage]

    updateMessages(newMessages)
    sendChat(newMessages)
  }

  const handleEditMessage = useCallback((message: MessageType) => {
    setEditingMessageKey(message.key)
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) setEditingMessageKey(null)
  }, [])

  // Apply edit and optionally re-submit from the edited user message
  const applyEdit = useCallback(
    (newContent: string, submit: boolean) => {
      if (!editingMessageKey) return
      const index = messages.findIndex((m) => m.key === editingMessageKey)
      if (index === -1) return

      const updated = messages.map((m) =>
        m.key === editingMessageKey
          ? { ...m, versions: [{ ...m.versions[0], content: newContent }] }
          : m
      )

      setEditingMessageKey(null)

      if (!submit || updated[index].from !== 'user') {
        updateMessages(updated)
        return
      }

      const toSubmit = [
        ...updated.slice(0, index + 1),
        createLoadingAssistantMessage(),
      ]
      updateMessages(toSubmit)
      sendChat(toSubmit)
    },
    [editingMessageKey, messages, updateMessages, sendChat]
  )

  const handleDeleteMessage = (message: MessageType) => {
    const newMessages = messages.filter((m) => m.key !== message.key)
    updateMessages(newMessages)
  }

  return (
    <div className='relative flex size-full flex-col overflow-hidden'>
      <PlaygroundHistorySidebar
        activeConversationId={activeConversationId}
        conversations={visibleConversations}
        isGenerating={isBusy}
        onCreateConversation={() => createNewConversation(mode)}
        onDeleteConversation={deleteConversation}
        onSelectConversation={switchConversation}
      />
      {isAgentMode && (
        <PlaygroundFileSidebar
          disabled={isBusy}
          root={activeWorkspaceHandle}
          workspaceName={workspaceName || activeWorkspaceHandle?.name}
        />
      )}

      {/* Full-width scroll container: scrolling works even over side whitespace */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='mx-auto hidden w-full max-w-4xl px-4 pt-4 sm:block'>
          <div className='bg-muted/35 flex flex-col gap-3 rounded-2xl border p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex gap-1 rounded-xl bg-background/80 p-1'>
              <Button
                className={cn(
                  'h-9 rounded-lg px-3',
                  mode === 'chat' && 'bg-primary text-primary-foreground'
                )}
                disabled={isBusy}
                onClick={() => handleModeChange('chat')}
                size='sm'
                type='button'
                variant={mode === 'chat' ? 'default' : 'ghost'}
              >
                <MessageCircleIcon className='mr-2 size-4' />
                {t('Chat mode')}
              </Button>
              <Button
                className={cn(
                  'h-9 rounded-lg px-3',
                  mode === 'agent' && 'bg-primary text-primary-foreground'
                )}
                disabled={isBusy}
                onClick={() => handleModeChange('agent')}
                size='sm'
                type='button'
                variant={mode === 'agent' ? 'default' : 'ghost'}
              >
                <BotIcon className='mr-2 size-4' />
                {t('Agent mode')}
              </Button>
            </div>

            {isAgentMode && (
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <span className='text-muted-foreground'>
                  {activeWorkspaceHandle
                    ? t('Workspace: {{name}}', {
                        name: workspaceName || activeWorkspaceHandle.name,
                      })
                    : t('No workspace selected')}
                </span>
                <span
                  className={cn(
                    'rounded-full border px-2 py-1 text-xs',
                    agentHelperStatus
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-muted-foreground/20 text-muted-foreground'
                  )}
                  title={
                    agentHelperStatus
                      ? agentHelperStatus.workspace_warning
                        ? `${agentHelperStatus.workspace}\n${agentHelperStatus.workspace_warning}`
                        : agentHelperStatus.workspace
                      : t('Start local helper to enable terminal tools')
                  }
                >
                  {agentHelperStatus?.workspace_warning
                    ? t('Helper workspace warning')
                    : agentHelperStatus
                      ? t('Helper connected')
                      : t('Helper offline')}
                </span>
                <Button
                  disabled={isBusy}
                  onClick={() => void pickWorkspace()}
                  size='sm'
                  type='button'
                  variant='outline'
                >
                  <FolderOpenIcon className='mr-2 size-4' />
                  {activeWorkspaceHandle
                    ? t('Change folder')
                    : t('Select folder')}
                </Button>
                {!agentHelperStatus && (
                  <Button
                    disabled={isBusy || isHelperDownloading}
                    onClick={() => void handleInstallOrLaunchHelper()}
                    size='sm'
                    type='button'
                    variant='outline'
                  >
                    <DownloadIcon className='mr-2 size-4' />
                    {isHelperDownloading
                      ? t('Downloading helper')
                      : t('Download or start helper')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <PlaygroundChat
          messages={messages}
          onCopyMessage={handleCopyMessage}
          onRegenerateMessage={handleRegenerateMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onApproveAgentToolCalls={handleApproveAgentToolCalls}
          isGenerating={isBusy}
          editingKey={editingMessageKey}
          onCancelEdit={handleEditOpenChange}
          onSaveEdit={(newContent) => applyEdit(newContent, false)}
          onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
        />
      </div>

      {/* Input area: center content and constrain to the same container width */}
      <div className='mx-auto w-full max-w-4xl'>
        <PlaygroundInput
          disabled={isBusy}
          groups={groups}
          groupValue={config.group}
          isGenerating={isBusy}
          isModelLoading={isLoadingModels}
          modelValue={config.model}
          models={models}
          onGroupChange={(value) => updateConfig('group', value)}
          onModelChange={(value) => updateConfig('model', value)}
          reasoningEffort={config.openaiReasoningEffort}
          onReasoningEffortChange={(value) =>
            updateConfig('openaiReasoningEffort', value)
          }
          fastMode={config.openaiFastMode}
          onFastModeChange={(value) => updateConfig('openaiFastMode', value)}
          onStop={isAgentMode ? stopAgentGeneration : stopGeneration}
          onSubmit={handleSendMessage}
          agentMode={isAgentMode}
        />
      </div>
    </div>
  )
}
