import type { Stage } from '../../contract'
import { Tip } from './tip'
import { Button } from './ui/button'
import type { LaneActions } from './lane'

/**
 * The ways into choosing a lane's cards, each named for what the chosen cards
 * become: a group in any lane where an item may be in no group, and a batch
 * for Queue from Batch. They choose among one worktree's cards, the board's
 * own on a worktree's board and the part's under its name on an epic's or a
 * project's, since a group and a batch are each one session's.
 */
export function ChooseEntries({ board, stage, pending, onChoose }: Pick<LaneActions, 'pending' | 'onChoose'> & {
  board: string
  stage: Stage
}) {
  return (
    <>
      <Tip
        meaning={`Choose items of ${stage} to name as a group.`}
        render={<Button variant="ghost" size="xs" disabled={pending} onClick={() => onChoose({ board, stage, purpose: 'group' })} />}
      >
        Group…
      </Tip>
      {stage === 'Batch' ? (
        <Tip
          meaning="Choose items of Batch to name as a batch and append to Queue."
          render={<Button variant="ghost" size="xs" disabled={pending} onClick={() => onChoose({ board, stage, purpose: 'batch' })} />}
        >
          Queue batch…
        </Tip>
      ) : null}
    </>
  )
}

/**
 * While the lane is choosing: what the chosen cards become, once there is one,
 * and the way out. Until a card is chosen the lane says what to do instead.
 */
function ChoosingControls({ board, stage, purpose, chosen, pending, onGroup, onQueue, onChoose }: Pick<
  LaneActions,
  'pending' | 'onGroup' | 'onQueue' | 'onChoose'
> & {
  board: string
  stage: Stage
  purpose: 'group' | 'batch'
  /** The lane's chosen items, in lane order. */
  chosen: readonly string[]
}) {
  return (
    <div className="flex items-center gap-2">
      {chosen.length === 0
        ? <p className="flex-1 text-sm text-muted-foreground">Choose the items for the {purpose}.</p>
        : purpose === 'group'
        ? (
          <Tip
            meaning={`Name the chosen items as a group in ${stage}.`}
            render={<Button variant="outline" className="flex-1" disabled={pending} onClick={() => onGroup(board, stage, chosen)} />}
          >
            Group ({chosen.length})
          </Tip>
        )
        : (
          <Tip
            meaning="Name the chosen items as a batch and append it to Queue."
            render={<Button variant="outline" className="flex-1" disabled={pending} onClick={() => onQueue(board, chosen, null)} />}
          >
            Queue batch ({chosen.length})
          </Tip>
        )}
      <Tip meaning="Stop choosing. Nothing changes." render={<Button variant="ghost" onClick={() => onChoose(null)} />}>
        Cancel
      </Tip>
    </div>
  )
}

/**
 * What one worktree's part of a lane can do while it is choosing, and Queue's
 * start. A control appears when it can act. An empty choice and an occupied
 * Execute are both visible in the lanes themselves, so a disabled button
 * carrying the reason would say a second time what the board already shows.
 */
export function LaneControls({ board, stage, choosing, chosen, count, executeOccupied, pending, onGroup, onQueue, onChoose, onStart }: LaneActions & {
  board: string
  stage: Stage
  /** The lane's chosen items, in lane order. */
  chosen: readonly string[]
  count: number
  executeOccupied: boolean
}) {
  const canStart = stage === 'Queue' && count > 0 && !executeOccupied
  return (
    <>
      {choosing?.board === board && choosing.stage === stage ? (
        <ChoosingControls
          board={board}
          stage={stage}
          purpose={choosing.purpose}
          chosen={chosen}
          pending={pending}
          onGroup={onGroup}
          onQueue={onQueue}
          onChoose={onChoose}
        />
      ) : null}
      {canStart ? (
        <Tip
          meaning="Move the first queued batch into Execute."
          render={<Button variant="outline" className="w-full" disabled={pending} onClick={() => onStart(board)} />}
        >
          Start next batch
        </Tip>
      ) : null}
    </>
  )
}
