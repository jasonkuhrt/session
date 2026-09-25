import type { Stage } from '../../contract'
import { stageNames } from '../../contract'
import type { StageRange } from '../lib/epics'
import { cn } from '../lib/utils'
import { Explained } from './tip'

/** How tall the bar at the top of the page's range is, in pixels. */
const fullHeight = 16

/** How tall a bar is at the least while its stage holds anything, so one item beside many still shows. */
const leastHeight = 3

/**
 * The baseline: how tall the bar at the bottom of the range is, and a dim stub
 * for an empty stage, so the five places of the flow always show.
 */
const baseline = 2

/** How many items a count is, in words. */
const itemsIn = (count: number) => (count === 1 ? '1 item' : `${count} items`)

/**
 * How tall a count's bar is: its place in the page's range, from the baseline
 * at the fewest items any stage on the page holds to the full height at the
 * most. An empty stage stays at the baseline, and so does every bar when every
 * stage on the page holds the same number, since then no height says more
 * than another.
 */
const heightOf = (count: number, range: StageRange) => {
  if (count === 0 || range.most === range.least) return baseline
  const place = (count - range.least) / (range.most - range.least)
  return Math.max(leastHeight, Math.round(baseline + place * (fullHeight - baseline)))
}

/**
 * What a worktree's session holds, as a glyph rather than words: one bar per
 * stage in the flow's order, Triage to Execute, measured against the one range
 * every glyph on the page shares, so the same height is the same count on
 * every card, and a dim stub when the stage is empty. While a batch runs, the
 * Execute bar takes the accent. Every bar is the count the row already
 * carries, so nothing more is read for it, and its tip names each stage with
 * its count and the total.
 */
export function StageGlyph({ counts, executing, range }: {
  counts: Record<Stage, number>
  executing: string | null
  range: StageRange
}) {
  const total = stageNames.reduce((sum, stage) => sum + counts[stage], 0)
  return (
    <Explained meaning={<StageCounts counts={counts} executing={executing} total={total} />}>
      <span aria-hidden className="flex h-4 items-end gap-0.5">
        {stageNames.map(stage => {
          const count = counts[stage]
          const running = stage === 'Execute' && executing !== null && count > 0
          return (
            <span
              key={stage}
              className={cn('w-1 rounded-[1px]', count === 0 ? 'bg-muted-foreground/25' : running ? 'bg-primary' : 'bg-muted-foreground')}
              style={{ height: heightOf(count, range) }}
            />
          )
        })}
      </span>
    </Explained>
  )
}

/** The glyph in words: each stage and its count, the batch under way, and the total. */
function StageCounts({ counts, executing, total }: {
  counts: Record<Stage, number>
  executing: string | null
  total: number
}) {
  return (
    <span className="block space-y-0.5">
      {stageNames.map(stage => (
        <span key={stage} className="flex justify-between gap-6">
          <span>{stage}</span>
          <span className="tabular-nums">{counts[stage]}</span>
        </span>
      ))}
      {executing === null ? null : <span className="block pt-1">The batch “{executing}” is under way.</span>}
      <span className="block pt-1">{itemsIn(total)} in this worktree’s session.</span>
    </span>
  )
}
