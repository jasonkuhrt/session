import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { isStage, moveAvailability, stageHint } from '../lib/workflow'
import { Tip } from './tip'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { TooltipProvider } from './ui/tooltip'

/** Why no stage can be reached from an archived item's page. */
const archived = { enabled: false, reason: 'It is archived, so no stage holds it.' } as const

/**
 * Where this item is, and where it may go from here. The five stages are a
 * fixed set that shows the shape of the flow, so a stage it cannot reach is
 * still drawn, very dim, and says on hover what has to happen first: the rule
 * that refused the move is the thing the reader is told, and nobody has to
 * remember the flow to see it. An archived item is in none of them, so all
 * five are dim.
 */
export function StageControl({
  item,
  stage,
  pending,
  onMove,
}: {
  item: Item
  /** The stage the item is filed in; null once it is archived. */
  stage: Stage | null
  pending: boolean
  /** Absent for an archived item, which has nowhere to go. */
  onMove?: ((to: Stage) => void) | undefined
}) {
  return (
    <TooltipProvider>
      <ToggleGroup
        className="grid w-full grid-cols-5"
        spacing={0}
        variant="outline"
        value={stage === null ? [] : [stage]}
        onValueChange={(value) => {
          const target = value[0]
          if (stage === null || !isStage(target) || pending) return
          if (moveAvailability(item, stage, target).enabled) onMove?.(target)
        }}
      >
        {stageNames.map((candidate) => {
          const current = candidate === stage
          const availability = stage === null ? archived : moveAvailability(item, stage, candidate)
          const unavailable = pending || !availability.enabled
          const explanation = pending
            ? 'Another update is in progress'
            : availability.reason ?? stageHint[candidate]

          return (
            <Tip
              key={candidate}
              meaning={current ? stageHint[candidate] : explanation}
              render={
                <ToggleGroupItem
                  className="w-full aria-disabled:opacity-25"
                  value={candidate}
                  aria-disabled={!current && unavailable}
                  onPressedChange={(_pressed, details) => {
                    if (!current && unavailable) details.cancel()
                  }}
                />
              }
            >
              {candidate}
            </Tip>
          )
        })}
      </ToggleGroup>
    </TooltipProvider>
  )
}
