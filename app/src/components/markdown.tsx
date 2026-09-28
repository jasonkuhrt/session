import { PreviewCard } from '@base-ui/react/preview-card'
import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'
import { absoluteHref, isMarkdownPath, useBoardPath } from '../lib/base'
import { openOnceOnClick } from '../lib/open-once'
import { useFolds } from '../lib/folds'
import { remarkSections } from '../lib/sections'
import { type Glossary, glossaryOf, remarkTerms } from '../lib/terms'
import { cn } from '../lib/utils'
import { noneMeaning } from '../lib/workflow'
import { idOf } from '../levels'
import { Node } from '../substrate/node'
import type { Path } from '../substrate/seam'
import { copyLabel, useCopy } from './copyable'
import { Explained, useTip } from './tip'
import { Button } from './ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'

/** No line of the Markdown says None, so every paragraph is drawn as written. */
const noNoneLines: ReadonlySet<number> = new Set()

/**
 * The lines of the Markdown being drawn, counted from 1 as its own text counts
 * them, on which the word None says its section is intentionally empty.
 */
const NoneLines = React.createContext(noNoneLines)

/**
 * A page whose Markdown is drawn in sections, each heading a node the focus
 * can be on: where the page is in the tree, the key its folds go by, and
 * which of its sections start folded.
 */
export type Sections = {
  readonly base: Path
  readonly foldKey: string
  readonly startsFolded: (at: string) => boolean
}

const SectionsContext = React.createContext<Sections | null>(null)

const markdownComponents = {
  a: ({ children, href }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  img: ({ alt, src, title }) => <MarkdownImage alt={alt} src={src} title={title} />,
  // react-markdown hands every component its hast node; an element is given only its own props.
  input: ({ node: _node, ...props }) => <input {...props} disabled />,
  p: ({ node, ...props }) => <Paragraph line={node?.position?.start.line} {...props} />,
  // Markdown draws no span of its own: each is a reference the terms plugin marked with the term it names.
  span: ({ children, node }) => <TermReference term={node?.properties['dataTerm']}>{children}</TermReference>,
  // Markdown draws no section of its own: each is one the sections plugin gathered under a heading.
  section: ({ children, node }) => <SectionBlock at={node?.properties['dataSectionAt']}>{children}</SectionBlock>,
} satisfies Components

export function Markdown({ children, sections = null, page = false, noneLines = noNoneLines }: {
  children: string
  /** Where the page's sections are, when the Markdown is drawn in sections; null when it is not. */
  sections?: Sections | null
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
  const glossary = React.useMemo(() => glossaryOf(children), [children])
  const reader = (
    <div className={cn('markdown-reader', page && 'markdown-page')}>
      <NoneLines value={noneLines}>
        <SectionsContext value={sections}>
          <Reading glossary={glossary} inSections={sections !== null}>{children}</Reading>
        </SectionsContext>
      </NoneLines>
    </div>
  )
  return glossary.reference === null ? reader : <TermCards glossary={glossary}>{reader}</TermCards>
}

/**
 * Markdown read as GitHub reads it, as one tree: the document's terms drawn
 * when it defines any, and its sections gathered under their headings when
 * the page draws it in sections. A document without terms is read without
 * the terms plugin.
 */
function Reading({ glossary, inSections, children }: {
  glossary: Glossary
  inSections: boolean
  children: string
}) {
  const plugins: PluggableList = [remarkGfm]
  if (glossary.reference !== null) plugins.push([remarkTerms, { glossary }])
  if (inSections) plugins.push(remarkSections)
  return (
    <ReactMarkdown remarkPlugins={plugins} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  )
}

/**
 * The card a document's references open, or none inside a card, where the
 * terms of a meaning are coloured and open nothing.
 */
const CardContext = React.createContext<PreviewCard.Handle<string> | null>(null)

/**
 * A document that defines terms, with the one card its references share:
 * resting the pointer on one shows the meaning of the term it names. The
 * meaning is the document's content, not a tip, so it shows whether or not
 * Tips is on.
 */
function TermCards({ glossary, children }: { glossary: Glossary; children: React.ReactNode }) {
  const [card] = React.useState(() => PreviewCard.createHandle<string>())
  return (
    <CardContext value={card}>
      {children}
      <HoverCard handle={card}>
        {/* The stock card types what a trigger hands it as unknown, so the term is read back as the string it is. */}
        {({ payload }) => <TermCard glossary={glossary} term={typeof payload === 'string' ? payload : undefined} />}
      </HoverCard>
    </CardContext>
  )
}

/**
 * A reference to a term, drawn in the term colour. In the document it opens
 * its term's card while the pointer rests on it; it is never a link, so a
 * click does nothing. Inside a card it opens nothing.
 */
function TermReference({ term, children }: { term: unknown; children: React.ReactNode }) {
  const card = React.use(CardContext)
  if (typeof term !== 'string') return <span>{children}</span>
  if (card === null) return <span className="term">{children}</span>
  return (
    <HoverCardTrigger handle={card} payload={term} render={<span className="term" />}>
      {children}
    </HoverCardTrigger>
  )
}

/** The card of the term a reference names: its meaning, read as Markdown, over the way to its row in the table. */
function TermCard({ glossary, term }: { glossary: Glossary; term: string | undefined }) {
  const tip = useTip()
  const definition = term === undefined ? undefined : glossary.terms.get(term)
  // A meaning is prose to read, so the card is wider than the stock one's sixteen rem.
  return (
    <HoverCardContent className="w-80">
      {definition === undefined ? null : (
        <CardContext value={null}>
          <div className="markdown-reader markdown-meaning">
            <Reading glossary={glossary} inSections={false}>{definition.meaning}</Reading>
          </div>
          <a
            className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            href={`#${definition.id}`}
            title={tip(`Go to the row of the table that defines ${term}.`)}
          >
            Table
          </a>
        </CardContext>
      )}
    </HoverCardContent>
  )
}

/**
 * A section of a page drawn in sections: its heading as a node the focus can
 * be on, then its body, left out while it is folded, when the heading says
 * so. Outside such a page, and in a term's card, it is only a section.
 */
function SectionBlock({ at, children }: { at: unknown; children: React.ReactNode }) {
  const sections = React.use(SectionsContext)
  const folds = useFolds()
  const tip = useTip()
  const [heading, ...body] = React.Children.toArray(children).filter((child) => typeof child !== 'string' || child.trim() !== '')
  if (sections === null || typeof at !== 'string') return <section>{children}</section>
  const folded = folds.folded(`${sections.foldKey}/${at}`, sections.startsFolded(at))
  return (
    <section>
      <Node path={[...sections.base, idOf({ kind: 'section', at })]} className="-mx-2.5 flow-root px-2.5 py-1">
        {heading}
        {folded ? <p className="text-xs text-muted-foreground" title={tip('Folded to its heading; Enter opens it again.')}>folded</p> : null}
      </Node>
      {folded ? null : body}
    </section>
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
