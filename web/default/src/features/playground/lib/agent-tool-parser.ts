import {
  MAX_TOOL_CALLS,
  SUPPORTED_TOOLS,
  type AgentBatchEdit,
  type AgentToolCall,
  type AgentToolName,
} from './agent-tool-types'

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

function isAgentToolCall(value: AgentToolCall): value is AgentToolCall {
  if (!value || !SUPPORTED_TOOLS.includes(value.tool)) return false
  if (value.tool === 'run_command') return !!value.command?.trim()
  return true
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
    calls.push({
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
    })
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

function parseOptionalInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}
