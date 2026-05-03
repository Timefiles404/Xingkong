import type { AgentSettings, PlaygroundConversation } from '../types'

export interface AgentHelperStatus {
  app: string
  version: string
  os: string
  arch: string
  addr: string
  workspace: string
  shell: string
  workspace_warning?: string
  paired?: boolean
  pairing_required?: boolean
}

export interface AgentHelperDownloadTarget {
  target: string
  fileName: string
  label: string
}

export interface AgentHelperExecResponse {
  ok: boolean
  command: string
  cwd: string
  exit_code: number
  stdout: string
  stderr: string
  duration_ms: number
  error?: string
  truncated?: boolean
}

export interface AgentHelperFSResponse {
  ok: boolean
  path: string
  output?: string
  summary?: string
  entries?: WorkspaceEntry[]
  error?: string
}

export interface AgentHelperConversationState {
  conversations: PlaygroundConversation[]
  activeConversationId: string | null
  agentSettings?: AgentSettings
}

export interface WorkspaceEntry {
  name: string
  path: string
  kind: FileSystemHandleKind
}

export const AGENT_HELPER_BASE_URL = 'http://127.0.0.1:8787'

const AGENT_HELPER_PROTOCOL_URL = 'xingkong-helper://start'
const AGENT_HELPER_TOKEN_STORAGE_KEY = 'newapi.agent.helper.token'

export async function checkAgentHelperStatus(
  timeoutMs = 1500
): Promise<AgentHelperStatus | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${AGENT_HELPER_BASE_URL}/v1/status`, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) return null
    return (await response.json()) as AgentHelperStatus
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export function isAgentHelperPaired(status: AgentHelperStatus | null): boolean {
  if (!status) return false
  return !status.pairing_required || status.paired === true
}

export function getStoredAgentHelperToken(): string {
  try {
    return window.localStorage.getItem(AGENT_HELPER_TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setStoredAgentHelperToken(token: string): void {
  try {
    if (token) {
      window.localStorage.setItem(AGENT_HELPER_TOKEN_STORAGE_KEY, token)
    } else {
      window.localStorage.removeItem(AGENT_HELPER_TOKEN_STORAGE_KEY)
    }
  } catch {
    // localStorage may be blocked; command execution will request pairing again.
  }
}

export async function pairAgentHelper(code: string): Promise<void> {
  const response = await fetch(`${AGENT_HELPER_BASE_URL}/v1/pair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) {
    throw new Error(`helper_pair_http_${response.status}`)
  }
  const result = (await response.json()) as { token?: string }
  if (!result.token) throw new Error('helper_pair_token_missing')
  setStoredAgentHelperToken(result.token)
}

export async function requestWorkspaceDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options?: {
        mode?: 'read' | 'readwrite'
      }) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker

  if (!picker) {
    throw new Error('file_system_access_unavailable')
  }

  return picker({ mode: 'readwrite' })
}

export function getAgentHelperDownloadTarget(): AgentHelperDownloadTarget {
  const ua = navigator.userAgent.toLowerCase()
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform?.toLowerCase() || ''
  const source = `${platform} ${ua}`

  if (source.includes('mac') || source.includes('darwin')) {
    const isArm = source.includes('arm') || source.includes('apple')
    return {
      target: isArm ? 'darwin-arm64' : 'darwin-amd64',
      fileName: isArm
        ? 'xingkong-helper-darwin-arm64'
        : 'xingkong-helper-darwin-amd64',
      label: isArm ? 'macOS Apple Silicon' : 'macOS Intel',
    }
  }

  if (source.includes('linux')) {
    const isArm = source.includes('aarch64') || source.includes('arm64')
    return {
      target: isArm ? 'linux-arm64' : 'linux-amd64',
      fileName: isArm
        ? 'xingkong-helper-linux-arm64'
        : 'xingkong-helper-linux-amd64',
      label: isArm ? 'Linux ARM64' : 'Linux AMD64',
    }
  }

  return {
    target: 'windows-amd64',
    fileName: 'xingkong-helper-windows-amd64.exe',
    label: 'Windows AMD64',
  }
}

export async function downloadAgentHelperToWorkspace(
  root: FileSystemDirectoryHandle,
  helper: AgentHelperDownloadTarget,
  headers: Record<string, string> = {}
): Promise<string> {
  const response = await fetch(`/api/helper/download/${helper.target}`, {
    credentials: 'include',
    headers,
  })
  if (!response.ok) {
    throw new Error(`helper_download_http_${response.status}`)
  }
  const blob = await response.blob()
  if (blob.size === 0) {
    throw new Error('helper_download_empty')
  }
  const fileHandle = await root.getFileHandle(helper.fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
  return helper.fileName
}

export function launchAgentHelperProtocol(): void {
  window.location.href = AGENT_HELPER_PROTOCOL_URL
}

export function buildAgentHelperManualCommand(helperFileName: string): string {
  if (helperFileName.endsWith('.exe')) {
    return helperFileName
  }
  return `./${helperFileName}`
}

export async function helperFSRequest(
  body: Record<string, unknown>
): Promise<AgentHelperFSResponse> {
  const response = await fetch(`${AGENT_HELPER_BASE_URL}/v1/fs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xingkong-Helper-Token': getStoredAgentHelperToken(),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    if (response.status === 401) {
      setStoredAgentHelperToken('')
      throw new Error('helper_not_paired')
    }
    throw new Error(`helper_fs_http_${response.status}`)
  }

  return (await response.json()) as AgentHelperFSResponse
}

export async function listHelperWorkspaceEntries(
  path: string
): Promise<WorkspaceEntry[]> {
  const response = await helperFSRequest({
    op: 'list_dir',
    path: path || '.',
  })
  if (!response.ok) throw new Error(response.error || 'helper_list_failed')
  return response.entries || []
}

export async function loadHelperAgentConversations(): Promise<AgentHelperConversationState> {
  const response = await helperFSRequest({
    op: 'agent_history_load',
    path: '.',
  })
  if (!response.ok) throw new Error(response.error || 'helper_history_load_failed')
  try {
    const parsed = JSON.parse(response.output || '{}') as Partial<AgentHelperConversationState>
    return {
      conversations: Array.isArray(parsed.conversations)
        ? parsed.conversations.filter(Boolean)
        : [],
      activeConversationId: parsed.activeConversationId || null,
      agentSettings: parsed.agentSettings,
    }
  } catch {
    return { conversations: [], activeConversationId: null }
  }
}

export async function saveHelperAgentConversations(
  state: AgentHelperConversationState
): Promise<void> {
  const response = await helperFSRequest({
    op: 'agent_history_save',
    path: '.',
    content: JSON.stringify({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      agentSettings: state.agentSettings,
      savedAt: Date.now(),
    }),
  })
  if (!response.ok) throw new Error(response.error || 'helper_history_save_failed')
}

export async function revealHelperWorkspacePath(path: string): Promise<void> {
  const response = await helperFSRequest({
    op: 'reveal_path',
    path: path || '.',
  })
  if (!response.ok) throw new Error(response.error || 'helper_reveal_failed')
}
