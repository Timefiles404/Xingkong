import type { AgentHelperStatus, AgentToolCall } from './agent-tools'
import type { Message } from '../types'
import { AGENT_SYSTEM_PROMPT } from './agent-tools'
import {
  createLoadingAssistantMessage,
  createMessageVersion,
} from './message-utils'

export function isWorkspaceMutatingToolCall(call: AgentToolCall): boolean {
  return ['write_file', 'append_file', 'batch_edit', 'create_dir'].includes(
    call.tool
  )
}

export function getHelperWorkspaceName(status: AgentHelperStatus | null): string {
  const workspace = status?.workspace?.replace(/\\/g, '/').replace(/\/+$/, '')
  return workspace?.split('/').filter(Boolean).pop() || 'Helper workspace'
}

export function buildAgentInstructions(
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
- 调用 run_command 时必须填写非空 command；cwd 只表示相对工作目录，不是命令。列目录优先用 list_dir，可用 depth 获取多层目录；若用户明确要求命令行列目录，Windows 用 dir，macOS/Linux 用 ls -la。

${workspaceLine}
${helperLine}${customPrompt}`
}

export function createAgentSystemMessage(
  workspaceName: string,
  helperStatus: AgentHelperStatus | null,
  extraSystemPrompt = ''
): Message {
  return {
    key: 'agent-system',
    from: 'system',
    versions: [
      createMessageVersion(
        buildAgentInstructions(
          workspaceName,
          false,
          helperStatus,
          extraSystemPrompt
        )
      ),
    ],
  }
}

export function buildAgentPromptCacheKey(
  conversationId?: string | null
): string | undefined {
  if (!conversationId) return undefined
  return `xingkong-playground-agent:${conversationId}`
}

export function createAgentContextEventMessage(
  content: string,
  status: Message['status'] = 'complete',
  tooltip?: string
): Message {
  return {
    ...createLoadingAssistantMessage(),
    apiContent: tooltip,
    isAgentContextEvent: true,
    status,
    versions: [createMessageVersion(content)],
  }
}
