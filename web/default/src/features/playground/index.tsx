import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BotIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FolderOpenIcon,
  MessageCircleIcon,
  PlayIcon,
  SettingsIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SSE } from 'sse.js'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { getCommonHeaders } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  chargeExternalAgentRequestFee,
  sendChatCompletion,
  getUserModels,
  getUserGroups,
} from './api'
import { PlaygroundHistorySidebar } from './components/playground-history-sidebar'
import { PlaygroundFileSidebar } from './components/playground-file-sidebar'
import { PlaygroundAgentSettingsDialog } from './components/playground-agent-settings-dialog'
import { PlaygroundChat } from './components/playground-chat'
import { PlaygroundInput } from './components/playground-input'
import { API_ENDPOINTS, DEFAULT_GROUP } from './constants'
import { usePlaygroundState, useChatHandler } from './hooks'
import {
  AGENT_SYSTEM_PROMPT,
  buildModelVisibleAgentMessages,
  buildAgentHelperManualCommand,
  buildAgentToolReviewResults,
  buildChatCompletionPayload,
  calculateAgentContextUsage,
  prepareAgentContextCompaction,
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
  isAgentHelperPaired,
  getVisibleAgentContent,
  isOpenAIFastMode,
  isOpenAIReasoningModel,
  isValidMessage,
  isFileSystemAccessSupported,
  loadHelperAgentConversations,
  launchAgentHelperProtocol,
  pairAgentHelper,
  parseAgentToolCalls,
  requestWorkspaceDirectory,
  requiresAgentToolApproval,
  saveHelperAgentConversations,
  stripAgentToolBlocks,
  shouldUseOpenAICompatibleMode,
} from './lib'
import type {
  AgentHelperStatus,
  AgentToolRuntime,
  AgentToolCall,
  AgentToolName,
  AgentToolResult,
} from './lib'
import type {
  AgentExternalProvider,
  AgentSettings,
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

function isUnsupportedHelperHistoryError(error: unknown): boolean {
  return error instanceof Error && /unsupported_fs_op/i.test(error.message)
}

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

function isWorkspaceMutatingToolCall(call: AgentToolCall): boolean {
  return ['write_file', 'append_file', 'batch_edit', 'create_dir'].includes(
    call.tool
  )
}

function getHelperWorkspaceName(status: AgentHelperStatus | null): string {
  const workspace = status?.workspace?.replace(/\\/g, '/').replace(/\/+$/, '')
  return workspace?.split('/').filter(Boolean).pop() || 'Helper workspace'
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
  helperStatus: AgentHelperStatus | null,
  extraSystemPrompt = ''
): MessageType {
  return {
    key: 'agent-system',
    from: 'system',
    versions: [
      createMessageVersion(
        buildAgentInstructions(workspaceName, false, helperStatus, extraSystemPrompt)
      ),
    ],
  }
}

function buildAgentInstructions(
  workspaceName: string,
  useNativeResponsesTools: boolean,
  helperStatus: AgentHelperStatus | null,
  extraSystemPrompt = ''
): string {
  const workspaceLine = `当前工作目录: ${workspaceName || '未选择'}`
  const helperLine = helperStatus
    ? `本地 helper: 已连接，命令工作目录 ${helperStatus.workspace}，Shell ${helperStatus.shell}`
    : '本地 helper: 未连接；不要尝试运行终端命令。'
  const customPrompt = extraSystemPrompt.trim()
    ? `\n\n用户自定义 Agent 规则:\n${extraSystemPrompt.trim()}`
    : ''
  if (!useNativeResponsesTools) {
    return `${AGENT_SYSTEM_PROMPT}\n\n${workspaceLine}\n${helperLine}${customPrompt}`
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
${helperLine}${customPrompt}`
}

function buildAgentPromptCacheKey(
  conversationId?: string | null
): string | undefined {
  if (!conversationId) return undefined
  return `xingkong-playground-agent:${conversationId}`
}

function createAgentContextEventMessage(
  content: string,
  status: MessageType['status'] = 'complete'
): MessageType {
  return {
    ...createLoadingAssistantMessage(),
    isAgentContextEvent: true,
    status,
    versions: [createMessageVersion(content)],
  }
}

function getMessageCompactionText(message: MessageType): string {
  if (message.isAgentContextEvent) return ''
  if (message.key === 'agent-context-summary') {
    return `previous_summary:\n${message.versions?.[0]?.content || ''}`
  }
  if (message.isAgentToolResult) {
    const results = message.agentToolResults || []
    return [
      'tool_results:',
      ...results.map((result) =>
        [
          `- ${result.tool} ${result.path || '.'}`,
          result.ok ? 'ok' : 'failed',
          result.summary || result.error || result.output || '',
        ]
          .filter(Boolean)
          .join(' | ')
      ),
    ].join('\n')
  }
  const formatted = isValidMessage(message) ? formatMessageForAPI(message) : null
  if (!formatted) return ''
  const content =
    typeof formatted.content === 'string'
      ? formatted.content
      : formatted.content
          .map((part) => {
            if (part.type === 'text') return part.text || ''
            if (part.type === 'image_url') return '[image]'
            return ''
          })
          .join('\n')
  return `${formatted.role}:\n${content}`
}

function buildAgentSummaryPrompt(
  previousSummary: string | undefined,
  compactedMessages: MessageType[],
  workspaceName: string
): string {
  const transcript = compactedMessages
    .map(getMessageCompactionText)
    .filter(Boolean)
    .join('\n\n---\n\n')

  return [
    '你是代码 Agent 的上下文压缩器。请把旧对话压缩成后续 Agent 可以继续工作的摘要。',
    '',
    '要求:',
    '- 用中文输出，结构清晰但不要冗长。',
    '- 保留用户目标、硬性约束、已完成修改、未完成任务、关键文件路径、重要命令结果和风险。',
    '- 工具输出只保留对后续有用的事实，不要机械复述长日志。',
    '- 不要引用旧的 function_call/call_id，也不要要求读取已压缩消息。',
    '- 后续如果需要文件细节，Agent 应重新读取文件。',
    '',
    `工作目录: ${workspaceName || '未选择'}`,
    previousSummary ? `\n已有摘要:\n${previousSummary}` : '',
    '',
    '需要压缩的旧对话:',
    transcript || '(empty)',
  ].join('\n')
}

function extractExternalResponsesText(payload: unknown): string {
  const response = payload as {
    output_text?: string
    output?: Array<{
      content?: Array<{ text?: string; type?: string }>
    }>
  }
  if (response.output_text) return response.output_text
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || '')
    .join('')
}

async function requestAgentContextSummaryModel(
  prompt: string,
  settings: AgentSettings,
  config: PlaygroundConfig,
  externalProviders: AgentExternalProvider[]
): Promise<string> {
  if (settings.context.summaryProviderKind === 'external') {
    const provider =
      externalProviders.find(
        (item) => item.id === settings.context.summaryExternalProviderId
      ) ||
      externalProviders.find((item) => item.id === settings.activeExternalProviderId) ||
      externalProviders[0]
    if (!provider) throw new Error('summary_external_provider_missing')
    const model =
      settings.context.summaryExternalModel ||
      provider.selectedModel ||
      provider.models[0]?.value
    if (!model) throw new Error('summary_external_model_missing')

    await chargeExternalRequestFeeOnce()
    if (provider.endpointType === 'responses') {
      const response = await fetch(externalEndpoint(provider.baseUrl, '/responses'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model,
          instructions: '你只负责压缩 Agent 上下文，直接输出摘要正文。',
          input: prompt,
          stream: false,
        }),
      })
      if (!response.ok) {
        throw new Error(`summary_http_${response.status}: ${await response.text()}`)
      }
      const text = extractExternalResponsesText(await response.json()).trim()
      if (!text) throw new Error('summary_empty')
      return text
    }

    const response = await fetch(
      externalEndpoint(provider.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: '你只负责压缩 Agent 上下文，直接输出摘要正文。',
            },
            { role: 'user', content: prompt },
          ],
          stream: false,
          temperature: 0.2,
        }),
      }
    )
    if (!response.ok) {
      throw new Error(`summary_http_${response.status}: ${await response.text()}`)
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = payload.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('summary_empty')
    return text
  }

  const model = settings.context.summaryBuiltinModel || config.model
  const response = await sendChatCompletion({
    model,
    group: config.group || DEFAULT_GROUP,
    stream: false,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: '你只负责压缩 Agent 上下文，直接输出摘要正文。',
      },
      { role: 'user', content: prompt },
    ],
  })
  const text = response.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('summary_empty')
  return text
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

function externalEndpoint(baseUrl: string, endpoint: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
}

async function chargeExternalRequestFeeOnce(): Promise<void> {
  await chargeExternalAgentRequestFee()
}

function streamExternalAgentChatCompletion(
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

export function Playground() {
  const { t } = useTranslation()
  const {
    config,
    parameterEnabled,
    agentSettings,
    messages,
    mode,
    workspaceName,
    models,
    groups,
    conversations,
    activeConversationId,
    activeConversation,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateAgentSettings,
    createNewConversation,
    switchConversation,
    switchMode,
    deleteConversation,
    updateActiveConversationMeta,
    replaceModeConversations,
    setConversationPersistenceEnabled,
  } = usePlaygroundState()
  const [workspaceHandles, setWorkspaceHandles] = useState<
    Record<string, FileSystemDirectoryHandle>
  >({})
  const [agentHelperStatus, setAgentHelperStatus] =
    useState<AgentHelperStatus | null>(null)
  const [isHelperDownloading, setIsHelperDownloading] = useState(false)
  const [isHelperPairing, setIsHelperPairing] = useState(false)
  const [isHelperPairDialogOpen, setIsHelperPairDialogOpen] = useState(false)
  const [helperPairCodeInput, setHelperPairCodeInput] = useState('')
  const [helperManualCommand, setHelperManualCommand] = useState('')
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0)
  const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState(false)
  const [helperHistoryReady, setHelperHistoryReady] = useState(false)
  const [helperHistorySupported, setHelperHistorySupported] = useState(true)
  const lastSavedHelperHistoryRef = useRef('')
  const helperStatusMissesRef = useRef(0)
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [isAgentCompacting, setIsAgentCompacting] = useState(false)
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
  const isHelperConnected = isAgentHelperPaired(agentHelperStatus)
  const usableHelperStatus = isHelperConnected ? agentHelperStatus : null
  const helperHistoryKey =
    isAgentMode && usableHelperStatus ? usableHelperStatus.workspace : ''
  const activeWorkspaceName =
    workspaceName ||
    activeWorkspaceHandle?.name ||
    (usableHelperStatus ? getHelperWorkspaceName(usableHelperStatus) : '')
  const activeAgentRuntime: AgentToolRuntime = usableHelperStatus
    ? { helper: usableHelperStatus }
    : { root: activeWorkspaceHandle }
  const visibleConversations = conversations.filter(
    (conversation) => (conversation.mode || 'chat') === mode
  )
  const activeExternalProvider =
    agentSettings.externalProviders.find(
      (provider) => provider.id === agentSettings.activeExternalProviderId
    ) || agentSettings.externalProviders[0]
  const agentUsesExternalProvider =
    isAgentMode && agentSettings.providerKind === 'external' && !!activeExternalProvider
  const agentChannelOptions = [
    { label: t('内置渠道'), value: 'builtin', ratio: 1 },
    ...agentSettings.externalProviders.map((provider) => ({
      label: provider.name || t('外置渠道'),
      value: provider.id,
      ratio: 1,
      desc: provider.endpointType === 'responses' ? 'Responses' : 'Chat Completions',
    })),
  ]
  const activeAgentChannelValue = agentUsesExternalProvider
    ? activeExternalProvider.id
    : 'builtin'
  const activeAgentModels =
    agentUsesExternalProvider && activeExternalProvider.models.length > 0
      ? activeExternalProvider.models
      : models
  const activeAgentModelValue = agentUsesExternalProvider
    ? activeExternalProvider.selectedModel || activeExternalProvider.models[0]?.value || ''
    : config.model
  const contextUsage = calculateAgentContextUsage(
    buildModelVisibleAgentMessages(
      activeConversation,
      messages,
      agentSettings.context
    ),
    agentSettings.context
  )

  useEffect(() => {
    if (!isAgentMode || !helperHistoryKey) {
      setHelperHistoryReady(false)
      setHelperHistorySupported(true)
      setConversationPersistenceEnabled(true)
      return
    }

    let cancelled = false
    setConversationPersistenceEnabled(false)
    setHelperHistoryReady(false)
    setHelperHistorySupported(true)
    lastSavedHelperHistoryRef.current = ''

    const load = async () => {
      try {
        const state = await loadHelperAgentConversations()
        if (cancelled) return
        replaceModeConversations(
          'agent',
          state.conversations,
          state.activeConversationId
        )
        if (state.agentSettings) {
          updateAgentSettings(state.agentSettings)
        }
        setHelperHistoryReady(true)
      } catch (error) {
        if (cancelled) return
        if (isUnsupportedHelperHistoryError(error)) {
          setHelperHistorySupported(false)
          setConversationPersistenceEnabled(true)
          toast.error(t('Helper is too old. Please download the latest helper.'))
          return
        }
        toast.error(
          error instanceof Error
            ? error.message
            : t('Failed to load helper conversation history')
        )
        setHelperHistoryReady(true)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [
    helperHistoryKey,
    isAgentMode,
    replaceModeConversations,
    setConversationPersistenceEnabled,
    t,
    updateAgentSettings,
  ])

  useEffect(() => {
    if (!helperHistoryReady || !helperHistoryKey || !helperHistorySupported) return
    const agentConversations = conversations.filter(
      (conversation) => (conversation.mode || 'chat') === 'agent'
    )
    const activeAgentId = agentConversations.some(
      (conversation) => conversation.id === activeConversationId
    )
      ? activeConversationId
      : agentConversations[0]?.id || null
    const serialized = JSON.stringify({
      conversations: agentConversations,
      activeConversationId: activeAgentId,
    })
    if (serialized === lastSavedHelperHistoryRef.current) return

    const timer = window.setTimeout(() => {
      lastSavedHelperHistoryRef.current = serialized
      void saveHelperAgentConversations({
        conversations: agentConversations,
        activeConversationId: activeAgentId,
        agentSettings,
      }).catch((error) => {
        lastSavedHelperHistoryRef.current = ''
        if (isUnsupportedHelperHistoryError(error)) {
          setHelperHistorySupported(false)
          setConversationPersistenceEnabled(true)
          toast.error(t('Helper is too old. Please download the latest helper.'))
          return
        }
        toast.error(
          error instanceof Error
            ? error.message
            : t('Failed to save helper conversation history')
        )
      })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [
    activeConversationId,
    conversations,
    helperHistoryKey,
    helperHistoryReady,
    helperHistorySupported,
    agentSettings,
    setConversationPersistenceEnabled,
    t,
  ])

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
  })
  const isBusy = isGenerating || isAgentRunning || isAgentCompacting

  useEffect(() => {
    if (!isAgentMode) return

    let cancelled = false
    const refresh = async () => {
      const status = await checkAgentHelperStatus()
      if (cancelled) return
      if (status) {
        helperStatusMissesRef.current = 0
        setAgentHelperStatus(status)
        return
      }
      helperStatusMissesRef.current += 1
      setAgentHelperStatus((previous) =>
        previous && helperStatusMissesRef.current < 3 ? previous : null
      )
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

  const ensureWorkspaceForHelper = useCallback(async () => {
    let workspace = activeWorkspaceHandle
    if (!workspace) {
      workspace = await pickWorkspace()
    }
    return workspace || null
  }, [activeWorkspaceHandle, pickWorkspace])

  const handleDownloadHelper = useCallback(async () => {
    const workspace = await ensureWorkspaceForHelper()
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
      setHelperManualCommand(buildAgentHelperManualCommand(fileName))
      toast.info(t('Helper downloaded. Start it from the helper menu.'))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to download helper')
      )
    } finally {
      setIsHelperDownloading(false)
    }
  }, [ensureWorkspaceForHelper, t])

  const refreshAgentHelperStatus = useCallback(async () => {
    const status = await checkAgentHelperStatus(2500)
    setAgentHelperStatus(status)
    return status
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pairCode = params.get('xingkong_helper_pair_code')?.trim()
    const shouldAutoStart = params.get('xingkong_helper_autostart') === '1'
    const shouldResume = params.get('xingkong_helper_resume') === '1'
    if (!pairCode || !shouldAutoStart) return

    let cancelled = false
    const run = async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (cancelled) return
        try {
          await pairAgentHelper(pairCode)
          const status = await refreshAgentHelperStatus()
          if (!cancelled && isAgentHelperPaired(status)) {
            if (shouldResume) {
              switchMode('agent')
            } else {
              createNewConversation('agent', {
                workspaceName: getHelperWorkspaceName(status),
              })
            }
            toast.success(t('Helper paired'))
            params.delete('xingkong_helper_pair_code')
            params.delete('xingkong_helper_autostart')
            params.delete('xingkong_agent_mode')
            params.delete('xingkong_helper_resume')
            const nextQuery = params.toString()
            window.history.replaceState(
              null,
              '',
              `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`
            )
            return
          }
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 700))
        }
      }
      if (!cancelled) {
        setHelperPairCodeInput(pairCode)
        setIsHelperPairDialogOpen(true)
        toast.error(t('Failed to pair helper'))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [createNewConversation, refreshAgentHelperStatus, switchMode, t])

  const handlePairHelper = useCallback(
    async (code: string) => {
      if (!code) return
      setIsHelperPairing(true)
      try {
        await pairAgentHelper(code)
        const status = await refreshAgentHelperStatus()
        setAgentHelperStatus(status)
        if (isAgentHelperPaired(status)) {
          toast.success(t('Helper paired'))
          setHelperPairCodeInput('')
          setHelperManualCommand('')
          setIsHelperPairDialogOpen(false)
        } else {
          toast.info(t('Helper is reachable but not paired yet'))
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t('Failed to pair helper')
        )
      } finally {
        setIsHelperPairing(false)
      }
    },
    [refreshAgentHelperStatus, t]
  )

  const handleStartHelper = useCallback(async () => {
    const target = getAgentHelperDownloadTarget()
    setHelperManualCommand(buildAgentHelperManualCommand(target.fileName))
    launchAgentHelperProtocol()

    window.setTimeout(async () => {
      const status = await refreshAgentHelperStatus()
      if (status) {
        if (isAgentHelperPaired(status)) return
        setIsHelperPairDialogOpen(true)
        return
      }
      setIsHelperPairDialogOpen(true)
      toast.info(
        t('Helper launch failed. Start helper manually and enter the pairing code.')
      )
    }, 2000)
  }, [refreshAgentHelperStatus, t])

  const handleCopyManualHelperCommand = useCallback(async () => {
    if (!helperManualCommand || !navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(helperManualCommand)
    toast.success(t('Command copied'))
  }, [helperManualCommand, t])

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
      runtime: AgentToolRuntime,
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
        const results = await executeAgentToolCalls(runtime, calls)
        if (calls.some(isWorkspaceMutatingToolCall)) {
          setWorkspaceRefreshKey((value) => value + 1)
        }
        return {
          results,
          messages: [...workingMessages, createToolMessage('complete', results)],
        }
      }

      const reviewResults = await buildAgentToolReviewResults(runtime, calls)
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
        const results = await executeAgentToolCalls(runtime, calls)
        if (calls.some(isWorkspaceMutatingToolCall)) {
          setWorkspaceRefreshKey((value) => value + 1)
        }
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
              ...(await executeAgentToolCalls(runtime, safeCalls)),
              ...deniedResults,
            ]
          : deniedResults
      if (safeCalls.some(isWorkspaceMutatingToolCall)) {
        setWorkspaceRefreshKey((value) => value + 1)
      }
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

  const compactAgentMessages = useCallback(
    async ({
      currentConversation,
      currentMessages,
      currentAgentSettings,
      runtimeWorkspaceName,
      force = false,
      showStatus = true,
    }: {
      currentConversation: typeof activeConversation
      currentMessages: MessageType[]
      currentAgentSettings: AgentSettings
      runtimeWorkspaceName: string
      force?: boolean
      showStatus?: boolean
    }): Promise<{
      changed: boolean
      messages: MessageType[]
      summary?: string
      compactedBeforeKey?: string
      usage: ReturnType<typeof calculateAgentContextUsage>
    }> => {
      const plan = prepareAgentContextCompaction(
        currentConversation,
        currentMessages,
        currentAgentSettings.context,
        runtimeWorkspaceName,
        force
      )
      if (!plan.changed) {
        updateActiveConversationMeta({ agentContextUsage: plan.usage })
        return { changed: false, messages: currentMessages, usage: plan.usage }
      }

      let nextMessages = currentMessages
      let statusMessageKey: string | null = null
      if (showStatus) {
        const statusMessage = createAgentContextEventMessage(
          t('正在压缩上下文...'),
          'loading'
        )
        statusMessageKey = statusMessage.key
        nextMessages = [...nextMessages, statusMessage]
        updateMessages(nextMessages)
      }

      setIsAgentCompacting(true)
      let summary = plan.localSummary || ''
      let usedFallback = false
      try {
        const prompt = buildAgentSummaryPrompt(
          plan.previousSummary,
          plan.compactedMessages,
          runtimeWorkspaceName
        )
        summary = await requestAgentContextSummaryModel(
          prompt,
          currentAgentSettings,
          config,
          currentAgentSettings.externalProviders
        )
      } catch (error) {
        usedFallback = true
        toast.warning(t('摘要模型压缩失败，已使用本地摘要兜底'), {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setIsAgentCompacting(false)
      }

      const usage = calculateAgentContextUsage(
        plan.tailMessages,
        currentAgentSettings.context,
        summary.length ? Math.ceil(summary.length / 4) : 0
      )
      const divider = createAgentContextEventMessage(
        usedFallback ? t('上下文已压缩，本轮使用本地兜底摘要') : t('上下文已压缩'),
        'complete'
      )
      nextMessages = statusMessageKey
        ? nextMessages.map((message) =>
            message.key === statusMessageKey ? divider : message
          )
        : [...nextMessages, divider]

      updateMessages(nextMessages)
      updateActiveConversationMeta({
        agentContextSummary: summary,
        agentContextSummaryUpdatedAt: Date.now(),
        agentContextCompactedBeforeKey: plan.compactedBeforeKey,
        agentContextUsage: usage,
      })

      return {
        changed: true,
        messages: nextMessages,
        summary,
        compactedBeforeKey: plan.compactedBeforeKey,
        usage,
      }
    },
    [config, t, updateActiveConversationMeta, updateMessages]
  )

  const runAgentConversation = useCallback(
    async (
      initialMessages: MessageType[],
      runtime: AgentToolRuntime,
      runtimeWorkspaceName: string,
      conversationId: string | null,
      externalProvider: AgentExternalProvider | null,
      currentAgentSettings: AgentSettings,
      currentConversation = activeConversation
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
      let contextConversation = currentConversation
      const useExternalResponses =
        !!externalProvider && externalProvider.endpointType === 'responses'
      const useNativeResponses =
        !externalProvider &&
        isOpenAIReasoningModel(config.model) &&
        !shouldUseOpenAICompatibleMode(config)

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

          const visibleModelMessages = buildModelVisibleAgentMessages(
            contextConversation,
            workingMessages,
            currentAgentSettings.context
          )

          if (useNativeResponses || useExternalResponses) {
            const payload = buildAgentResponsesPayload(
              visibleModelMessages,
              {
                ...config,
                model:
                  externalProvider?.selectedModel ||
                  externalProvider?.models[0]?.value ||
                  config.model,
                openaiRequestMode: externalProvider
                  ? 'compatible'
                  : config.openaiRequestMode,
                stream: true,
              },
              parameterEnabled,
              runtimeWorkspaceName,
              conversationId,
              usableHelperStatus,
              currentAgentSettings.context.systemPrompt
            )
            if (useExternalResponses) {
              delete payload.group
              delete payload.prompt_cache_key
            }
            if (payload.input.length === 0) {
              throw new Error('responses_input_empty')
            }
            const result = await streamAgentResponsesCompletion(
              payload,
              (content) => updateLastAssistantContent(content, 'streaming', null),
              handleReconnect,
              control,
              useExternalResponses && externalProvider
                ? {
                    endpoint: externalEndpoint(externalProvider.baseUrl, '/responses'),
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${externalProvider.apiKey}`,
                    },
                    chargeBeforeRequest: chargeExternalRequestFeeOnce,
                  }
                : {}
            )
            rawContent = result.rawContent
            nativeToolCalls = result.nativeToolCalls
            nativeOutputItems = result.nativeOutputItems
          } else {
            const payload = buildChatCompletionPayload(
              [
                createAgentSystemMessage(
                  runtimeWorkspaceName,
                  usableHelperStatus,
                  currentAgentSettings.context.systemPrompt
                ),
                ...visibleModelMessages,
              ],
              {
                ...config,
                model:
                  externalProvider?.selectedModel ||
                  externalProvider?.models[0]?.value ||
                  config.model,
                stream: true,
              },
              parameterEnabled,
              {
                promptCacheKey: externalProvider
                  ? undefined
                  : buildAgentPromptCacheKey(conversationId),
              }
            )
            rawContent = externalProvider
              ? await streamExternalAgentChatCompletion(
                  externalProvider,
                  payload,
                  (content) => updateLastAssistantContent(content, 'streaming', null),
                  handleReconnect,
                  control
                )
              : await streamAgentCompletion(
                  payload,
                  (content) => updateLastAssistantContent(content, 'streaming', null),
                  handleReconnect,
                  control
                )
          }

          if (control.stopped) return
          const visibleContent = stripAgentToolBlocks(rawContent)
          const toolCalls = useNativeResponses || useExternalResponses
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
                  (useNativeResponses || useExternalResponses) &&
                  nativeOutputItems.length > 0
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

          if (toolCalls.length === 0) {
            const compaction = await compactAgentMessages({
              currentConversation: contextConversation,
              currentMessages: workingMessages,
              currentAgentSettings,
              runtimeWorkspaceName,
            })
            workingMessages = compaction.messages
            if (compaction.changed) {
              contextConversation = contextConversation
                ? {
                    ...contextConversation,
                    agentContextSummary: compaction.summary,
                    agentContextSummaryUpdatedAt: Date.now(),
                    agentContextCompactedBeforeKey:
                      compaction.compactedBeforeKey,
                    agentContextUsage: compaction.usage,
                  }
                : contextConversation
            }
            return
          }

          const toolExecution = await executeToolCallsWithApproval(
            runtime,
            toolCalls,
            workingMessages
          )
          workingMessages = toolExecution.messages
          updateMessages(workingMessages)

          const compaction = await compactAgentMessages({
            currentConversation: contextConversation,
            currentMessages: workingMessages,
            currentAgentSettings,
            runtimeWorkspaceName,
          })
          workingMessages = compaction.messages
          if (compaction.changed) {
            contextConversation = contextConversation
              ? {
                  ...contextConversation,
                  agentContextSummary: compaction.summary,
                  agentContextSummaryUpdatedAt: Date.now(),
                  agentContextCompactedBeforeKey: compaction.compactedBeforeKey,
                  agentContextUsage: compaction.usage,
                }
              : contextConversation
          }
          const nextAssistantMessage = createLoadingAssistantMessage()
          workingMessages = [...workingMessages, nextAssistantMessage]
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
      compactAgentMessages,
      executeToolCallsWithApproval,
      usableHelperStatus,
      parameterEnabled,
      t,
      activeConversation,
      updateActiveConversationMeta,
      updateMessages,
    ]
  )

  const handleSendMessage = async (
    text: string,
    attachments: PlaygroundAttachment[] = []
  ) => {
    if (isAgentMode) {
      let runtime = activeAgentRuntime
      let runtimeWorkspaceName = activeWorkspaceName
      if (!usableHelperStatus && !runtime.root) {
        let workspace = activeWorkspaceHandle
        workspace = await pickWorkspace()
        if (!workspace) return
        runtime = { root: workspace }
        runtimeWorkspaceName = workspace.name
      }
      if (isAgentRunning) return
      if (agentUsesExternalProvider && !activeAgentModelValue) {
        toast.error(t('请先在 Agent 设置中拉取并选择外置渠道模型'))
        return
      }

      updateActiveConversationMeta({ workspaceName: runtimeWorkspaceName })
      const userMessage = createUserMessage(text, attachments)
      const assistantMessage = createLoadingAssistantMessage()
      const newMessages = [...messages, userMessage, assistantMessage]
      const conversationId = activeConversationId
      updateMessages(newMessages)
      void runAgentConversation(
        newMessages,
        runtime,
        runtimeWorkspaceName,
        conversationId,
        agentUsesExternalProvider ? activeExternalProvider : null,
        agentSettings,
        activeConversation
      )
      return
    }

    const userMessage = createUserMessage(text, attachments)
    const assistantMessage = createLoadingAssistantMessage()

    const newMessages = [...messages, userMessage, assistantMessage]
    updateMessages(newMessages)

    // Send chat request
    sendChat(newMessages)
  }

  const handleCompactContextNow = () => {
    if (!isAgentMode || isBusy) return
    void compactAgentMessages({
      currentConversation: activeConversation,
      currentMessages: messages,
      currentAgentSettings: agentSettings,
      runtimeWorkspaceName: activeWorkspaceName,
      force: true,
      showStatus: true,
    }).then((result) => {
      if (!result.changed) {
        toast.info(t('当前上下文暂时没有可压缩的旧内容'))
      }
    })
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

  const handleAgentChannelChange = (value: string) => {
    if (!isAgentMode || value === 'builtin') {
      updateAgentSettings((prev) => ({
        ...prev,
        providerKind: 'builtin',
        activeExternalProviderId: undefined,
      }))
      return
    }
    updateAgentSettings((prev) => ({
      ...prev,
      providerKind: 'external',
      activeExternalProviderId: value,
    }))
  }

  const handleAgentModelChange = (value: string) => {
    if (!agentUsesExternalProvider || !activeExternalProvider) {
      updateConfig('model', value)
      return
    }
    updateAgentSettings((prev) => ({
      ...prev,
      externalProviders: prev.externalProviders.map((provider) =>
        provider.id === activeExternalProvider.id
          ? { ...provider, selectedModel: value }
          : provider
      ),
    }))
  }

  return (
    <div
      className='relative flex size-full flex-col overflow-hidden'
      style={
        isAgentMode
          ? {
              fontSize: `${agentSettings.context.fontSize}px`,
              fontFamily: agentSettings.context.fontFamily || undefined,
            }
          : undefined
      }
    >
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
          helperStatus={usableHelperStatus}
          refreshKey={workspaceRefreshKey}
          root={activeWorkspaceHandle}
          workspaceName={activeWorkspaceName}
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
                        name: activeWorkspaceName,
                      })
                    : usableHelperStatus
                      ? t('Workspace: {{name}}', {
                          name: activeWorkspaceName,
                        })
                      : t('No workspace selected')}
                </span>
                <span
                  className={cn(
                    'rounded-full border px-2 py-1 text-xs',
                    isHelperConnected
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : agentHelperStatus
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
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
                    : isHelperConnected
                      ? t('Helper connected')
                      : agentHelperStatus
                        ? t('Helper pairing required')
                      : t('Helper offline')}
                </span>
                {!usableHelperStatus && (
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
                )}
                {!isHelperConnected && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        disabled={isBusy || isHelperDownloading || isHelperPairing}
                        size='sm'
                        type='button'
                        variant='outline'
                      >
                        <DownloadIcon className='mr-2 size-4' />
                        {isHelperDownloading
                          ? t('Downloading helper')
                          : t('Helper actions')}
                        <ChevronDownIcon className='ml-2 size-3.5' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='w-48'>
                      <DropdownMenuItem
                        disabled={isHelperDownloading}
                        onClick={() => void handleDownloadHelper()}
                      >
                        <DownloadIcon className='mr-2 size-4' />
                        {t('Download helper')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleStartHelper()}>
                        <PlayIcon className='mr-2 size-4' />
                        {t('Start helper')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={isHelperPairing}
                        onClick={() => setIsHelperPairDialogOpen(true)}
                      >
                        <BotIcon className='mr-2 size-4' />
                        {t('Pair helper')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
          groups={isAgentMode ? agentChannelOptions : groups}
          groupValue={isAgentMode ? activeAgentChannelValue : config.group}
          groupLabel={isAgentMode ? t('渠道') : undefined}
          contextUsage={isAgentMode ? contextUsage : undefined}
          canCompactContext={isAgentMode && !isBusy}
          isCompactingContext={isAgentCompacting}
          isGenerating={isBusy}
          isModelLoading={isLoadingModels}
          modelValue={isAgentMode ? activeAgentModelValue : config.model}
          models={isAgentMode ? activeAgentModels : models}
          onGroupChange={(value) =>
            isAgentMode ? handleAgentChannelChange(value) : updateConfig('group', value)
          }
          onModelChange={(value) =>
            isAgentMode ? handleAgentModelChange(value) : updateConfig('model', value)
          }
          reasoningEffort={config.openaiReasoningEffort}
          onReasoningEffortChange={(value) =>
            updateConfig('openaiReasoningEffort', value)
          }
          requestMode={config.openaiRequestMode}
          onRequestModeChange={(value) => {
            updateConfig('openaiRequestMode', value)
            updateConfig('openaiFastMode', value === 'fast')
          }}
          onStop={isAgentMode ? stopAgentGeneration : stopGeneration}
          onCompactContextNow={handleCompactContextNow}
          onSubmit={handleSendMessage}
          agentMode={isAgentMode}
        />
      </div>

      {isAgentMode && (
        <Button
          className='absolute right-4 bottom-28 z-30 rounded-full shadow-sm'
          onClick={() => setIsAgentSettingsOpen(true)}
          size='icon'
          type='button'
          variant='outline'
        >
          <SettingsIcon className='size-4' />
          <span className='sr-only'>{t('Agent 设置')}</span>
        </Button>
      )}

      <PlaygroundAgentSettingsDialog
        open={isAgentSettingsOpen}
        onOpenChange={setIsAgentSettingsOpen}
        settings={agentSettings}
        onSettingsChange={updateAgentSettings}
        builtinModels={models}
      />

      <Dialog
        open={isHelperPairDialogOpen && !isHelperConnected}
        onOpenChange={setIsHelperPairDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Pair local helper')}</DialogTitle>
            <DialogDescription>
              {t(
                'Enter the pairing code printed in the local helper window. The web page never generates this code.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <Input
              autoFocus
              inputMode='numeric'
              maxLength={16}
              onChange={(event) =>
                setHelperPairCodeInput(event.target.value.replace(/\s+/g, ''))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handlePairHelper(helperPairCodeInput)
                }
              }}
              placeholder={t('Helper pairing code')}
              value={helperPairCodeInput}
            />
            {helperManualCommand && (
              <button
                className='text-muted-foreground flex min-w-0 items-center gap-2 text-left text-xs hover:text-foreground'
                onClick={() => void handleCopyManualHelperCommand()}
                type='button'
              >
                <CopyIcon className='size-3.5 shrink-0' />
                <span className='truncate'>
                  {t('Manual start command')}: {helperManualCommand}
                </span>
              </button>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setIsHelperPairDialogOpen(false)}
              type='button'
              variant='outline'
            >
              {t('Cancel')}
            </Button>
            <Button
              disabled={isHelperPairing || !helperPairCodeInput.trim()}
              onClick={() => void handlePairHelper(helperPairCodeInput)}
              type='button'
            >
              {isHelperPairing ? t('Pairing helper') : t('Pair helper')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
