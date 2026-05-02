export type AgentToolName =
  | 'list_dir'
  | 'read_file'
  | 'search_files'
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

export interface AgentHelperStatus {
  app: string
  version: string
  os: string
  arch: string
  addr: string
  workspace: string
  shell: string
  workspace_warning?: string
}

export interface AgentHelperDownloadTarget {
  target: string
  fileName: string
  label: string
}

interface AgentHelperExecResponse {
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

type BrowserFileSystemDirectoryHandle = FileSystemDirectoryHandle & {
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>
}

export interface WorkspaceEntry {
  name: string
  path: string
  kind: FileSystemHandleKind
}

const MAX_READ_BYTES = 1024 * 1024
const MAX_TOOL_CALLS = 8
const MAX_SEARCH_FILES = 300
const MAX_SEARCH_RESULTS = 50
const SEARCH_READ_BYTES = 512 * 1024
const AGENT_HELPER_BASE_URL = 'http://127.0.0.1:8787'
const AGENT_HELPER_PROTOCOL_URL = 'xingkong-helper://start'

const SUPPORTED_TOOLS: AgentToolName[] = [
  'list_dir',
  'read_file',
  'search_files',
  'write_file',
  'append_file',
  'batch_edit',
  'create_dir',
  'run_command',
]

export const AGENT_SYSTEM_PROMPT = `你是运行在浏览器网页端的 Agent。你不能访问服务器文件系统；你只能通过用户已授权的本地工作目录使用文件工具。若本地 helper 已启动，你还可以在用户审批后调用本地命令行工具。

回答风格:
- 直接、务实、像资深工程师一样给结论和关键依据。
- 默认用短段落或简短列表，避免寒暄、套话和自我说明。
- 非必要不要频繁分段；不要连续输出多个空行；不要为了“显得清晰”把每句话都单独成段。
- 简单结果用 1-2 段说明即可；复杂结果最多使用少量扁平项目符号。
- 如果正在使用工具，工具块之外只保留对用户有价值的进度或结论。
- 当你提到工作区内文件时，优先使用 Markdown 文件引用: [文件名](file://相对路径)，不要使用绝对路径。

可用工具:
- list_dir: 列出目录。
- read_file: 读取文本文件。默认读取前 100 行；可用 start/end 指定 1 起始闭区间。
- search_files: 在目录内搜索文本。
- write_file: 覆盖写入文本文件。
- append_file: 追加文本。
- batch_edit: 对同一文件执行多处精确替换。
- create_dir: 创建目录。
- run_command: 通过本地 helper 在用户电脑的 helper 工作目录里执行终端命令，需要用户审批；必须提供非空 command 参数，cwd 只表示命令运行目录。

路径必须使用相对路径，不能使用绝对路径或 ..。
需要使用工具时，优先输出 XML 工具块，不要夹杂解释:
<agent_tools>
  <tool name="list_dir"><path>.</path></tool>
  <tool name="read_file"><path>src/app.ts</path><start>1</start><end>80</end></tool>
  <tool name="search_files"><path>.</path><query>TODO</query><maxResults>20</maxResults></tool>
  <tool name="batch_edit"><path>README.md</path><edit><find>old</find><replace>new</replace></edit></tool>
  <tool name="run_command"><cwd>.</cwd><command>npm test</command><timeoutMs>120000</timeoutMs></tool>
</agent_tools>

列出目录优先使用 list_dir；如果用户明确要求用命令行列目录，Windows 使用 <command>dir</command>，macOS/Linux 使用 <command>ls -la</command>。不要把命令写进 path 或 cwd。

如果模型只能稳定输出 JSON，也可以退回:
\`\`\`agent_tools
[{"tool":"list_dir","path":"."}]
\`\`\`
收到工具执行结果后，再继续分析或给出下一组工具调用。任务完成时直接给用户自然语言答复。`

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

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

export function parseAgentToolCalls(content: string): AgentToolCall[] {
  const xmlCalls = parseXmlAgentToolCalls(content)
  if (xmlCalls.length > 0) return xmlCalls

  const blocks = [
    ...content.matchAll(/```agent_tools\s*([\s\S]*?)```/gi),
    ...content.matchAll(/<agent_tools>([\s\S]*?)<\/agent_tools>/gi),
  ]

  for (const block of blocks) {
    const raw = block[1]?.trim()
    if (!raw) continue

    try {
      const parsed = JSON.parse(raw) as AgentToolCall[] | { calls?: AgentToolCall[] }
      const calls = Array.isArray(parsed) ? parsed : parsed.calls
      if (!Array.isArray(calls)) continue
      return calls.slice(0, MAX_TOOL_CALLS).filter(isAgentToolCall)
    } catch {
      continue
    }
  }

  return []
}

export function stripAgentToolBlocks(content: string): string {
  return content
    .replace(/<agent_tools>[\s\S]*?<\/agent_tools>/gi, '')
    .replace(/```agent_tools\s*[\s\S]*?```/gi, '')
    .trim()
}

export function getCompleteAgentToolBlockEnd(content: string): number | null {
  const matches = [
    /<agent_tools\b[\s\S]*?<\/agent_tools>/i.exec(content),
    /```agent_tools\s*[\s\S]*?```/i.exec(content),
  ].filter((match): match is RegExpExecArray => !!match)

  if (matches.length === 0) return null

  const firstMatch = matches.sort((a, b) => a.index - b.index)[0]
  return firstMatch.index + firstMatch[0].length
}

export function getVisibleAgentContent(content: string): string {
  const stripped = stripAgentToolBlocks(content)
  const xmlStart = stripped.search(/<agent_tools\b/i)
  const jsonStart = stripped.search(/```agent_tools/i)
  const starts = [xmlStart, jsonStart].filter((index) => index >= 0)
  if (starts.length === 0) return stripped
  return stripped.slice(0, Math.min(...starts)).trim()
}

export async function executeAgentToolCalls(
  root: FileSystemDirectoryHandle,
  calls: AgentToolCall[]
): Promise<AgentToolResult[]> {
  const results: AgentToolResult[] = []

  for (const call of calls.slice(0, MAX_TOOL_CALLS)) {
    results.push(await executeAgentToolCall(root, call))
  }

  return results
}

export async function buildAgentToolReviewResults(
  root: FileSystemDirectoryHandle,
  calls: AgentToolCall[]
): Promise<AgentToolResult[]> {
  return Promise.all(
    calls.slice(0, MAX_TOOL_CALLS).map(async (call) => {
      const path =
        call.tool === 'run_command'
          ? call.cwd?.trim() || '.'
          : call.path?.trim() || '.'
      const needsApproval = requiresAgentToolApproval(call)

      if (!needsApproval) {
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          summary: 'ready to run',
        }
      }

      try {
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: false,
          summary: describeWriteIntent(call),
          diff: await buildToolDiff(root, call),
        }
      } catch (error) {
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: false,
          summary: describeWriteIntent(call),
          diff: buildCreateDiff('', call.content || ''),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
  )
}

export function requiresAgentToolApproval(call: AgentToolCall): boolean {
  return [
    'write_file',
    'append_file',
    'batch_edit',
    'create_dir',
    'run_command',
  ].includes(call.tool)
}

export function formatAgentToolResults(results: AgentToolResult[]): string {
  return [
    '<agent_tool_results>',
    ...results.map(formatAgentToolResultXml),
    '</agent_tool_results>',
  ].join('\n')
}

function isAgentToolCall(value: AgentToolCall): value is AgentToolCall {
  if (!value || !SUPPORTED_TOOLS.includes(value.tool)) return false
  if (value.tool === 'run_command') return !!value.command?.trim()
  return true
}

async function executeAgentToolCall(
  root: FileSystemDirectoryHandle,
  call: AgentToolCall
): Promise<AgentToolResult> {
  const path =
    call.tool === 'run_command'
      ? call.cwd?.trim() || '.'
      : call.path?.trim() || '.'

  try {
    switch (call.tool) {
      case 'list_dir':
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          output: await listDir(root, path),
        }
      case 'read_file':
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          output: await readFile(root, path, {
            maxBytes: call.maxBytes,
            start: call.start,
            end: call.end,
          }),
          summary:
            call.start || call.end
              ? `lines ${call.start || 1}-${call.end || call.start || 100}`
              : 'first 100 lines read',
        }
      case 'search_files': {
        const searchResult = await searchFiles(root, path, call.query || '', {
          maxResults: call.maxResults,
        })
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          output: searchResult.output,
          summary: searchResult.summary,
        }
      }
      case 'write_file':
        await writeFile(root, path, call.content || '')
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          summary: `${(call.content || '').length} chars written`,
          output: 'written',
        }
      case 'append_file':
        await appendFile(root, path, call.content || '')
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          summary: `${(call.content || '').length} chars appended`,
          output: 'appended',
        }
      case 'batch_edit': {
        const editResult = await batchEditFile(root, path, call.edits || [])
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          summary: editResult.summary,
          output: editResult.output,
        }
      }
      case 'create_dir':
        await getDirectoryHandle(root, path, true)
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          summary: 'directory created',
          output: 'created',
        }
      case 'run_command':
        return await runLocalCommand(call)
      default:
        throw new Error('unsupported_tool')
    }
  } catch (error) {
    return {
      id: call.id,
      tool: call.tool,
      path,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseXmlAgentToolCalls(content: string): AgentToolCall[] {
  const match = content.match(/<agent_tools>([\s\S]*?)<\/agent_tools>/i)
  if (!match?.[1]) return []

  const calls: AgentToolCall[] = []
  const toolBlocks = match[1].matchAll(
    /<tool\b([^>]*)>([\s\S]*?)<\/tool>|<tool\b([^>]*)\/>/gi
  )

  for (const block of toolBlocks) {
    const attrs = block[1] || block[3] || ''
    const body = block[2] || ''
    const tool = getXmlAttr(attrs, 'name') as AgentToolName
    if (!SUPPORTED_TOOLS.includes(tool)) continue

    const inlineText = getXmlInlineText(body)
    const call: AgentToolCall = {
      id: getXmlAttr(attrs, 'id') || undefined,
      tool,
      path: getXmlTag(body, 'path') || getXmlAttr(attrs, 'path') || '.',
      cwd: getXmlTag(body, 'cwd') || getXmlAttr(attrs, 'cwd') || undefined,
      command:
        getXmlTag(body, 'command') ||
        getXmlAttr(attrs, 'command') ||
        (tool === 'run_command' && inlineText !== '.' ? inlineText : undefined),
      content: getXmlTag(body, 'content') || undefined,
      query: getXmlTag(body, 'query') || undefined,
      start: parseOptionalInt(getXmlTag(body, 'start')),
      end: parseOptionalInt(getXmlTag(body, 'end')),
      maxBytes: parseOptionalInt(getXmlTag(body, 'maxBytes')),
      maxResults: parseOptionalInt(getXmlTag(body, 'maxResults')),
      timeoutMs:
        parseOptionalInt(getXmlTag(body, 'timeoutMs')) ||
        parseOptionalInt(getXmlTag(body, 'timeout_ms')),
      edits: parseXmlEdits(body),
    }
    calls.push(call)
  }

  return calls.slice(0, MAX_TOOL_CALLS)
}

async function runLocalCommand(call: AgentToolCall): Promise<AgentToolResult> {
  const command = call.command?.trim()
  const cwd = call.cwd?.trim() || '.'

  if (!command) {
    throw new Error('command_required: run_command 需要非空 command 参数')
  }

  const response = await fetch(`${AGENT_HELPER_BASE_URL}/v1/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      command,
      cwd,
      timeout_ms: call.timeoutMs || 120000,
    }),
  })

  if (!response.ok) {
    throw new Error(`helper_http_${response.status}`)
  }

  const result = (await response.json()) as AgentHelperExecResponse
  const output = [
    result.stdout ? `stdout:\n${result.stdout}` : '',
    result.stderr ? `stderr:\n${result.stderr}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim()

  return {
    id: call.id,
    tool: call.tool,
    path: cwd,
    ok: result.ok,
    summary: `exit ${result.exit_code}, ${result.duration_ms}ms`,
    output: output || '(no output)',
    error: result.ok ? undefined : result.error || `exit ${result.exit_code}`,
  }
}

function parseXmlEdits(body: string): AgentBatchEdit[] {
  const edits: AgentBatchEdit[] = []
  for (const match of body.matchAll(/<edit>([\s\S]*?)<\/edit>/gi)) {
    const editBody = match[1] || ''
    const find = getXmlTag(editBody, 'find')
    const replace = getXmlTag(editBody, 'replace')
    if (find) edits.push({ find, replace })
  }
  return edits
}

function getXmlTag(body: string, tag: string): string {
  const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return decodeXml(match?.[1]?.trim() || '')
}

function getXmlInlineText(body: string): string {
  const trimmed = body.trim()
  if (!trimmed || /<\w+[\s>]/.test(trimmed)) return ''
  return decodeXml(trimmed)
}

function getXmlAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
  return decodeXml(match?.[1] || '')
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function parseOptionalInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatAgentToolResultXml(result: AgentToolResult): string {
  return [
    `<result tool="${escapeXml(result.tool)}" path="${escapeXml(
      result.path
    )}" ok="${result.ok ? 'true' : 'false'}">`,
    result.summary ? `<summary>${escapeXml(result.summary)}</summary>` : '',
    result.output ? `<output><![CDATA[${result.output}]]></output>` : '',
    result.error ? `<error>${escapeXml(result.error)}</error>` : '',
    '</result>',
  ]
    .filter(Boolean)
    .join('')
}

