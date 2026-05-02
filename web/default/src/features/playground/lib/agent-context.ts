import type {
  AgentContextSettings,
  AgentContextUsage,
  Message,
  PlaygroundConversation,
} from '../types'
import {
  createMessageVersion,
  formatMessageForAPI,
  isValidMessage,
} from './message-utils'

const EXTERNAL_AGENT_FEE_USD = 0.05
const QUOTA_PER_USD = 10000
const AGENT_CONTEXT_SUMMARY_KEY = 'agent-context-summary'

function estimateTokensFromText(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length
  const other = Math.max(text.length - cjk, 0)
  return Math.ceil(cjk * 0.9 + other / 4)
}

function getMessageText(message: Message): string {
  if (message.isAgentContextEvent) return ''
  const formatted = isValidMessage(message) ? formatMessageForAPI(message) : null
  if (!formatted) return ''
  if (typeof formatted.content === 'string') return formatted.content
  return formatted.content
    .map((part) => {
      if (part.type === 'text') return part.text || ''
      if (part.type === 'image_url') return '[image]'
      return ''
    })
    .join('\n')
}

export function estimateMessageTokens(message: Message): number {
  const base = estimateTokensFromText(getMessageText(message))
  const toolOverhead = message.isAgentToolResult ? 80 : 4
  return base + toolOverhead
}

function countUserTurns(messages: Message[]): number {
  return messages.filter(
    (message) =>
      message.from === 'user' &&
      !message.isAgentToolResult &&
      !isCompactionSummaryMessage(message)
  ).length
}

function getRecentTailStartIndex(messages: Message[], tailTurns: number): number {
  if (tailTurns <= 0) return messages.length
  let seen = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message.from === 'user' &&
      !message.isAgentToolResult &&
      !isCompactionSummaryMessage(message)
    ) {
      seen += 1
      if (seen >= tailTurns) return index
    }
  }
  return 0
}

function compactToolResult(message: Message): string {
  const results = message.agentToolResults || []
  if (results.length > 0) {
    return results
      .map((result) => {
        const status = result.ok ? 'ok' : 'failed'
        const detail = result.summary || result.error || result.output || ''
        return `- ${result.tool} ${result.path || '.'}: ${status}${detail ? `, ${detail.slice(0, 240)}` : ''}`
      })
      .join('\n')
  }
  return getMessageText(message).slice(0, 500)
}

export function buildAgentContextSummary(
  previousSummary: string | undefined,
  compactedMessages: Message[],
  workspaceName: string
): string {
  const userGoals = compactedMessages
    .filter(
      (message) =>
        message.from === 'user' &&
        !message.isAgentToolResult &&
        !isCompactionSummaryMessage(message)
    )
    .slice(-6)
    .map((message) => `- ${getMessageText(message).slice(0, 500)}`)
  const assistantProgress = compactedMessages
    .filter((message) => message.from === 'assistant')
    .slice(-6)
    .map((message) => `- ${getMessageText(message).slice(0, 500)}`)
  const toolFacts = compactedMessages
    .filter((message) => message.isAgentToolResult)
    .slice(-10)
    .map(compactToolResult)

  return [
    '这是当前 Agent 会话的压缩上下文摘要。旧消息不会再完整发送给模型，后续回答必须以此摘要和最新消息为准。',
    '',
    `工作目录: ${workspaceName || '未选择'}`,
    '',
    previousSummary ? `上一轮摘要:\n${previousSummary}` : '',
    '',
    '用户目标与约束:',
    userGoals.length > 0 ? userGoals.join('\n') : '- 暂无可提取目标',
    '',
    '已完成进展与关键决策:',
    assistantProgress.length > 0
      ? assistantProgress.join('\n')
      : '- 暂无可提取进展',
    '',
    '关键工具结果:',
    toolFacts.length > 0 ? toolFacts.join('\n') : '- 暂无关键工具结果',
    '',
    '继续工作时:',
    '- 优先遵循最新用户消息。',
    '- 需要文件细节时重新读取文件，不要臆测旧工具输出。',
    '- 不要引用已被压缩掉的 function_call/output call_id。',
  ]
    .filter((section) => section !== '')
    .join('\n')
}

export function buildCompactionSummaryMessage(summary: string): Message {
  return {
    key: AGENT_CONTEXT_SUMMARY_KEY,
    from: 'user',
    versions: [createMessageVersion(summary)],
  }
}

function isCompactionSummaryMessage(message: Message): boolean {
  return message.key === AGENT_CONTEXT_SUMMARY_KEY
}

