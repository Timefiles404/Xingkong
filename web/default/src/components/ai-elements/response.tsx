'use client'

import { type ReactNode, memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { CheckIcon, CopyIcon, FileIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { revealHelperWorkspacePath } from '@/features/playground/lib'

type ResponseProps = {
  className?: string
  children?: ReactNode
}

function getText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(getText).join('')
  if (children === null || children === undefined) return ''
  return String(children)
}

function compactMarkdownSpacing(input: string): string {
  return input
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part
      return part.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    })
    .join('')
}

function parseFileHref(href?: string): string | null {
  if (!href?.startsWith('file://')) return null
  try {
    return decodeURI(href.slice('file://'.length))
  } catch {
    return href.slice('file://'.length)
  }
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).pop() || normalized || '.'
}

async function handleFileReferenceClick(filePath: string) {
  try {
    await revealHelperWorkspacePath(filePath)
    return
  } catch {
    if (!navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(filePath)
    toast.success('Path copied')
  }
}

function CodeBlock({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const code = getText(children).replace(/\n$/, '')
  const language = className?.match(/language-(\S+)/)?.[1] || 'text'

  const copyCode = async () => {
    if (!navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className='my-2 overflow-hidden rounded-xl border bg-muted/30'>
      <div className='flex h-8 items-center justify-between border-b bg-muted/40 px-3 text-[11px] text-muted-foreground'>
        <span className='font-medium uppercase tracking-wide'>{language}</span>
        <Button
          className='h-6 gap-1 px-2 text-[11px]'
          onClick={copyCode}
          size='sm'
          type='button'
          variant='ghost'
        >
          {copied ? <CheckIcon className='size-3' /> : <CopyIcon className='size-3' />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className='m-0 max-h-[520px] overflow-auto p-3 text-[13px] leading-5'>
        <code className='font-mono'>{code}</code>
      </pre>
    </div>
  )
}

export const Response = memo(
  ({ className, children, ...props }: ResponseProps) => {
    const stripCustomTags = (input: unknown): unknown => {
      if (typeof input !== 'string') return input
      return (
        input
          // Remove known AI custom wrapper tags but keep inner content
          .replace(
            /<\/?(conversation|conversationcontent|reasoning|reasoningcontent|reasoningtrigger|sources|sourcescontent|sourcestrigger|branch|branchmessages|branchnext|branchpage|branchprevious|branchselector|message|messagecontent)\b[^>]*>/gi,
            ''
          )
          // Remove any stray <think> tags if they still appear
          .replace(/<\/?think\b[^>]*>/gi, '')
      )
    }

    const safeChildren = compactMarkdownSpacing(stripCustomTags(children) as string)

    return (
      <div
        className={cn(
          'size-full leading-5',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          '[&_p]:my-px [&_p:empty]:my-0 [&_p:empty]:h-0',
          '[&_br]:leading-none',
          '[&_ul]:my-1 [&_ol]:my-1 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0 [&_li]:pl-1',
          '[&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline',
          '[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
          '[&_table]:my-1.5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1',
          className
        )}
        {...props}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            a: ({ node: _node, children: linkChildren, ...linkProps }) => {
              const filePath = parseFileHref(linkProps.href)
              if (filePath) {
                return (
                  <button
                    className='mx-0.5 inline-flex max-w-full items-center gap-1 rounded-[5px] border bg-muted px-1.5 py-0.5 align-baseline text-xs font-medium text-foreground shadow-xs hover:bg-accent'
                    onClick={() => {
                      void handleFileReferenceClick(filePath)
                    }}
                    title={filePath}
                    type='button'
                  >
                    <FileIcon className='size-3 shrink-0' />
                    <span className='truncate'>
                      {getText(linkChildren) || fileNameFromPath(filePath)}
                    </span>
                  </button>
                )
              }

              return (
                <a {...linkProps} target='_blank' rel='noopener noreferrer'>
                  {linkChildren}
                </a>
              )
            },
            code: ({ className: codeClassName, children: codeChildren }) => {
              if (!codeClassName) {
                return (
                  <code className='rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]'>
                    {codeChildren}
                  </code>
                )
              }
              return (
                <CodeBlock className={codeClassName}>{codeChildren}</CodeBlock>
              )
            },
          }}
        >
          {safeChildren}
        </ReactMarkdown>
      </div>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

Response.displayName = 'Response'
