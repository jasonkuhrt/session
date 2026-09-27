import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import type { Item, Session, StreamEvent } from '../../contract'
import { stageNames } from '../../contract'
import { landWrite, reads, reread } from '../lib/reads'
import { boardColumns, useSelection } from '../lib/selection'
import type { SessionsOnScreen } from '../lib/session-mutations'
import { refreshedNotice, useSessionMutations } from '../lib/session-mutations'
import { useStream } from '../lib/stream'
import type { BoardPart } from './board'
import { Board } from './board'
import { KeyPage, SelectionKeys, type StepKeys } from './keys'
import { ScrollRestored } from './scroll-restored'
import type { BoardNameRequest } from './session-dialogs'
import { CompleteDialog, NameDialog } from './session-dialogs'
import { Alert, AlertDescription } from './ui/alert'
import { Skeleton } from './ui/skeleton'
import type { Choosing } from './workflow-card'

/**
 * One worktree's part of a board, before its session is known: its board's
 * prefix, the worktree's name, which its pages are addressed by, and its
 * session once the page has read it since it mounted.
 */
type SurfacePart = { readonly board: string; readonly name: string; readonly session: Session | null }

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

/** The steps of the selection on a board, whose lanes stand side by side. */
const boardSteps: StepKeys = {
  next: { name: 'next', sentence: 'Select the item below, in the same lane.' },
  previous: { name: 'previous', sentence: 'Select the item above, in the same lane.' },
  left: { name: 'left', sentence: 'Select an item in the nearest lane to the left.' },
  right: { name: 'right', sentence: 'Select an item in the nearest lane to the right.' },
}

/**
 * Every board's page: what it draws above its lanes, then what could not be
 * read or written, the lanes of every worktree in view, and the dialogs that
 * name a group or a batch and complete an item, with the keys that step
 * through the lanes' cards and act on the one selected. Every write goes to
 * the board of the worktree it changes, with that session's revision, so a
 * board of many worktrees never crosses from one to another. The daemon
 * pushes `changed` once a burst of writes under a `.session` settles; the
 * board never polls. A read of the sessions waits while a write is in flight
 * or a card is being dragged, because the sortable library owns placement
 * until drop, and one read catches up when that ends; no key acts during a
 * drag.
 */
