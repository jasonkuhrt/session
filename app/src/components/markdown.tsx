import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from './ui/button'

const markdownComponents = {
  a: ({ children, href }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  input: (props) => <input {...props} disabled />,
} satisfies Components

export function Markdown({ children, collapseEvidence = false }: { children: string; collapseEvidence?: boolean }) {
  const evidenceMatch = collapseEvidence ? /^###\s+Evidence\s*$/imu.exec(children) : null
  const primary = evidenceMatch ? children.slice(0, evidenceMatch.index) : children
  const evidence = evidenceMatch ? children.slice(evidenceMatch.index + evidenceMatch[0].length).trim() : null

  return (
    <div className="markdown-reader">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {primary}
      </ReactMarkdown>
      {evidence ? (
        <details className="evidence-panel">
          <summary>Evidence</summary>
          <div className="pt-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {evidence}
            </ReactMarkdown>
          </div>
        </details>
      ) : null}
    </div>
  )
}

export function MarkdownLink({ href, children }: { href: string | undefined; children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false)
  if (!href) return <span>{children}</span>

  if (href.startsWith('/') && !href.startsWith('/files/')) {
    return (
      <span className="inline-flex max-w-full items-baseline gap-2">
        <code className="break-all">{href}</code>
        <Button
          variant="ghost"
          size="xs"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(href)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1_500)
            } catch {
              setCopied(false)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy path'}
        </Button>
      </span>
    )
  }

  if (/^[a-z][a-z0-9+.-]*:/iu.test(href) && !/^(https?:|mailto:)/iu.test(href)) {
    return <span>{children}</span>
  }

  const target =
    href.startsWith('#') || href.startsWith('/files/') || /^(https?:|mailto:)/iu.test(href)
      ? href
      : `/files/${href.replace(/^\.\//u, '')}`

  return (
    <a href={target} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">
      {children}
    </a>
  )
}
