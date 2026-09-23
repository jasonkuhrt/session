import { Check, ChevronRight, Copy } from 'lucide-react'
import * as React from 'react'

import type { ContextEntry } from '../contract'
import { BoardPageFrame, ListingEmpty, ListingNotices, PageLoading } from './components/board-page'
import { useCopy } from './components/copyable'
import { Button } from './components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible'
import { problemOf, readPlace, SessionApi, worktreeOf } from './lib/api'
import { absoluteHref, filePageHref, isMarkdownPath, rawFileHref } from './lib/base'
import { useNow } from './lib/clock'
import { useFollowed } from './lib/follow'
import { absoluteTime, relativeTime } from './lib/format'
import { listingMeta } from './lib/listings'
import { openOnceOnClick } from './lib/open-once'
import { cn } from './lib/utils'

/** The page reads where it stands, for its name and root, and `context/` for its entries, together. */
const readContext = (signal: AbortSignal) => Promise.all([readPlace(signal), SessionApi.context(signal)])

/** One entry of the tree, with what it holds when it is a directory. */
type Node = {
  readonly entry: ContextEntry
  readonly name: string
  readonly children: Node[]
}

/** Directories before files; everything else keeps its place. */
const directoriesFirst = (left: Node, right: Node) =>
  Number(right.entry.kind === 'directory') - Number(left.entry.kind === 'directory')

/**
 * The listing as a tree. The daemon lists `context/` depth first, each
 * directory right before what it holds and siblings by name, so every entry's
 * directory is already placed when the entry arrives. Siblings are then drawn
 * directories first; the sort is stable, so each group keeps the listing's
 * order by name.
 */
function treeOf(entries: readonly ContextEntry[]): readonly Node[] {
  const top: Node[] = []
  const placed = new Map<string, Node>()
  for (const entry of entries) {
    const slash = entry.path.lastIndexOf('/')
    const node: Node = { entry, name: entry.path.slice(slash + 1), children: [] }
    placed.set(entry.path, node)
    const siblings = placed.get(entry.path.slice(0, slash))?.children ?? top
    siblings.push(node)
  }
  const ordered = (nodes: readonly Node[]): Node[] =>
    nodes.toSorted(directoriesFirst).map((node) => ({ entry: node.entry, name: node.name, children: ordered(node.children) }))
  return ordered(top)
}

/**
 * The session's `context/`, as a tree. Directories start collapsed and say how
 * much they hold; a file says when it was written, opens where it can be read,
 * and copies where it is on disk. Nothing here has a lifecycle: it is the
 * supporting material agents keep, as the daemon lists it.
 */
export function ContextPage() {
  const now = useNow()
  const { value, error } = useFollowed(readContext)
  const [place, context] = value ?? [null, null]
  // Which directories are open, by path, so a refetch after a write keeps them
  // as the reader left them.
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set())
  const toggle = React.useCallback((path: string, next: boolean) => {
    setOpen((current) => {
      const changed = new Set(current)
      if (next) changed.add(path)
      else changed.delete(path)
      return changed
    })
  }, [])
  return (
    <BoardPageFrame
      title={listingMeta.context.label}
      worktree={worktreeOf(place)}
      boardMeaning="The board of the session this context belongs to."
      crumbs={[{ label: listingMeta.context.label, meaning: listingMeta.context.meaning }]}
      problem={error ?? problemOf(place)}
    >
      {context === null ? (error === null ? <PageLoading /> : null) : (
        <>
          <ListingNotices notices={context.notices} />
          {context.entries.length === 0
            ? <ListingEmpty>No files.</ListingEmpty>
            : (
              <Tree
                nodes={treeOf(context.entries)}
                directory={place?.kind === 'read' ? place.directory : null}
                now={now}
                open={open}
                onToggle={toggle}
              />
            )}
        </>
      )}
    </BoardPageFrame>
  )
}