export function BoardSurface({ head, parts, grouped, loading, problems, stream }: {
  /** What the page draws above the lanes: its title and header, and on a worktree's board its agents and trailers. */
  readonly head: React.ReactNode
  readonly parts: readonly SurfacePart[]
  /** Whether each lane draws every worktree's part under its name: on an epic's board and a project's. */
  readonly grouped: boolean
  /** Whether the first read of what the lanes draw has yet to land. */
  readonly loading: boolean
  /** What could not be read, a sentence each; a write that failed says so in their place until it is resolved. */
  readonly problems: readonly string[]
  readonly stream: SurfaceStream
}) {
  const client = useQueryClient()
  const [dragging, setDragging] = React.useState(false)
  const [naming, setNaming] = React.useState<BoardNameRequest | null>(null)
  const [completing, setCompleting] = React.useState<{ readonly board: string; readonly item: Item } | null>(null)
  const [choosing, setChoosing] = React.useState<Choosing>(null)
  const [chosen, setChosen] = React.useState<Set<string>>(new Set())

  const sessions: SessionsOnScreen = new Map(parts.map(part => [part.board, part.session]))
  const readSession = React.useCallback((board: string) => reread({ client, queryKey: reads.session(board).queryKey }), [client])
  const readSessions = () => Promise.all(parts.map(part => readSession(part.board)))
  const sessionsRead = (): SessionsOnScreen =>
    new Map(parts.map(part => [part.board, client.getQueryData(reads.session(part.board).queryKey) ?? null]))

  const { pending, failure, refreshed, mutate, follow } = useSessionMutations({
    sessions,
    // A write answers with the session it made, which is drawn at once.
    onSession: (board, next) => landWrite({ client, queryKey: reads.session(board).queryKey, answer: () => next }),
    reload: readSession,
  })

  // The agents overlay, the trailers and the links of a worktree's board, and
  // the rows an epic's or a project's board reads its worktrees from, are not
  // the files, so none is held back by a drag unless the board names it.
  const busy = pending || dragging
  useStream({
    board: stream.board,
    on: {
      changed: () => follow(async () => {
        await readSessions()
        return sessionsRead()
      }),
      ...stream.on,
    },
    hold: {
      held: busy,
      events: ['changed', ...stream.held],
      release: () => Promise.all([readSessions(), stream.release?.()]),
    },
  })

  // Only the lane that is choosing has chosen items; one that has moved out of
  // it since is no longer chosen.
  const choosingStage = choosing === null
    ? undefined
    : sessions.get(choosing.board)?.stages.find(stage => stage.stage === choosing.stage)
  const choosableIds = new Set(choosingStage?.items.map(item => item.id))
  const chosenIds = new Set([...chosen].filter(id => choosableIds.has(id)))
  const choose = (next: Choosing) => {
    setChoosing(next)
    setChosen(new Set())
  }
  // A lane left with nothing to choose stops choosing, and an item that has
  // left the lane is not chosen again if it comes back.
  if (choosing !== null && !loading && choosableIds.size === 0) choose(null)
  else if (chosenIds.size !== chosen.size) setChosen(chosenIds)

  const drawn: BoardPart[] = parts.flatMap(part => (part.session === null ? [] : [{ board: part.board, name: part.name, session: part.session }]))
  // The lanes' cards as the board draws them, which the keys step through; a
  // selected card that is no longer on the board is no longer selected.
  const columns = boardColumns(drawn)
  const { selected, select } = useSelection(columns)

  return (
    <KeyPage scope="board" held={dragging} className="min-h-dvh bg-background text-foreground">
      {head}
      <SelectionKeys columns={columns} selected={selected} onSelect={select} steps={boardSteps} />
      <ScrollRestored ready={!loading} />
      <Problems failure={failure} problems={problems} />
      {refreshed ? <p className="mx-6 mt-4 text-sm text-muted-foreground">{refreshedNotice}</p> : null}
      <main className="overflow-x-auto p-6">
        {loading ? (
          <div className="grid grid-cols-5 gap-4">
            {stageNames.map(stage => <Skeleton key={stage} className="h-64" />)}
          </div>
        ) : drawn.length > 0 ? (
          <Board
            parts={drawn}
            grouped={grouped}
            pending={pending}
            choosing={choosing}
            onChoose={choose}
            chosenIds={chosenIds}
            selectedId={selected}
            onChosenChange={(id, isChosen) => setChosen(current => {
              const next = new Set(current)
              if (isChosen) next.add(id)
              else next.delete(id)
              return next
            })}
            onGroup={(board, stage, ids) => setNaming({ kind: 'group', board, stage, ids })}
            onQueue={(board, ids, group) => setNaming({ kind: 'batch', board, ids, group })}
            onUngroup={(board, ids) => void mutate(board, '/api/ungroup', { ids })}
            onStart={board => void mutate(board, '/api/start', {})}
            onComplete={(board, item) => setCompleting({ board, item })}
            onStage={(board, item, to) => mutate(board, '/api/move', { id: item.id, to })}
            onMove={(board, id, placement, revision) => mutate(board, '/api/move', { id, ...placement }, revision)}
            onGroupDrop={({ board, stage, onto, held }) =>
              setNaming({ kind: 'drop', board, stage, ids: [onto.id, held.id], titles: [onto.title, held.title] })}
            onDraggingChange={setDragging}
          />
        ) : (
          <p className="py-20 text-center text-muted-foreground">
            {grouped ? 'No session in view could be loaded.' : 'The session files could not be loaded.'}
          </p>
        )}
      </main>

      <NameDialog
        request={naming}
        pending={pending}
        onClose={() => setNaming(null)}
        onName={async name => {
          if (naming === null) return
          // A card dropped on another makes a group of the two, the one
          // dropped on first and in its place, on the files as they are read
          // now: the place is that card's wherever it stands by then, and the
          // engine refuses the two once they are no longer in one lane.
          if (naming.kind === 'drop') {
            if (await mutate(naming.board, '/api/group', { ids: naming.ids, name, at: naming.ids[0] })) setNaming(null)
            return
          }
          // A name the lane's choice asked for names what is still chosen,
          // since the files may have moved under the open dialog, and ends
          // the choice; one a group's heading asked for names that group and
          // leaves any lane's choice as it is.
          const fromChoice = naming.kind === 'group' || naming.group === null
          const ids = fromChoice ? naming.ids.filter(id => chosenIds.has(id)) : naming.ids
          if (ids.length === 0) {
            choose(null)
            setNaming(null)
            return
          }
          const path = naming.kind === 'group' ? '/api/group' : '/api/batch'
          if (await mutate(naming.board, path, { ids, name })) {
            if (fromChoice) choose(null)
            setNaming(null)
          }
        }}
      />

      <CompleteDialog
        item={completing?.item ?? null}
        pending={pending}
        onOpenChange={(open) => !open && setCompleting(null)}
        onComplete={async () => {
          if (completing && await mutate(completing.board, '/api/complete', { id: completing.item.id })) setCompleting(null)
        }}
      />
    </KeyPage>
  )
}

/**
 * A write that failed and what could not be read read differently from a
 * write the board recovered from: one is a problem to look at, the other is
 * the board saying it caught up. A write's failure stands in place of the
 * reads' until the next write or pushed change.
 */
function Problems({ failure, problems }: { failure: string | null; problems: readonly string[] }) {
  const [only] = problems
  if (failure === null && only === undefined) return null
  return (
    <Alert variant="destructive" className="mx-6 mt-4 w-auto">
      <AlertDescription>
        {failure ?? (problems.length === 1 ? only : (
          <ul className="space-y-1">
            {problems.map(problem => <li key={problem} className="wrap-anywhere">{problem}</li>)}
          </ul>
        ))}
      </AlertDescription>
    </Alert>
  )
}
