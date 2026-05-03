import type {
  AgentExternalProvider,
  AgentSettings,
  ContentPart,
  Message,
  PlaygroundConfig,
} from '../types'
import { DEFAULT_GROUP } from '../constants'
import { chargeExternalAgentRequestFee, sendChatCompletion } from '../api'
import { formatMessageForAPI, isValidMessage } from './message-utils'

function getMessageCompactionText(message: Message): string {
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
          result.summary ? `summary:\n${result.summary}` : '',
          result.output ? `output:\n${result.output}` : '',
          result.error ? `error:\n${result.error}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      ),
    ].join('\n')
  }
  const formatted = isValidMessage(message) ? formatMessageForAPI(message) : null
  if (!formatted) return ''
  const content =
    typeof formatted.content === 'string'
      ? formatted.content
      : formatted.content
          .map((part: ContentPart) => {
            if (part.type === 'text') return part.text || ''
            if (part.type === 'image_url') return '[image]'
            return ''
          })
          .join('\n')
  const nativeItems = message.agentResponsesOutputItems?.length
    ? `\n\nnative_responses_output_items:\n${JSON.stringify(
        message.agentResponsesOutputItems
      )}`
    : ''
  return `${formatted.role}:\n${content}${nativeItems}`
}

export function buildAgentSummaryPrompt(
  previousSummary: string | undefined,
  compactedMessages: Message[],
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

export function getCompactionSourceCharCount(
  previousSummary: string | undefined,
  compactedMessages: Message[]
): number {
  const previousLength = previousSummary?.length || 0
  const compactedLength = compactedMessages
    .map(getMessageCompactionText)
    .filter(Boolean)
    .join('\n\n---\n\n').length
  return previousLength + compactedLength
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

function externalEndpoint(baseUrl: string, endpoint: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
}

export async function requestAgentContextSummaryModel(
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

    await chargeExternalAgentRequestFee()
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
