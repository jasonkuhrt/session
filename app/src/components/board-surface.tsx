import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import type { DaemonCapabilities, FocusResult, Session, StreamEvent, WorktreeSummary } from '../../contract'
import { stageNames } from '../../contract'
import { useNow } from '../lib/clock'
import { landWrite, reads, reread } from '../lib/reads'
import { useSessionWrites } from '../lib/session-mutations'
import { useStream } from '../lib/stream'
import { idOf } from '../levels'
import type { SeamInput } from '../session-seam'
import { useSessionSeam } from '../session-seam'
import type { Path } from '../substrate/seam'
import { Surface } from '../substrate/surface'
import { useSurface } from '../substrate/surface-context'
import type { Place } from '../tree-types'
import type { BoardPart, GroupDrop } from './board'
import { Board } from './board'
import type { PathsOf } from './lane'
import type { Signals } from './marks'
import { Marks } from './marks'
import { Skeleton } from './ui/skeleton'
import { TooltipProvider } from './ui/tooltip'

/**
 * One worktree's part of a board, before its session is known: its board's
 * prefix, the key it is served under, the worktree's name, and its session
 * once the page has read it since it mounted.
 */
export type SurfacePart = { readonly board: string; readonly key: string; readonly name: string; readonly session: Session | null }

/** A read an event of the board's stream runs. */
type Read = () => Promise<unknown>

/**
 * The stream a board follows, beside the `changed` on which it reads every
 * session it draws again: where it is, a worktree's board's prefix or the
 * root's, the reads its other events run, the ones of those a drag or a write
 * holds as it holds `changed`, and what a hold's end reads beside the sessions
 * when any event it held arrived.
 */
type SurfaceStream = {
  readonly board: string
  readonly on: Partial<Record<Exclude<StreamEvent, 'changed'>, Read>>
  readonly held: ReadonlyArray<StreamEvent>
  readonly release?: Read | undefined
}

/**
 * Every board's page: the lanes of every worktree in view under the path
 * line, with what could not be read said above them. Every write goes to the
 * board of the worktree it changes, with that session's revision, so a board
 * of many worktrees never crosses from one to another. The daemon pushes
 * `changed` once a burst of writes under a `.session` settles; the board
 * never polls. A read of the sessions waits while a write is in flight or a
 * card is being dragged, because the sortable library owns placement until
 * drop, and one read catches up when that ends; no key acts during a drag.
 */
