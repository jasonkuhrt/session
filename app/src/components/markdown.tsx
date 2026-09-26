import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { absoluteHref, isMarkdownPath, useBoardPath } from '../lib/base'
import { openOnceOnClick } from '../lib/open-once'
import { cn } from '../lib/utils'
import { copyLabel, useCopy } from './copyable'
import { Button } from './ui/button'

const markdownComponents = {
  a: ({ children, href }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  img: ({ alt, src, title }) => <MarkdownImage alt={alt} src={src} title={title} />,
  input: (props) => <input {...props} disabled />,
} satisfies Components

export function Markdown({ children, collapseEvidence = false, page = false }: {
  children: string
  collapseEvidence?: boolean
  /**
   * Whether the Markdown is the page itself, read down the middle of the
   * window, as an item or a file is: its code then runs the window's width.
   */
  page?: boolean
}) {
  const evidenceMatch = collapseEvidence ? /^###\s+Evidence\s*$/imu.exec(children) : null
  const primary = evidenceMatch ? children.slice(0, evidenceMatch.index) : children
  const evidence = evidenceMatch ? children.slice(evidenceMatch.index + evidenceMatch[0].length).trim() : null

  return (
    <div className={cn('markdown-reader', page && 'markdown-page')}>
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

function MarkdownLink({ href, children }: { href: string | undefined; children: React.ReactNode }) {
  const [copyState, copy] = useCopy()
  const board = useBoardPath()
  if (!href) return <span>{children}</span>

  // An absolute path is a place on this machine rather than a page, so it is
  // offered for the clipboard, the way every copy on the board reports itself.
  if (href.startsWith('/') && !href.startsWith('/files/')) {
    return (
      <span className="inline-flex max-w-full items-baseline gap-2">
        <code className="break-all">{href}</code>
        <Button variant="ghost" size="xs" onClick={() => void copy(href)}>
          {copyLabel({ label: 'Copy path', state: copyState })}
        </Button>
      </span>
    )
  }

  if (/^[a-z][a-z0-9+.-]*:/iu.test(href) && !/^(https?:|mailto:)/iu.test(href)) {
    return <span>{children}</span>
  }

  if (href.startsWith('#') || /^mailto:/iu.test(href)) return <a href={href}>{children}</a>

  // Everything else opens beside the page, once: a second click brings back
  // the tab the first one opened. An address the URL parser rejects has no tab
  // to name, so the browser is left to do with it what it does with any link.
  const target = linkHref(board, href)
  const absolute = absoluteHref(target)
  return (
    <a
      href={target}
      target="_blank"
      rel="noreferrer"
      onClick={absolute === null ? undefined : openOnceOnClick(absolute)}
    >
      {children}
    </a>
  )
}

/**
 * An image drawn from the session through the files route, as a link to the
 * same file would reach it. A source the parser dropped as unsafe has nothing
 * to load, so its description stands in its place.
 */
function MarkdownImage({ alt, src, title }: { alt: string | undefined; src: string | undefined; title: string | undefined }) {
  const board = useBoardPath()
  if (!src) return <span>{alt}</span>
  return <img alt={alt ?? ''} src={fileHref(board, src)} title={title} />
}

/**
 * A path in a session's Markdown is relative to the session root, as the
 * parser hands it over, already percent-encoded. A link to a Markdown file
 * opens on the board's file page, where it is read the way an item is; any
 * other file opens as it is on disk through the files route.
 */
function linkHref(board: string, href: string) {
  if (/^https?:/iu.test(href) || href.startsWith('/files/')) return fileHref(board, href)
  const path = href.replace(/^\.\//u, '')
  const end = path.search(/[?#]/u)
  const file = end === -1 ? path : path.slice(0, end)
  return isMarkdownPath(file) ? `${board}/file/${path}` : fileHref(board, href)
}

/** Session-relative paths resolve through the board's files route. */
function fileHref(board: string, href: string) {
  if (href.startsWith('#') || /^(https?:|mailto:)/iu.test(href)) return href
  if (href.startsWith('/files/')) return `${board}${href}`
  return `${board}/files/${href.replace(/^\.\//u, '')}`
}