export function getFileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).pop() || normalized || '.'
}

export function formatFileReference(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  return `[${getFileNameFromPath(normalized)}](file://${encodeURI(normalized)})`
}

export function parseFileReferenceHref(href?: string): string | null {
  if (!href?.startsWith('file://')) return null
  try {
    return decodeURI(href.slice('file://'.length))
  } catch {
    return href.slice('file://'.length)
  }
}

function normalizePath(path: string): string[] {
  const normalized = path.replace(/\\/g, '/').trim()
  if (!normalized || normalized === '.') return []
  if (normalized.startsWith('/')) throw new Error('absolute_path_not_allowed')

  const parts = normalized.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('path_traversal_not_allowed')
  }

  return parts
}

async function getDirectoryHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false
): Promise<FileSystemDirectoryHandle> {
  const parts = normalizePath(path)
  let current = root

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create })
  }

  return current
}

async function getParentDirectoryAndName(
  root: FileSystemDirectoryHandle,
  path: string,
  createParent = false
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = normalizePath(path)
  const name = parts.pop()
  if (!name) throw new Error('file_path_required')

  let dir = root
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: createParent })
  }

  return { dir, name }
}

async function listDir(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const dir = (await getDirectoryHandle(root, path)) as BrowserFileSystemDirectoryHandle
  const entries: string[] = []
  const iterator = dir.entries?.()

  if (!iterator) throw new Error('directory_iteration_unavailable')

  for await (const [name, handle] of iterator) {
    entries.push(`${handle.kind === 'directory' ? 'dir ' : 'file'}\t${name}`)
  }

  return entries.sort().join('\n') || '(empty directory)'
}

