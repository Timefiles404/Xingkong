import type { AgentToolResult } from './agent-tool-types'

export function formatAgentToolResults(results: AgentToolResult[]): string {
  return [
    '<agent_tool_results>',
    ...results.map(formatAgentToolResultXml),
    '</agent_tool_results>',
  ].join('\n')
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
