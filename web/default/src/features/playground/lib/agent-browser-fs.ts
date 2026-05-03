import type { WorkspaceEntry } from './agent-helper'
import type { AgentBatchEdit } from './agent-tools'

type BrowserFileSystemDirectoryHandle = FileSystemDirectoryHandle & {
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>
}

export const MAX_READ_BYTES = 1024 * 1024

const MAX_SEARCH_FILES = 300
const MAX_SEARCH_RESULTS = 50
const SEARCH_READ_BYTES = 512 * 1024

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

export async function getDirectoryHandle(
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

export async function listDir(
  root: FileSystemDirectoryHandle,
  path: string,
  depth?: number
): Promise<string> {
  const dir = (await getDirectoryHandle(root, path)) as BrowserFileSystemDirectoryHandle
  const maxDepth = normalizeListDepth(depth)
  const base = normalizePath(path).join('/')
  const lines = await listDirTree(dir, base, maxDepth, 0, '')
  return lines.join('\n') || '(empty directory)'
}

function normalizeListDepth(depth?: number): number {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return 1
  return Math.max(1, Math.min(Math.floor(depth || 1), 5))
}

async function sortedDirectoryEntries(
  dir: FileSystemDirectoryHandle
): Promise<Array<[string, FileSystemHandle]>> {
  const iterator = (dir as BrowserFileSystemDirectoryHandle).entries?.()
  if (!iterator) throw new Error('directory_iteration_unavailable')
  const entries: Array<[string, FileSystemHandle]> = []
  for await (const entry of iterator) {
    entries.push(entry)
  }
  return entries.sort((a, b) => {
    if (a[1].kind !== b[1].kind) return a[1].kind === 'directory' ? -1 : 1
    return a[0].localeCompare(b[0])
  })
}

async function listDirTree(
  dir: FileSystemDirectoryHandle,
  basePath: string,
  remainingDepth: number,
  level: number,
  prefix: string
): Promise<string[]> {
  const entries = await sortedDirectoryEntries(dir)
  const visible = entries.filter(([name]) => name !== '.xkagent')
  const lines: string[] = []

  for (const [name, handle] of visible) {
    const currentPath = [basePath, name].filter(Boolean).join('/')
    const label = `${prefix}${handle.kind === 'directory' ? 'dir ' : 'file'}\t${currentPath || name}`
    lines.push(label)

    if (handle.kind !== 'directory') continue
    const childDir = handle as FileSystemDirectoryHandle
    const childEntries = await sortedDirectoryEntries(childDir)
    const childVisible = childEntries.filter(([childName]) => childName !== '.xkagent')
    const shouldCollapseSingleChild = childVisible.length === 1
    const shouldRecurse = remainingDepth > 1 || shouldCollapseSingleChild
    if (!shouldRecurse) continue

    const nextDepth = shouldCollapseSingleChild ? remainingDepth : remainingDepth - 1
    lines.push(
      ...(await listDirTree(
        childDir,
        currentPath,
        nextDepth,
        level + 1,
        `${'  '.repeat(level + 1)}`
      ))
    )
  }

  return lines
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

export async function readFile(
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

export async function searchFiles(
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

export async function writeFile(
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

export async function appendFile(
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

export async function batchEditFile(
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

export async function readWholeFile(
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