export async function listWorkspaceEntries(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<WorkspaceEntry[]> {
  const dir = (await getDirectoryHandle(
    root,
    path || '.'
  )) as BrowserFileSystemDirectoryHandle
  const iterator = dir.entries?.()
  if (!iterator) throw new Error('directory_iteration_unavailable')

  const entries: WorkspaceEntry[] = []
  const base = normalizePath(path || '.').join('/')

  for await (const [name, handle] of iterator) {
    const currentPath = [base, name].filter(Boolean).join('/')
    entries.push({
      name,
      path: currentPath,
      kind: handle.kind,
    })
  }

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function readFile(
  root: FileSystemDirectoryHandle,
  path: string,
  options: { maxBytes?: number; start?: number; end?: number } = {}
): Promise<string> {
  const { dir, name } = await getParentDirectoryAndName(root, path)
  const fileHandle = await dir.getFileHandle(name)
  const file = await fileHandle.getFile()
  const maxBytes = options.maxBytes || MAX_READ_BYTES
  const readLimit = Math.max(1, Math.min(maxBytes || MAX_READ_BYTES, MAX_READ_BYTES))
  const blob = file.size > readLimit ? file.slice(0, readLimit) : file
  const text = await blob.text()
  const lines = text.split(/\r?\n/)
  const start = Math.max(1, options.start || 1)
  const end = Math.max(start, Math.min(options.end || start + 99, lines.length))
  const selected = lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}: ${line}`)
    .join('\n')

  if (file.size > readLimit) {
    return `${selected}\n\n[truncated: ${readLimit}/${file.size} bytes]`
  }

  if (end < lines.length) return `${selected}\n\n[truncated: ${end}/${lines.length} lines]`
  return selected
}

async function searchFiles(
  root: FileSystemDirectoryHandle,
  path: string,
  query: string,
  options: { maxResults?: number } = {}
): Promise<{ output: string; summary: string }> {
  if (!query.trim()) throw new Error('search_query_required')

  const baseDir = await getDirectoryHandle(root, path)
  const maxResults = Math.max(
    1,
    Math.min(options.maxResults || 20, MAX_SEARCH_RESULTS)
  )
  const results: string[] = []
  let scannedFiles = 0

  await walkDirectory(baseDir, normalizePath(path).join('/'), async (filePath, file) => {
    if (results.length >= maxResults || scannedFiles >= MAX_SEARCH_FILES) return
    scannedFiles += 1
    if (file.size > SEARCH_READ_BYTES || !isSearchableFile(file.name)) return

    const text = await file.text()
    const lines = text.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (results.length >= maxResults) return
      if (line.toLowerCase().includes(query.toLowerCase())) {
        results.push(`${filePath}:${index + 1}: ${line.trim()}`)
      }
    })
  })

  return {
    output: results.join('\n') || 'no matches',
    summary: `${results.length} matches in ${scannedFiles} scanned files`,
  }
}

async function walkDirectory(
  dir: FileSystemDirectoryHandle,
  basePath: string,
  onFile: (path: string, file: File) => Promise<void>
): Promise<void> {
  const iterator = (dir as BrowserFileSystemDirectoryHandle).entries?.()
  if (!iterator) throw new Error('directory_iteration_unavailable')

  for await (const [name, handle] of iterator) {
    const currentPath = [basePath, name].filter(Boolean).join('/')
    if (handle.kind === 'directory') {
      await walkDirectory(handle as FileSystemDirectoryHandle, currentPath, onFile)
      continue
    }
    const file = await (handle as FileSystemFileHandle).getFile()
    await onFile(currentPath, file)
  }
}

function isSearchableFile(name: string): boolean {
  return /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|xml|html?|css|scss|js|jsx|ts|tsx|py|go|java|c|cpp|h|hpp|rs|sh|sql|log|toml|ini|env)$/i.test(
    name
  )
}

async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  content: string
): Promise<void> {
  const { dir, name } = await getParentDirectoryAndName(root, path, true)
  const fileHandle = await dir.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

async function appendFile(
  root: FileSystemDirectoryHandle,
  path: string,
  content: string
): Promise<void> {
  const { dir, name } = await getParentDirectoryAndName(root, path, true)
  const fileHandle = await dir.getFileHandle(name, { create: true })
  const file = await fileHandle.getFile()
  const writable = await fileHandle.createWritable({ keepExistingData: true })
  await writable.seek(file.size)
  await writable.write(content)
  await writable.close()
}

async function batchEditFile(
  root: FileSystemDirectoryHandle,
  path: string,
  edits: AgentBatchEdit[]
): Promise<{ output: string; summary: string }> {
  if (edits.length === 0) throw new Error('batch_edit_requires_edits')

  let content = await readWholeFile(root, path)
  const applied: string[] = []

  edits.forEach((edit, index) => {
    if (!edit.find) return
    if (!content.includes(edit.find)) {
      applied.push(`#${index + 1}: not found`)
      return
    }
    content = content.replace(edit.find, edit.replace)
    applied.push(`#${index + 1}: applied`)
  })

  await writeFile(root, path, content)

  return {
    output: applied.join('\n'),
    summary: `${applied.filter((item) => item.includes('applied')).length}/${
      edits.length
    } edits applied`,
  }
}

