import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { lineEnding } from '../../stage-rules'
import { absoluteHref, isMarkdownPath, useBoardPath } from '../lib/base'
import { openOnceOnClick } from '../lib/open-once'
import { cn } from '../lib/utils'
import { noneMeaning } from '../lib/workflow'
import { copyLabel, useCopy } from './copyable'
import { Explained } from './tip'
import { Button } from './ui/button'

/** No line of the Markdown says None, so every paragraph is drawn as written. */
const noNoneLines: ReadonlySet<number> = new Set()

/**
 * The lines of the Markdown being drawn, counted from 1 as its own text counts
 * them, on which the word None says its section is intentionally empty.
 */
const NoneLines = React.createContext(noNoneLines)

const markdownComponents = {
  a: ({ children, href }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  img: ({ alt, src, title }) => <MarkdownImage alt={alt} src={src} title={title} />,
  // react-markdown hands every component its hast node; an element is given only its own props.
  input: ({ node: _node, ...props }) => <input {...props} disabled />,
  p: ({ node, ...props }) => <Paragraph line={node?.position?.start.line} {...props} />,
} satisfies Components

export function Markdown({ children, collapseEvidence = false, page = false, noneLines = noNoneLines }: {
  children: string
  collapseEvidence?: boolean
  /**
   * Whether the Markdown is the page itself, read down the middle of the
   * window, as an item or a file is: its code then runs the window's width.
   */
  page?: boolean
  /**
   * The lines of the Markdown, counted from 1, on which the word None says a
   * required section is intentionally empty, as the stage rules read them.
   */
  noneLines?: ReadonlySet<number>
}) {
  const evidenceMatch = collapseEvidence ? /^###\s+Evidence\s*$/imu.exec(children) : null
  const primary = evidenceMatch ? children.slice(0, evidenceMatch.index) : children
  const rest = evidenceMatch ? children.slice(evidenceMatch.index + evidenceMatch[0].length) : ''
  const evidence = evidenceMatch ? rest.trim() : null
  // The evidence is drawn as a text of its own, whose first line is its line
  // 1, so the lines named in the whole are counted again from there.
  const linesBeforeEvidence = children.slice(0, children.length - rest.trimStart().length).split(lineEnding).length - 1
  const evidenceNoneLines = React.useMemo(
    () => new Set([...noneLines].filter((line) => line > linesBeforeEvidence).map((line) => line - linesBeforeEvidence)),
    [noneLines, linesBeforeEvidence],
  )

  return (
    <div className={cn('markdown-reader', page && 'markdown-page')}>
      <NoneLines value={noneLines}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {primary}
        </ReactMarkdown>
      </NoneLines>
      {evidence ? (
        <details className="evidence-panel">
          <summary>Evidence</summary>
          <div className="pt-4">
            <NoneLines value={evidenceNoneLines}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {evidence}
              </ReactMarkdown>
            </NoneLines>
          </div>
        </details>
      ) : null}
    </div>
  )
}

/**
 * A paragraph as written, but for the word None where the stage rules read it
 * as saying its section is intentionally empty: that is drawn very dim, with
 * what it means behind it.
 */
function Paragraph({ line, children, ...props }: React.ComponentProps<'p'> & { line: number | undefined }) {
  const none = React.useContext(NoneLines)
  if (line === undefined || !none.has(line)) return <p {...props}>{children}</p>
  return (
    <p {...props}>
      <Explained meaning={noneMeaning}><span className="opacity-30">{children}</span></Explained>
    </p>
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
