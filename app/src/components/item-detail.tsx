import { CheckCircle2 } from 'lucide-react'
import * as React from 'react'

import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { useLastPresent } from '../lib/overlay'
import { isStage, moveAvailability, stageMeta } from '../lib/workflow'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { Markdown } from './markdown'

export function DetailDialog({
  item,
  stage,
  open,
  pending,
  notice,
  onOpenChange,
  onMove,
  onComplete,
}: {
  item: Item | null
  stage: Stage | null
  open: boolean
  pending: boolean
  notice: string | null
  onOpenChange: (open: boolean) => void
  onMove: (to: Stage) => void
  onComplete: () => void
}) {
  // The board clears the selection as the sheet closes, so the sheet reads the
  // last item it held and slides out with it rather than vanishing.
  const subject = React.useMemo(() => (item && stage ? { item, stage } : null), [item, stage])
  const held = useLastPresent(subject)
  if (!held) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[42rem] max-w-[42rem] sm:max-w-[42rem]">
        <SheetHeader className="gap-4 border-b">
          {held.item.batch ? <p className="text-sm font-medium text-muted-foreground">{held.item.batch}</p> : null}
          <div className="flex items-baseline gap-2 pr-10">
            <SheetTitle className="text-xl">{held.item.title}</SheetTitle>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{held.item.id}</span>
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">{held.item.path}</p>

          <TooltipProvider>
            <ToggleGroup
              className="grid w-full grid-cols-5"
              spacing={0}
              variant="outline"
              value={[held.stage]}
              onValueChange={(value) => {
                const target = value[0]
                if (isStage(target) && moveAvailability(held.item, held.stage, target).enabled && !pending) onMove(target)
              }}
            >
              {stageNames.map((candidate) => {
                const current = candidate === held.stage
                const availability = moveAvailability(held.item, held.stage, candidate)
                const unavailable = pending || !availability.enabled
                const explanation = pending
                  ? 'Another update is in progress'
                  : availability.reason ?? stageMeta[candidate].hint

                return (
                  <Tooltip key={candidate}>
                    <TooltipTrigger
                      render={
                        <ToggleGroupItem
                          className="w-full aria-disabled:opacity-50"
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

          {held.stage === 'EXECUTE' ? (
            <Button className="w-fit" onClick={onComplete} disabled={pending}>
              <CheckCircle2 /> Complete work
            </Button>
          ) : null}

          {notice ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{notice}</p> : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <Markdown collapseEvidence>{held.item.body || '_No detail has been written yet._'}</Markdown>
        </div>
      </SheetContent>
    </Sheet>
  )
}
