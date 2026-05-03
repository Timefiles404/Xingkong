import { MAX_READ_BYTES, readWholeFile } from './agent-browser-fs'
import { helperFSRequest, isAgentHelperPaired } from './agent-helper'
import {
  MAX_TOOL_CALLS,
  requiresAgentToolApproval,
  type AgentBatchEdit,
  type AgentToolCall,
  type AgentToolResult,
  type AgentToolRuntime,
} from './agent-tool-types'

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

function describeWriteIntent(call: AgentToolCall): string {
  if (call.tool === 'write_file') return 'overwrite file'
  if (call.tool === 'append_file') return 'append content'
  if (call.tool === 'batch_edit') return `${call.edits?.length || 0} edits`
  if (call.tool === 'create_dir') return 'create directory'
  if (call.tool === 'run_command') return `run command: ${call.command || ''}`
  return 'ready to run'
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