export function buildModelVisibleAgentMessages(
  conversation: PlaygroundConversation | undefined,
  workingMessages: Message[],
  settings: AgentContextSettings
): Message[] {
  const modelMessages = workingMessages.filter(
    (message) => !message.isAgentContextEvent
  )
  if (!settings.enabled || !conversation?.agentContextSummary) {
    return modelMessages
  }

  const compactedBeforeKey = conversation.agentContextCompactedBeforeKey
  const startIndex = compactedBeforeKey
    ? modelMessages.findIndex((message) => message.key === compactedBeforeKey)
    : -1
  const tail = startIndex >= 0 ? modelMessages.slice(startIndex) : modelMessages
  return [buildCompactionSummaryMessage(conversation.agentContextSummary), ...tail]
}

export function calculateAgentContextUsage(
  messages: Message[],
  settings: AgentContextSettings,
  compactedTokens = 0
): AgentContextUsage {
  let userTokens = 0
  let assistantTokens = 0
  let toolTokens = 0
  let systemTokens = 0

  for (const message of messages) {
    const tokens = estimateMessageTokens(message)
    if (isCompactionSummaryMessage(message)) {
      compactedTokens += tokens
    } else if (message.isAgentToolResult) {
      toolTokens += tokens
    } else if (message.from === 'user') {
      userTokens += tokens
    } else if (message.from === 'assistant') {
      assistantTokens += tokens
    } else {
      systemTokens += tokens
    }
  }

  const totalTokens =
    userTokens + assistantTokens + toolTokens + systemTokens + compactedTokens
  const limitTokens = Math.max(settings.contextLimit || 1, 1)
  return {
    totalTokens,
    limitTokens,
    thresholdTokens: Math.floor(
      limitTokens * Math.min(Math.max(settings.compactThresholdRatio || 0.9, 0.1), 1)
    ),
    compactedTokens,
    userTokens,
    assistantTokens,
    toolTokens,
    systemTokens,
    feeUSD: EXTERNAL_AGENT_FEE_USD,
    feeQuota: Math.round(EXTERNAL_AGENT_FEE_USD * QUOTA_PER_USD),
  }
}

export function shouldCompactAgentContext(
  messages: Message[],
  settings: AgentContextSettings
): boolean {
  if (!settings.enabled) return false
  if (countUserTurns(messages) <= settings.tailTurns) return false
  const usage = calculateAgentContextUsage(messages, settings)
  return usage.totalTokens >= usage.thresholdTokens
}

export function compactAgentConversationIfNeeded(
  conversation: PlaygroundConversation | undefined,
  workingMessages: Message[],
  settings: AgentContextSettings,
  workspaceName: string,
  force = false
): {
  changed: boolean
  summary?: string
  compactedBeforeKey?: string
  usage: AgentContextUsage
} {
  const plan = prepareAgentContextCompaction(
    conversation,
    workingMessages,
    settings,
    workspaceName,
    force
  )
  if (!plan.changed) return { changed: false, usage: plan.usage }

  return {
    changed: true,
    summary: plan.localSummary,
    compactedBeforeKey: plan.compactedBeforeKey,
    usage: plan.usage,
  }
}

export function prepareAgentContextCompaction(
  conversation: PlaygroundConversation | undefined,
  workingMessages: Message[],
  settings: AgentContextSettings,
  workspaceName: string,
  force = false
): {
  changed: boolean
  previousSummary?: string
  compactedMessages: Message[]
  tailMessages: Message[]
  compactedBeforeKey?: string
  localSummary?: string
  usage: AgentContextUsage
} {
  const visibleMessages = buildModelVisibleAgentMessages(
    conversation,
    workingMessages,
    settings
  )
  const baseUsage = calculateAgentContextUsage(visibleMessages, settings)
  if (!force && !shouldCompactAgentContext(visibleMessages, settings)) {
    return {
      changed: false,
      compactedMessages: [],
      tailMessages: visibleMessages,
      usage: baseUsage,
    }
  }

  const tailStart = getRecentTailStartIndex(visibleMessages, settings.tailTurns)
  if (tailStart <= 0) {
    return {
      changed: false,
      compactedMessages: [],
      tailMessages: visibleMessages,
      usage: baseUsage,
    }
  }

  const compactedMessages = visibleMessages
    .slice(0, tailStart)
    .filter((message) => !isCompactionSummaryMessage(message))
  const tailMessages = visibleMessages.slice(tailStart)
  const localSummary = buildAgentContextSummary(
    conversation?.agentContextSummary,
    compactedMessages,
    workspaceName
  )
  const summaryTokens = estimateTokensFromText(localSummary)
  return {
    changed: true,
    previousSummary: conversation?.agentContextSummary,
    compactedMessages,
    tailMessages,
    compactedBeforeKey: tailMessages[0]?.key,
    localSummary,
    usage: calculateAgentContextUsage(tailMessages, settings, summaryTokens),
  }
}