async function buildToolDiff(
  root: FileSystemDirectoryHandle,
  call: AgentToolCall
): Promise<string> {
  const path = call.path?.trim() || '.'

  if (call.tool === 'run_command') {
    return `$ cd ${call.cwd?.trim() || '.'}\n$ ${call.command || ''}`
  }

  if (call.tool === 'create_dir') {
    return `+ directory ${path}`
  }

  if (call.tool === 'append_file') {
    const oldContent = await readWholeFileIfExists(root, path)
    const nextContent = `${oldContent}${call.content || ''}`
    return buildLineDiff(oldContent, nextContent)
  }

  if (call.tool === 'write_file') {
    const oldContent = await readWholeFileIfExists(root, path)
    return buildLineDiff(oldContent, call.content || '')
  }

  if (call.tool === 'batch_edit') {
    const oldContent = await readWholeFile(root, path)
    const nextContent = applyBatchEditsPreview(oldContent, call.edits || [])
    return buildLineDiff(oldContent, nextContent)
  }

  return ''
}

function describeWriteIntent(call: AgentToolCall): string {
  if (call.tool === 'write_file') return 'overwrite file'
  if (call.tool === 'append_file') return 'append content'
  if (call.tool === 'batch_edit') return `${call.edits?.length || 0} edits`
  if (call.tool === 'create_dir') return 'create directory'
  if (call.tool === 'run_command') return `run command: ${call.command || ''}`
  return 'ready to run'
}

