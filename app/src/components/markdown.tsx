import { PreviewCard } from '@base-ui/react/preview-card'
import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { absoluteHref, isMarkdownPath, useBoardPath } from '../lib/base'
import { openOnceOnClick } from '../lib/open-once'
import { type Glossary, glossaryOf, remarkTerms } from '../lib/terms'
import { cn } from '../lib/utils'
import { copyLabel, useCopy } from './copyable'
import { useTip } from './tip'
import { Button } from './ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'

const markdownComponents = {
  a: ({ children, href }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  img: ({ alt, src, title }) => <MarkdownImage alt={alt} src={src} title={title} />,
  // The syntax tree react-markdown passes along is not an attribute of the box it draws.
  input: ({ node: _node, ...props }) => <input {...props} disabled />,
  // Markdown draws no span of its own: each is a reference the terms plugin marked with the term it names.
  span: ({ children, node }) => <TermReference term={node?.properties['dataTerm']}>{children}</TermReference>,
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
  // The terms are the whole document's, so a reference finds its term on either side of the Evidence heading.
  const glossary = React.useMemo(() => glossaryOf(children), [children])
  const evidenceMatch = collapseEvidence ? /^###\s+Evidence\s*$/imu.exec(children) : null
  const primary = evidenceMatch ? children.slice(0, evidenceMatch.index) : children
  const afterHeading = evidenceMatch ? children.slice(evidenceMatch.index + evidenceMatch[0].length) : ''
  const evidence = evidenceMatch ? afterHeading.trim() : null
  // Where the Evidence's text starts in the document, by which the terms plugin knows a row the glossary names.
  const evidenceAt = children.length - afterHeading.trimStart().length

  const reader = (
    <div className={cn('markdown-reader', page && 'markdown-page')}>
      <MarkdownPart glossary={glossary} offset={0}>{primary}</MarkdownPart>
      {evidence ? (
        <details className="evidence-panel">
          <summary>Evidence</summary>
          <div className="pt-4">
            <MarkdownPart glossary={glossary} offset={evidenceAt}>{evidence}</MarkdownPart>
          </div>
        </details>
      ) : null}
    </div>
  )
  return glossary.reference === null ? reader : <TermCards glossary={glossary}>{reader}</TermCards>
}

/**
 * Some of a document, read as GitHub reads Markdown, with the document's
 * terms drawn when it defines any; `offset` is where this text starts in the
 * document. A document without terms goes through GitHub's reading alone.
 */
function MarkdownPart({ glossary, offset, children }: { glossary: Glossary; offset: number; children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={glossary.reference === null ? [remarkGfm] : [remarkGfm, [remarkTerms, { glossary, offset }]]}
      components={markdownComponents}
    >
      {children}
    </ReactMarkdown>
  )
}

/**
 * The terms of the document being read, and the one card its references open.
 * A meaning drawn in that card has no card of its own, so the terms in it are
 * coloured and open nothing.
 */
type Terms = { readonly glossary: Glossary; readonly card: PreviewCard.Handle<unknown> | null }

const TermsContext = React.createContext<Terms | null>(null)

/**
 * A document that defines terms, with the card its references share: resting
 * the pointer on one shows the meaning of the term it names. The meaning is
 * the document's content, not a tip, so it shows whether or not Tips is on.
 */
function TermCards({ glossary, children }: { glossary: Glossary; children: React.ReactNode }) {
  const [card] = React.useState(() => PreviewCard.createHandle<unknown>())
  const terms = React.useMemo(() => ({ glossary, card }), [glossary, card])
  return (
    <TermsContext value={terms}>
      {children}
      <HoverCard handle={card}>
        {({ payload }) => <TermCard glossary={glossary} term={typeof payload === 'string' ? payload : null} />}
      </HoverCard>
    </TermsContext>
  )
}

/**
 * A reference to a term, drawn in the term colour. In the document it opens
 * its term's card while the pointer rests on it; it is never a link, so a
 * click does nothing. Inside a card it opens nothing.
 */
function TermReference({ term, children }: { term: unknown; children: React.ReactNode }) {
  const terms = React.use(TermsContext)
  if (typeof term !== 'string' || terms === null) return <span>{children}</span>
  if (terms.card === null) return <span className="term">{children}</span>
  return (
    <HoverCardTrigger handle={terms.card} payload={term} render={<span className="term" />}>
      {children}
    </HoverCardTrigger>
  )
}

/** The card of the term a reference names: its meaning, read as Markdown, over the way to its row in the table. */
function TermCard({ glossary, term }: { glossary: Glossary; term: string | null }) {
  const tip = useTip()
  const inCard = React.useMemo(() => ({ glossary, card: null }), [glossary])
  const definition = term === null ? undefined : glossary.terms.get(term)
  // A meaning is prose to read, so the card is wider than the stock one's sixteen rem.
  return (
    <HoverCardContent className="w-80">
      {definition === undefined ? null : (
        <TermsContext value={inCard}>
          <div className="markdown-reader markdown-meaning">
            <MarkdownPart glossary={glossary} offset={0}>{definition.meaning}</MarkdownPart>
          </div>
          <a
            className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            href={`#${definition.id}`}
            title={tip(`Go to the row of the table that defines ${term}.`)}
          >
            Table
          </a>
        </TermsContext>
      )}
    </HoverCardContent>
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
