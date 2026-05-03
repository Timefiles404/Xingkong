import type { AgentHelperStatus } from './agent-helper'

export type AgentToolName =
  | 'list_dir'
  | 'read_file'
  | 'search_files'
  | 'grep'
  | 'write_file'
  | 'append_file'
  | 'batch_edit'
  | 'create_dir'
  | 'run_command'

export interface AgentBatchEdit {
  find: string
  replace: string
}

export interface AgentToolCall {
  id?: string
  tool: AgentToolName
  path?: string
  cwd?: string
  command?: string
  content?: string
  query?: string
  start?: number
  end?: number
  maxBytes?: number
  maxResults?: number
  depth?: number
  timeoutMs?: number
  edits?: AgentBatchEdit[]
}

export interface AgentToolResult {
  id?: string
  tool: string
  path: string
  ok: boolean
  summary?: string
  output?: string
  diff?: string
  error?: string
}

export interface AgentToolRuntime {
  root?: FileSystemDirectoryHandle
  helper?: AgentHelperStatus | null
}

export const MAX_TOOL_CALLS = 30

export const SUPPORTED_TOOLS: AgentToolName[] = [
  'list_dir',
  'read_file',
  'search_files',
  'grep',
  'write_file',
  'append_file',
  'batch_edit',
  'create_dir',
  'run_command',
]

export function requiresAgentToolApproval(call: AgentToolCall): boolean {
  return [
    'write_file',
    'append_file',
    'batch_edit',
    'create_dir',
    'run_command',
  ].includes(call.tool)
}
