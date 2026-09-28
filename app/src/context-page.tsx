import { useSearch } from '@tanstack/react-router'

import type { ContextEntry } from '../contract'
import { encodeWorktreeKey } from '../contract'
import { ListingEmpty, ListingNotices, PageLoading, PageSurface, useFocusUpTo } from './components/page'
import { useTip } from './components/tip'
import { problemOf } from './lib/api'
import { absoluteHref, isMarkdownPath, rawFileHref, useBoardName, useBoardPath } from './lib/base'
import { useNow } from './lib/clock'
import { useFolds } from './lib/folds'
import { useFollowed } from './lib/follow'
import { absoluteTime, relativeTime } from './lib/format'
import { listingMeta } from './lib/listings'
import { openOnce } from './lib/open-once'
import { reads } from './lib/reads'
import { cn } from './lib/utils'
import { idOf } from './levels'
import { Node } from './substrate/node'
import type { Path } from './substrate/seam'
import type { Entry } from './tree-types'

/** One entry of the tree, with what it holds when it is a directory. */
type TreeNode = {
  readonly entry: ContextEntry
  readonly name: string
  readonly children: TreeNode[]
}

/** Directories before files; everything else keeps its place. */
const directoriesFirst = (left: TreeNode, right: TreeNode) =>
  Number(right.entry.kind === 'directory') - Number(left.entry.kind === 'directory')

/**
 * The listing as a tree. The daemon lists `context/` depth first, each
 * directory right before what it holds and siblings by name, so every entry's
 * directory is already placed when the entry arrives. Siblings are then drawn
 * directories first; the sort is stable, so each group keeps the listing's
 * order by name.
 */
function treeOf(entries: readonly ContextEntry[]): readonly TreeNode[] {
  const top: TreeNode[] = []
  const placed = new Map<string, TreeNode>()
  for (const entry of entries) {
    const slash = entry.path.lastIndexOf('/')
    const node: TreeNode = { entry, name: entry.path.slice(slash + 1), children: [] }
    placed.set(entry.path, node)
    const siblings = placed.get(entry.path.slice(0, slash))?.children ?? top
    siblings.push(node)
  }
  const ordered = (nodes: readonly TreeNode[]): TreeNode[] =>
    nodes.toSorted(directoriesFirst).map((node) => ({ entry: node.entry, name: node.name, children: ordered(node.children) }))
  return ordered(top)
}

/** The entries the tree draws, in order, and how deep each is: a directory's only while it is open. */
const visibleOf = (nodes: readonly TreeNode[], open: (path: string) => boolean, depth = 0): Array<{ readonly node: TreeNode; readonly depth: number }> =>
  nodes.flatMap((node) => [
    { node, depth },
    ...(node.entry.kind === 'directory' && open(node.entry.path) ? visibleOf(node.children, open, depth + 1) : []),
  ])

/**
 * The session's `context/`, as a tree. A directory starts folded and says how
 * much it holds, and its Enter opens or folds it; a file says when it was
 * written, and its Enter opens it where it can be read: a Markdown file on
 * the file page, and any other as it is on disk, once, in a tab of its own.
 */
export function ContextPage() {
  const { focus: leaf } = useSearch({ strict: false })
  const now = useNow()
  const board = useBoardPath()
  const name = useBoardName()
  const key = encodeWorktreeKey(name)
  const folds = useFolds()
  const { value, error } = useFollowed({ board, read: reads.context(board) })
  const [place, context] = value ?? [null, null]
  const directory = place?.kind === 'read' ? place.directory : null
  const foldKey = `context:${key}`
  const open = (path: string) => !folds.folded(`${foldKey}/${path}`, true)
  const tree = context === null ? [] : treeOf(context.entries)
  const visible = visibleOf(tree, open)
  const recordId = idOf({ kind: 'record', page: 'context', path: '' })
  const entries: Entry[] = visible.map(({ node }) => ({
    at: node.entry.path,
    heading: node.entry.path,
    facts: node.entry.kind === 'directory'
      ? [{ key: 'holds', text: node.children.length === 1 ? 'holds 1 entry' : `holds ${node.children.length} entries`, meaning: 'How many entries the directory holds directly.' }]
      : [{ key: 'written', text: `written ${relativeTime(node.entry.writtenAt, now)}`, meaning: `Written at ${absoluteTime(node.entry.writtenAt)}.` }],
  }))
  return (
    <PageSurface
      place={{ kind: 'listing', key, page: 'context' }}
      leaf={leaf}
      title={listingMeta.context.label}
      sessions={new Map()}
      archived={null}
      entries={new Map([[recordId, entries]])}
      write={null}
      pending={false}
      rules={null}
      page={{
        enter: (at, surface) => {
          const found = visible.find(({ node }) => node.entry.path === at)?.node
          if (found === undefined) return
          if (found.entry.kind === 'directory') {
            if (found.children.length === 0) surface.flash(`${at}/ is empty`)
            else folds.toggle(`${foldKey}/${at}`)
            return
          }
          if (isMarkdownPath(at)) {
            const record = surface.focus.slice(0, -2)
            surface.setFocus([...record, idOf({ kind: 'record', page: 'file', path: at })])
            return
          }
          const href = absoluteHref(rawFileHref({ board, path: at }))
          if (href === null || !openOnce(href)) surface.flash('The browser refused to open a tab')
        },
        pathOf: (at) => (directory === null ? null : `${directory}/${at}`),
        path: directory === null ? null : `${directory}/context`,
      }}
      ready={value !== null || error !== null}
      problem={error ?? problemOf(place)}
    >
      {context === null ? (error === null ? <PageLoading /> : null) : (
        <>
          <ListingNotices notices={context.notices} />
          <Tree visible={visible} open={open} now={now} />
        </>
      )}
    </PageSurface>
  )
}

function Tree({ visible, open, now }: {
  visible: ReadonlyArray<{ readonly node: TreeNode; readonly depth: number }>
  open: (path: string) => boolean
  now: number
}) {
  const record = useFocusUpTo('record')
  const tip = useTip()
  return (
    <>
      <Heading record={record} />
      {visible.length === 0 ? <ListingEmpty>No files.</ListingEmpty> : (
        <ul className="space-y-0.5 font-mono text-sm">
          {visible.map(({ node, depth }) => {
            const { path, kind } = node.entry
            const row = (
              <span className="flex min-w-0 items-baseline gap-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                <span className="min-w-0 truncate" title={tip(path)}>{kind === 'directory' ? `${node.name}/` : node.name}</span>
                {kind === 'directory'
                  ? <span className="text-xs text-muted-foreground" title={tip(open(path) ? 'Open; Enter folds it.' : 'Folded; Enter opens it.')}>{node.children.length}</span>
                  : (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground" title={tip(`Written at ${absoluteTime(node.entry.writtenAt)}.`)}>
                      {relativeTime(node.entry.writtenAt, now)}
                    </span>
                  )}
              </span>
            )
            return (
              <li key={path}>
                {record === null ? row : <Node path={[...record, idOf({ kind: 'section', at: path })]} className={cn('px-2 py-1')}>{row}</Node>}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/** The page's heading, the record node the focus comes out to. */
function Heading({ record }: { record: Path | null }) {
  const tip = useTip()
  const label = <span title={tip(listingMeta.context.meaning)}>{listingMeta.context.label}</span>
  return record === null
    ? <h1 className="mb-6 text-2xl font-medium">{label}</h1>
    : <Node path={record} as="h2" className="-mx-2.5 mb-6 px-2.5 py-1 text-2xl font-medium">{label}</Node>
}