export function BoardSurface({ place, leaf, title, parts, rows, grouped, loading, problems, signalsOf, capabilities, focusAgent, rules, stream }: {
  readonly place: Extract<Place, { kind: 'board' | 'union' }>
  readonly leaf: string | undefined
  /** What the tab names the board. */
  readonly title: string
  readonly parts: readonly SurfacePart[]
  /** Every row, read since the page mounted; null until it is. */
  readonly rows: readonly WorktreeSummary[] | null
  readonly grouped: boolean
  /** Whether the first read of what the lanes draw has yet to land. */
  readonly loading: boolean
  /** What could not be read, a sentence each. */
  readonly problems: readonly string[]
  readonly signalsOf: (row: WorktreeSummary) => Signals
  readonly capabilities: DaemonCapabilities
  readonly focusAgent: (pid: number) => Promise<FocusResult>
  readonly rules: boolean | null
  readonly stream: SurfaceStream
}) {
  const client = useQueryClient()
  const [dragging, setDragging] = React.useState(false)
  const now = useNow()

  const readSession = React.useCallback((board: string) => reread({ client, queryKey: reads.session(board).queryKey }), [client])
  const readSessions = () => Promise.all(parts.map((part) => readSession(part.board)))

  const revisionOf = React.useCallback(
    (board: string) => parts.find((part) => part.board === board)?.session?.revision ?? null,
    [parts],
  )
  const { pending, write } = useSessionWrites({
    revisionOf,
    // A write answers with the session it made, which is drawn at once.
    onSession: (board, next) => landWrite({ client, queryKey: reads.session(board).queryKey, answer: () => next }),
    reload: readSession,
  })

  // The agents, the trailers and the links of a worktree's board, and the
  // rows an epic's or a project's board reads its worktrees from, are not the
  // files, so none is held back by a drag unless the board names it.
  const busy = pending || dragging
  useStream({
    board: stream.board,
    on: { changed: readSessions, ...stream.on },
    hold: { held: busy, events: ['changed', ...stream.held], release: () => Promise.all([readSessions(), stream.release?.()]) },
  })

  const drawnRows = rows ?? []
  const sessions = new Map(parts.flatMap((part) => (part.session === null ? [] : [[part.key, part.session] as const])))
  const input: SeamInput = {
    place,
    leaf,
    data: { rows: drawnRows, now, sessions, archived: null, entries: new Map(), signalsOf },
    ready: !loading && rows !== null,
    held: dragging,
    capabilities,
    write,
    pending,
    readRows: () => reread({ client, queryKey: reads.worktrees().queryKey }),
    focusAgent,
    page: null,
    rules,
  }
  const { seam, tree } = useSessionSeam(input)
  const boardAt = (key: string): Path => tree.boardPath(place, key) ?? []
  const paths: PathsOf = {
    stage: (stage) => [...boardAt(parts[0]?.key ?? ''), idOf({ kind: 'stage', stage })],
    part: ({ key, stage }) => [...boardAt(key), idOf({ kind: 'stage', stage }), idOf({ kind: 'part', key, stage })],
    group: ({ key, stage, name }) => [
      ...boardAt(key),
      idOf({ kind: 'stage', stage }),
      ...(grouped ? [idOf({ kind: 'part', key, stage })] : []),
      idOf({ kind: 'group', key, stage, name }),
    ],
    item: ({ key, stage, group, id }) => [
      ...boardAt(key),
      idOf({ kind: 'stage', stage }),
      ...(grouped ? [idOf({ kind: 'part', key, stage })] : []),
      ...(group === null ? [] : [idOf({ kind: 'group', key, stage, name: group })]),
      idOf({ kind: 'item', key, id }),
    ],
  }

  const drawn: BoardPart[] = parts.flatMap((part) => {
    const row = tree.rowOfKey(part.key)
    return part.session === null
      ? []
      : [{ board: part.board, key: part.key, name: part.name, session: part.session, marks: row === null ? null : <Marks signals={signalsOf(row)} now={now} /> }]
  })

  return (
    <TooltipProvider>
      <Surface seam={seam}>
        {/* One tab per board, so a row of them is readable. React hoists this into the head. */}
        <title>{title}</title>
        {problems.length === 0 ? null : (
          <ul className="mb-4 space-y-1 text-sm text-destructive">
            {problems.map((problem) => <li key={problem} className="wrap-anywhere">{problem}</li>)}
          </ul>
        )}
        {loading || rows === null ? (
          <div className="grid grid-cols-5 gap-3">
            {stageNames.map((stage) => <Skeleton key={stage} className="h-64" />)}
          </div>
        ) : drawn.length > 0 ? (
          <BoardWrites drawn={drawn} grouped={grouped} pending={pending} paths={paths} write={write} onDraggingChange={setDragging} />
        ) : (
          <p className="py-20 text-center text-sm text-muted-foreground">
            {grouped ? 'No session in view could be loaded.' : 'The session files could not be loaded.'}
          </p>
        )}
      </Surface>
    </TooltipProvider>
  )
}

/**
 * The lanes' drops, inside the surface: a move says in the detail line why it
 * did not land, and a card dropped on another asks for its group's name in
 * the surface's name dialog, as the commands those drops stand for do.
 */
function BoardWrites({ drawn, grouped, pending, paths, write, onDraggingChange }: {
  drawn: readonly BoardPart[]
  grouped: boolean
  pending: boolean
  paths: PathsOf
  write: ReturnType<typeof useSessionWrites>['write']
  onDraggingChange: (dragging: boolean) => void
}) {
  const surface = useSurface()
  const groupDrop = ({ board, stage, onto, held }: GroupDrop) =>
    surface.askName({
      title: 'Gather a group',
      meaning: `“${onto.title}” and “${held.title}” will be gathered under one name, where “${onto.title}” stands. A name ${stage} already has adds them to that group.`,
      value: '',
      placeholder: 'What do these items have in common?',
      // The two are named on the files as they are read now: the group starts
      // where the card dropped on stands then, and the engine refuses the two
      // once they are no longer in one lane.
      confirm: (name) => write(board, '/api/group', { ids: [onto.id, held.id], name, at: onto.id }),
    })
  return (
    <Board
      parts={drawn}
      grouped={grouped}
      pending={pending}
      paths={paths}
      onMove={async (board, id, placement, revision) => {
        const refused = await write(board, '/api/move', { id, ...placement }, revision)
        if (refused !== null) surface.flash(refused)
      }}
      onGroupDrop={groupDrop}
      onDraggingChange={onDraggingChange}
    />
  )
}
