import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import * as React from 'react'

import type { ArchiveRecord, Item, Session, Stage } from '../contract'
import { encodeWorktreeKey, stageNames } from '../contract'
import { noneLines } from '../stage-rules'
import { Markdown } from './components/markdown'
import { PageLoading, PageSurface, useFocusUpTo } from './components/page'
import { Explained, useTip } from './components/tip'
import { SessionApi } from './lib/api'
import { archiveStateMeaning, readArchivedItem } from './lib/archive'
import { useBoardName, useBoardPath } from './lib/base'
import { useFolds } from './lib/folds'
import { landWrite, reread } from './lib/reads'
import { extentOf, isEvidence, sectionsOf } from './lib/sections'
import { useSessionWrites } from './lib/session-mutations'
import { useStream } from './lib/stream'
import { cn } from './lib/utils'
import { groupMeta, moveAvailability, stageHint } from './lib/workflow'
import { idOf } from './levels'
import { Node } from './substrate/node'
import type { PageActions } from './session-seam'
import { useSurface } from './substrate/surface-context'
import type { Entry } from './tree-types'
import { bodyAt } from './tree-types'

const route = getRouteApi('/w/$key/item/$id')

/** Where an item is, the item itself, and the root its path is relative to. */
function locate(session: Session | null, id: string) {
  if (session === null) return null
  for (const stage of session.stages) {
    const item = stage.items.find((candidate) => candidate.id === id)
    if (item) return { item, stage: stage.stage, directory: session.directory }
  }
  return null
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Could not load the session')

/**
 * One read of the session, as the page shows it. When no stage holds the item
 * its archived record is read first, so the page goes from the item in its
 * stage to the item in the archive in one step, never through a moment where
 * the item is nowhere.
 */
async function landed({ board, id, session, signal }: {
  readonly board: string
  readonly id: string
  readonly session: Session
  readonly signal?: AbortSignal | undefined
}) {
  if (locate(session, id) !== null) return { session, archived: null, unread: null }
  try {
    return { session, archived: await readArchivedItem({ board, id, signal }), unread: null }
  } catch (error) {
    return { session, archived: null, unread: `The archive could not be read, so ${id} is not shown: ${messageOf(error)}` }
  }
}

const itemRead = (board: string, id: string) =>
  queryOptions({
    queryKey: [board, 'item', id],
    queryFn: async ({ signal }) => landed({ board, id, session: await SessionApi.read(board, signal), signal }),
  })

/** The entries of an item's page: its sections, each with how much it holds, or the body as one when it has none. */
const entriesOf = (item: Item | null): readonly Entry[] => {
  if (item === null) return []
  const sections = sectionsOf(item.body)
  if (sections.length === 0) return [{ at: bodyAt, heading: item.title, facts: [] }]
  return sections.map((section) => ({
    at: section.at,
    heading: section.heading,
    facts: [{ key: 'extent', text: extentOf(section), meaning: 'How much the section holds.' }],
  }))
}

/** What Enter and a copy do on an item's page: fold a section, and copy the item's file. */
const pageOf = ({ item, directory, toggle }: { readonly item: Item | null; readonly directory: string | null; readonly toggle: (at: string) => void }): PageActions => ({
  enter: (at, surface) => {
    if (at === bodyAt) surface.flash('The item has no sections to fold')
    else toggle(at)
  },
  pathOf: () => null,
  path: item === null || directory === null ? null : `${directory}/${item.path}`,
})

/**
 * One item, on its own page: its title, its five stages with its own lit,
 * and its document, each section's heading a node the focus can be on, whose
 * Enter folds it to its heading. Its group, id and path are in the path line
 * and the detail line. The page follows the item wherever it is filed: from
 * stage to stage, and into `archive/`, where it is still the item, read-only.
 */
/**
 * The item page's read and writes: the session and, when no stage holds the
 * item, its archived record, following the files on the board's stream, and
 * the writes that land where the page reads.
 */
function useItem(board: string, id: string) {
  const client = useQueryClient()
  const { data, error, isPending } = useQuery(itemRead(board, id))
  const session = data?.session ?? null
  const reload = React.useCallback(() => reread({ client, queryKey: itemRead(board, id).queryKey }), [board, client, id])
  const revisionOf = React.useCallback(() => session?.revision ?? null, [session])
  const writes = useSessionWrites({
    revisionOf,
    // A write lands as a read does: an item it filed away is shown in the archive rather than as gone.
    onSession: (_board, next) => landWrite({ client, queryKey: itemRead(board, id).queryKey, answer: () => landed({ board, id, session: next }) }),
    reload,
  })
  useStream({ board, on: { changed: reload } })
  const found = locate(session, id)
  const archived = data?.archived ?? null
  return {
    session,
    archived,
    found,
    item: found?.item ?? archived?.item ?? null,
    isPending,
    problem: error === null ? data?.unread ?? null : messageOf(error),
    ...writes,
  }
}

/** Where the item is filed, as its page says above its title. */
const placeOf = (read: ReturnType<typeof useItem>): Place | null => {
  if (read.found !== null) return { kind: 'stage', stage: read.found.stage }
  return read.archived === null ? null : { kind: 'archived', record: read.archived.record }
}

export function ItemPage({ id }: { id: string }) {
  const { focus: leaf, via } = route.useSearch()
  const board = useBoardPath()
  const key = encodeWorktreeKey(useBoardName())
  const folds = useFolds()
  const read = useItem(board, id)
  const { session, archived, found, item, pending, write } = read
  const sections = item === null ? [] : sectionsOf(item.body)
  const foldKey = `item:${key}:${id}`
  return (
    <PageSurface
      place={{ kind: 'item', key, id, via: via ?? null }}
      leaf={leaf}
      title={id}
      sessions={session === null ? new Map() : new Map([[key, session]])}
      archived={archived === null ? null : { key, item: archived.item }}
      entries={new Map([[idOf({ kind: 'item', key, id }), entriesOf(item)]])}
      write={found === null ? null : write}
      pending={pending}
      rules={session?.rules ?? null}
      page={pageOf({ item, directory: session?.directory ?? null, toggle: (at) => folds.toggle(`${foldKey}/${at}`) })}
      ready={!read.isPending}
      problem={read.problem}
    >
      {item === null ? <Missing id={id} pending={read.isPending} problem={read.problem} /> : (
        <Detail
          item={item}
          place={placeOf(read)}
          pending={pending}
          onMove={found === null ? null : (to) => write(board, '/api/move', { id, to })}
          sectionsAt={{ foldKey, startsFolded: (at) => sections.some((section) => section.at === at && isEvidence(section)), drawn: sections.length > 0 }}
        />
      )}
    </PageSurface>
  )
}

/** What the page draws while there is no item to draw: the read under way, or, once one worked, that the session has no such item. */
function Missing({ id, pending, problem }: { id: string; pending: boolean; problem: string | null }) {
  if (pending) return <PageLoading />
  // A read that failed says so above; only a read that worked can say the item is not here.
  return problem === null ? <p className="text-sm text-muted-foreground">No item {id} in this session.</p> : null
}

/** Where the item on a page is filed: a stage, or the record it was filed away as. */
type Place = { readonly kind: 'stage'; readonly stage: Stage } | { readonly kind: 'archived'; readonly record: ArchiveRecord }

/**
 * The item itself: where it is filed, its title, where it can go, then its
 * document. The document is the reason the page exists, so the lines above
 * it are one each and a rule hands the page over to the prose.
 */
function Detail({ item, place, pending, onMove, sectionsAt }: {
  item: Item
  place: Place | null
  pending: boolean
  /** Moves the item to another stage, answering why it did not; null for an archived item. */
  onMove: ((to: Stage) => Promise<string | null>) | null
  sectionsAt: { readonly foldKey: string; readonly startsFolded: (at: string) => boolean; readonly drawn: boolean }
}) {
  const tip = useTip()
  const stage = place?.kind === 'stage' ? place.stage : null
  const none = React.useMemo(() => noneLines(item.body), [item.body])
  // The item's own path is what its sections hang off, as the tree has it.
  const itemPath = useFocusUpTo('item')
  return (
    <article>
      {place?.kind === 'archived' ? <ArchivedLine record={place.record} /> : null}
      {stage !== null && item.group
        ? (
          <p className="mb-3 text-sm">
            <span className="text-muted-foreground" title={tip(groupMeta[stage].field)}>{groupMeta[stage].label}</span>{' '}
            <span className="font-medium">{item.group}</span>
          </p>
        )
        : null}
      <h1 className="text-pretty text-3xl leading-tight font-medium tracking-tight">{item.title}</h1>
      <StageLine item={item} stage={stage} pending={pending} onMove={onMove} />
      <div className="mt-8 border-t pt-8">
        {sectionsAt.drawn || itemPath === null ? (
          <Markdown
            page
            noneLines={none}
            sections={itemPath === null ? null : { base: itemPath, foldKey: sectionsAt.foldKey, startsFolded: sectionsAt.startsFolded }}
          >
            {item.body}
          </Markdown>
        ) : (
          // A body with no sections is one node, the body itself.
          <Node path={[...itemPath, idOf({ kind: 'section', at: bodyAt })]} className="-mx-2.5 px-2.5 py-1">
            <Markdown page noneLines={none}>{item.body || '_No detail has been written yet._'}</Markdown>
          </Node>
        )}
      </div>
    </article>
  )
}

/**
 * The five stages, the item's own lit and the rest very dim, since together
 * they show the shape of the flow: a stage the item can go to is drawn as a
 * word to click, and one it cannot says on hover what is needed first. An
 * archived item is in none of them, so all five are dim.
 */
function StageLine({ item, stage, pending, onMove }: {
  item: Item
  stage: Stage | null
  pending: boolean
  onMove: ((to: Stage) => Promise<string | null>) | null
}) {
  const surface = useSurface()
  const tip = useTip()
  return (
    <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {stageNames.map((candidate) => {
        const current = candidate === stage
        const availability = stage === null
          ? { enabled: false, reason: 'It is archived, so no stage holds it.' }
          : moveAvailability(item, stage, candidate)
        const reachable = !current && availability.enabled && !pending && onMove !== null
        return (
          <button
            key={candidate}
            type="button"
            tabIndex={-1}
            className={cn(
              'rounded-sm',
              current ? 'font-medium text-foreground' : reachable ? 'cursor-pointer text-muted-foreground hover:text-foreground' : 'cursor-default text-muted-foreground/35',
            )}
            title={tip(current ? stageHint[candidate] : availability.reason ?? stageHint[candidate])}
            onClick={async () => {
              if (reachable) {
                const refused = await onMove(candidate)
                if (refused !== null) surface.flash(refused)
              } else if (!current) {
                surface.flash(availability.reason ?? `It cannot go to ${candidate}`)
              }
            }}
          >
            {candidate}
          </button>
        )
      })}
    </p>
  )
}

/**
 * Where an archived item is: under `archive/`, as its record's name says, with
 * how it left and the day it was filed, above the title.
 */
function ArchivedLine({ record }: { record: ArchiveRecord }) {
  const tip = useTip()
  return (
    <p className="mb-3 flex items-baseline gap-2 text-sm">
      <span className="text-muted-foreground" title={tip('This item is filed under archive/, out of the five stages. Its page shows it as it was filed, read-only.')}>
        Archived
      </span>
      {record.state === null ? null : <Explained meaning={archiveStateMeaning(record.state)} className="font-medium">{record.state}</Explained>}
      {record.date === null ? null : <span className="font-mono text-xs text-muted-foreground">{record.date}</span>}
    </p>
  )
}
