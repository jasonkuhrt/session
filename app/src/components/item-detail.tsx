import { CheckCircle2 } from 'lucide-react'

import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
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
  if (!item || !stage) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[42rem] max-w-[42rem] sm:max-w-[42rem]">
        <SheetHeader className="gap-4 border-b">
          {item.group ? <p className="text-sm font-medium text-muted-foreground">{item.group}</p> : null}
          <div className="flex items-baseline gap-2 pr-10">
            <SheetTitle className="text-xl">{item.title}</SheetTitle>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.id}</span>
          </div>

          <TooltipProvider>
            <ToggleGroup
              className="grid w-full grid-cols-4"
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
                    <TooltipTrigger render={<span className="inline-flex w-full" />}>
                      <ToggleGroupItem
                        className="w-full"
                        value={candidate}
                        disabled={!current && unavailable}
                      >
                        {stageMeta[candidate].label}
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent>{current ? stageMeta[candidate].hint : explanation}</TooltipContent>
                  </Tooltip>
                )
              })}
            </ToggleGroup>
          </TooltipProvider>

          {stage === 'EXECUTE' ? (
            <Button className="w-fit" onClick={onComplete} disabled={pending}>
              <CheckCircle2 /> Complete work
            </Button>
          ) : null}

          {notice ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{notice}</p> : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <Markdown collapseEvidence>{item.body || '_No detail has been written yet._'}</Markdown>
        </div>
      </SheetContent>
    </Sheet>
  )
}