function applyBatchEditsPreview(
  content: string,
  edits: AgentBatchEdit[]
): string {
  let next = content
  edits.forEach((edit) => {
    if (!edit.find) return
    next = next.replace(edit.find, edit.replace)
  })
  return next
}

async function readWholeFileIfExists(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<string> {
  try {
    return await readWholeFile(root, path)
  } catch {
    return ''
  }
}

function buildCreateDiff(_oldContent: string, nextContent: string): string {
  return nextContent
    .split(/\r?\n/)
    .map((line) => `+ ${line}`)
    .join('\n')
}

function buildLineDiff(oldContent: string, nextContent: string): string {
  const oldLines = oldContent.split(/\r?\n/)
  const nextLines = nextContent.split(/\r?\n/)
  const matrix = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(nextLines.length + 1).fill(0)
  )

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = nextLines.length - 1; j >= 0; j -= 1) {
      matrix[i][j] =
        oldLines[i] === nextLines[j]
          ? matrix[i + 1][j + 1] + 1
          : Math.max(matrix[i + 1][j], matrix[i][j + 1])
    }
  }

  const lines: string[] = []
  let i = 0
  let j = 0

  while (i < oldLines.length && j < nextLines.length) {
    if (oldLines[i] === nextLines[j]) {
      lines.push(`  ${oldLines[i]}`)
      i += 1
      j += 1
    } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      lines.push(`- ${oldLines[i]}`)
      i += 1
    } else {
      lines.push(`+ ${nextLines[j]}`)
      j += 1
    }
  }

  while (i < oldLines.length) {
    lines.push(`- ${oldLines[i]}`)
    i += 1
  }
  while (j < nextLines.length) {
    lines.push(`+ ${nextLines[j]}`)
    j += 1
  }

  return lines.join('\n')
}

async function readWholeFile(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<string> {
  const { dir, name } = await getParentDirectoryAndName(root, path)
  const fileHandle = await dir.getFileHandle(name)
  const file = await fileHandle.getFile()
  if (file.size > MAX_READ_BYTES) {
    throw new Error('file_too_large_for_batch_edit')
  }
  return file.text()
}