type TreeProps = {
  /** The session root the entries' paths hang off, absolute; null while the session cannot be read. */
  directory: string | null
  now: number
  open: ReadonlySet<string>
  onToggle: (path: string, open: boolean) => void
}

function Tree({ nodes, ...props }: TreeProps & { nodes: readonly Node[] }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.entry.path}>
          {node.entry.kind === 'directory' ? <DirectoryRow node={node} {...props} /> : <FileRow node={node} {...props} />}
        </li>
      ))}
    </ul>
  )
}

/** How much a directory holds, in words. */
const holding = (count: number) => (count === 1 ? 'It holds 1 entry.' : `It holds ${count} entries.`)

const rowClass = 'flex min-h-8 items-center gap-2 rounded-md px-2 text-sm'

const fileLink =
  'min-w-0 truncate rounded-sm font-mono underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * A directory: its name, and how many entries it holds directly. One that
 * holds something opens and closes; an empty one has nothing to show, so it is
 * only a name.
 */
function DirectoryRow({ node, ...props }: TreeProps & { node: Node }) {
  const { path } = node.entry
  const count = node.children.length
  const label = (
    <>
      <span className="truncate font-mono">{node.name}/</span>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
    </>
  )
  if (count === 0) {
    return (
      <div className={cn(rowClass, 'pl-8')} title={`${path}/ is empty.`}>
        {label}
      </div>
    )
  }
  const expanded = props.open.has(path)
  return (
    <Collapsible open={expanded} onOpenChange={(next) => props.onToggle(path, next)}>
      <CollapsibleTrigger
        className={cn(
          rowClass,
          'group/directory w-full text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
        )}
        title={`${expanded ? 'Hide' : 'Show'} what ${path}/ holds. ${holding(count)}`}
      >
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/directory:rotate-90"
        />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-4 border-l pl-2">
        <Tree nodes={node.children} {...props} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * A file: its name, which opens it, when it was written, and a copy of where
 * it is on disk. A Markdown file opens on the board's file page, where it is
 * read the way an item is; any other file opens as it is on disk, once, in a
 * tab of its own. Where it is on disk is known only once the session has been
 * read, so until then there is no copy to offer.
 */
function FileRow({ node, directory, now }: TreeProps & { node: Node }) {
  const { path, writtenAt } = node.entry
  const markdown = isMarkdownPath(path)
  const href = markdown ? filePageHref(path) : rawFileHref(path)
  const absolute = absoluteHref(href)
  return (
    <div className={cn(rowClass, 'group/file pl-8 hover:bg-muted')}>
      {markdown
        ? (
          <a className={fileLink} href={href} title={`Read ${path} on a page of its own.`}>
            {node.name}
          </a>
        )
        : (
          <a
            className={fileLink}
            href={href}
            rel="noreferrer"
            target="_blank"
            title={`Open ${path} as it is on disk, in a tab of its own; a second click brings that tab back.`}
            onClick={absolute === null ? undefined : openOnceOnClick(absolute)}
          >
            {node.name}
          </a>
        )}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground" title={`Written at ${absoluteTime(writtenAt)}.`}>
        {relativeTime(writtenAt, now)}
      </span>
      {directory === null ? null : <CopyPath path={`${directory}/${path}`} />}
    </div>
  )
}

/**
 * Where a file is on disk, for a terminal or an editor beside the page. It
 * shows under the pointer or the focus ring, as every copy on the board does,
 * and stays up once it has something to report.
 */
function CopyPath({ path }: { path: string }) {
  const [state, copy] = useCopy()
  const label = state === 'idle' ? `Copy the absolute path ${path}` : state === 'copied' ? 'Copied' : 'Copy failed'
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      className={cn(
        'shrink-0 text-muted-foreground',
        state === 'idle' && 'opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100',
      )}
      onClick={() => void copy(path)}
    >
      {state === 'copied' ? <Check /> : <Copy />}
    </Button>
  )
}
