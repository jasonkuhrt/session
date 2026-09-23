import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { isStage, moveAvailability, stageMeta } from '../lib/workflow'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

/**
 * Where this item is, and where it may go from here. The five stages are a
 * fixed set that shows the shape of the flow, so a stage it cannot reach is
 * still drawn, very dim, and says on hover what has to happen first: the rule
 * that refused the move is the thing the reader is told, and nobody has to
 * remember the flow to see it.
 */
export function StageControl({
  item,
  stage,
  pending,
  onMove,
}: {
  item: Item
  stage: Stage
  pending: boolean
  onMove: (to: Stage) => void
}) {
  return (
    <TooltipProvider>
      <ToggleGroup
        className="grid w-full grid-cols-5"
        spacing={0}
        variant="outline"
        value={[stage]}
        onValueChange={(value) => {
          const target = value[0]
          if (isStage(target) && moveAvailability(item, stage, target).enabled && !pending) onMove(target)
        }}
      >
        {stageNames.map((candidate) => {
          const current = candidate === stage
          const availability = moveAvailability(item, stage, candidate)
          const unavailable = pending || !availability.enabled
          const explanation = pending
            ? 'Another update is in progress'
            : availability.reason ?? stageMeta[candidate].hint

          return (
            <Tooltip key={candidate}>
              <TooltipTrigger
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
                {stageMeta[candidate].label}
              </TooltipTrigger>
              <TooltipContent>{current ? stageMeta[candidate].hint : explanation}</TooltipContent>
            </Tooltip>
          )
        })}
      </ToggleGroup>
    </TooltipProvider>
  )
}
