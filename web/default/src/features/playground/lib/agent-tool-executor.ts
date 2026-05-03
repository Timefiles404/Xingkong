import {
  appendFile,
  batchEditFile,
  getDirectoryHandle,
  listDir,
  readFile,
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
} from './agent-helper'
import {
  MAX_TOOL_CALLS,
  type AgentToolCall,
  type AgentToolResult,
  type AgentToolRuntime,
} from './agent-tool-types'

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
