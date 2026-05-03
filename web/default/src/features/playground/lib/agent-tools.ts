import {
  appendFile,
  batchEditFile,
  getDirectoryHandle,
  listDir,
  MAX_READ_BYTES,
  readFile,
  readWholeFile,
  searchFiles,
  writeFile,
} from './agent-browser-fs'
import {
  AGENT_HELPER_BASE_URL,
  getStoredAgentHelperToken,
  helperFSRequest,
  isAgentHelperPaired,
  setStoredAgentHelperToken,
  type AgentHelperExecResponse,
  type AgentHelperStatus,
} from './agent-helper'

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

const MAX_TOOL_CALLS = 30

const SUPPORTED_TOOLS: AgentToolName[] = [
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

export const AGENT_SYSTEM_PROMPT = `你是运行在网页端的 Agent。你不能访问服务器文件系统；你只能通过用户已授权的本地工作目录使用文件工具。若本地 helper 已连接，文件工具和命令行工具都会在 helper 工作目录内执行；否则文件工具使用浏览器目录授权。

回答风格:
- 直接、务实、像资深工程师一样给结论和关键依据。
- 默认用短段落或简短列表，避免寒暄、套话和自我说明。
- 非必要不要频繁分段；不要连续输出多个空行；不要为了“显得清晰”把每句话都单独成段。
- 简单结果用 1-2 段说明即可；复杂结果最多使用少量扁平项目符号。
- 如果正在使用工具，工具块之外只保留对用户有价值的进度或结论。
- 当你提到工作区内文件时，优先使用 Markdown 文件引用: [文件名](file://相对路径)，不要使用绝对路径。

可用工具:
- list_dir: 列出目录。可用 depth 指定递归层数；若某个目录下只有一个子项，会继续向下展开且不消耗递归层数。
- read_file: 读取文本文件。默认读取前 100 行；可用 start/end 指定 1 起始闭区间。
- search_files: 在目录内搜索文本。
- grep: search_files 的更直接别名，用于按关键字快速定位文件行。
- write_file: 覆盖写入文本文件。
- append_file: 追加文本。
- batch_edit: 对同一文件执行多处精确替换。
- create_dir: 创建目录。
- run_command: 通过本地 helper 在用户电脑的 helper 工作目录里执行终端命令，需要用户审批；必须提供非空 command 参数，cwd 只表示命令运行目录。

路径必须使用相对路径，不能使用绝对路径或 ..。
需要使用工具时，优先输出 XML 工具块，不要夹杂解释:
<agent_tools>
  <tool name="list_dir"><path>.</path><depth>2</depth></tool>
  <tool name="read_file"><path>src/app.ts</path><start>1</start><end>80</end></tool>
  <tool name="search_files"><path>.</path><query>TODO</query><maxResults>20</maxResults></tool>
  <tool name="grep"><path>.</path><query>TODO</query><maxResults>20</maxResults></tool>
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
    .replace(/<agent_tools\b[\s\S]*$/gi, '')
    .replace(/```agent_tools\s*[\s\S]*?```/gi, '')
    .trim()
}

export function getCompleteAgentToolBlockEnd(content: string): number | null {
  const matches = [
    /<agent_tools\b[\s\S]*?<\/agent_tools>/i.exec(content),
    /<agent_tools\b[\s\S]*?<\/agent_tools\s*$/i.exec(content),
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
  runtime: AgentToolRuntime,
  calls: AgentToolCall[]
): Promise<AgentToolResult[]> {
  const results: AgentToolResult[] = []

  for (const call of calls.slice(0, MAX_TOOL_CALLS)) {
    results.push(await executeAgentToolCall(runtime, call))
  }

  return results
}

export async function buildAgentToolReviewResults(
  runtime: AgentToolRuntime,
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
          diff: await buildToolDiff(runtime, call),
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
  runtime: AgentToolRuntime,
  call: AgentToolCall
): Promise<AgentToolResult> {
  const path =
    call.tool === 'run_command'
      ? call.cwd?.trim() || '.'
      : call.path?.trim() || '.'

  try {
    if (isAgentHelperPaired(runtime.helper)) {
      return await executeHelperToolCall(call)
    }
    if (!runtime.root) throw new Error('workspace_required')

    switch (call.tool) {
      case 'list_dir':
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          output: await listDir(runtime.root, path, call.depth),
        }
      case 'read_file':
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          output: await readFile(runtime.root, path, {
            maxBytes: call.maxBytes,
            start: call.start,
            end: call.end,
          }),
          summary:
            call.start || call.end
              ? `lines ${call.start || 1}-${call.end || call.start || 100}`
              : 'first 100 lines read',
        }
      case 'search_files':
      case 'grep': {
        const searchResult = await searchFiles(runtime.root, path, call.query || '', {
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
        await writeFile(runtime.root, path, call.content || '')
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          summary: `${(call.content || '').length} chars written`,
          output: 'written',
        }
      case 'append_file':
        await appendFile(runtime.root, path, call.content || '')
        return {
          id: call.id,
          tool: call.tool,
          path,
          ok: true,
          summary: `${(call.content || '').length} chars appended`,
          output: 'appended',
        }
      case 'batch_edit': {
        const editResult = await batchEditFile(runtime.root, path, call.edits || [])
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
        await getDirectoryHandle(runtime.root, path, true)
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
  const body = extractAgentToolsXmlBody(content)
  if (!body) return []

  const calls: AgentToolCall[] = []
  const toolBlocks = body.matchAll(
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
      depth: parseOptionalInt(getXmlTag(body, 'depth')),
      timeoutMs:
        parseOptionalInt(getXmlTag(body, 'timeoutMs')) ||
        parseOptionalInt(getXmlTag(body, 'timeout_ms')),
      edits: parseXmlEdits(body),
    }
    calls.push(call)
  }

  return calls.slice(0, MAX_TOOL_CALLS)
}

function extractAgentToolsXmlBody(content: string): string {
  const full = content.match(/<agent_tools\b[^>]*>([\s\S]*?)<\/agent_tools>/i)
  if (full?.[1]) return full[1]

  const start = content.match(/<agent_tools\b[^>]*>/i)
  if (!start || start.index === undefined) return ''

  const afterStart = content.slice(start.index + start[0].length)
  const incompleteCloseIndex = afterStart.search(/<\/agent_tools\s*$/i)
  if (incompleteCloseIndex >= 0) {
    return afterStart.slice(0, incompleteCloseIndex)
  }

  const lastToolClose = afterStart.lastIndexOf('</tool>')
  if (lastToolClose >= 0) {
    return afterStart.slice(0, lastToolClose + '</tool>'.length)
  }

  return ''
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
      'X-Xingkong-Helper-Token': getStoredAgentHelperToken(),
    },
    body: JSON.stringify({
      command,
      cwd,
      timeout_ms: call.timeoutMs || 120000,
    }),
  })

  if (!response.ok) {
    if (response.status === 401) {
      setStoredAgentHelperToken('')
      throw new Error('helper_not_paired')
    }
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

async function executeHelperToolCall(call: AgentToolCall): Promise<AgentToolResult> {
  if (call.tool === 'run_command') return await runLocalCommand(call)

  const path = call.path?.trim() || '.'
  const response = await helperFSRequest({
    op: call.tool,
    path,
    content: call.content || '',
    query: call.query || '',
    start: call.start,
    end: call.end,
    max_bytes: call.maxBytes,
    max_results: call.maxResults,
    depth: call.depth,
    edits: call.edits,
  })

  return {
    id: call.id,
    tool: call.tool,
    path,
    ok: response.ok,
    summary: response.summary,
    output: response.output,
    error: response.ok ? undefined : response.error || 'helper_fs_failed',
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

async function buildToolDiff(
  runtime: AgentToolRuntime,
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
    const oldContent = await readWholeFileIfExists(runtime, path)
    const nextContent = `${oldContent}${call.content || ''}`
    return buildLineDiff(oldContent, nextContent)
  }

  if (call.tool === 'write_file') {
    const oldContent = await readWholeFileIfExists(runtime, path)
    return buildLineDiff(oldContent, call.content || '')
  }

  if (call.tool === 'batch_edit') {
    const oldContent = await readWholeFileFromRuntime(runtime, path)
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
  runtime: AgentToolRuntime,
  path: string
): Promise<string> {
  try {
    return await readWholeFileFromRuntime(runtime, path)
  } catch {
    return ''
  }
}

async function readWholeFileFromRuntime(
  runtime: AgentToolRuntime,
  path: string
): Promise<string> {
  if (isAgentHelperPaired(runtime.helper)) {
    const response = await helperFSRequest({
      op: 'read_file',
      path,
      whole: true,
      max_bytes: MAX_READ_BYTES,
    })
    if (!response.ok) throw new Error(response.error || 'helper_read_failed')
    return response.output || ''
  }
  if (!runtime.root) throw new Error('workspace_required')
  return readWholeFile(runtime.root, path)
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
