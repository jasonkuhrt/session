import type { Stage } from '../../contract'
import { stageNames } from '../../contract'
import { cn } from '../lib/utils'
import { Explained } from './tip'

/** How tall the bar of the fullest stage is, in pixels. */
const fullHeight = 16

/** How tall a bar is at the least while its stage holds anything, so one item beside many still shows. */
const leastHeight = 3

/** How tall the bar of an empty stage is: a dim stub, so the five places of the flow always show. */
const emptyHeight = 2

/** How many items a count is, in words. */
const itemsIn = (count: number) => (count === 1 ? '1 item' : `${count} items`)

/**
 * What a worktree's session holds, as a glyph rather than words: one bar per
 * stage in the flow's order, Triage to Execute, as tall as its share of the
 * fullest stage and a dim stub when the stage is empty, then the total. While
 * a batch runs, the Execute bar takes the accent. Every bar is the count the
 * row already carries, so nothing more is read for it, and its tip names each
 * stage with its count.
 */
export function StageGlyph({ counts, executing }: { counts: Record<Stage, number>; executing: string | null }) {
  const fullest = Math.max(...stageNames.map(stage => counts[stage]))
  const total = stageNames.reduce((sum, stage) => sum + counts[stage], 0)
  return (
    <Explained meaning={<StageCounts counts={counts} executing={executing} total={total} />} className="gap-1.5">
      <span aria-hidden className="flex h-4 items-end gap-0.5">
        {stageNames.map(stage => {
          const count = counts[stage]
          const running = stage === 'Execute' && executing !== null && count > 0
          return (
            <span
              key={stage}
              className={cn('w-1 rounded-[1px]', count === 0 ? 'bg-muted-foreground/25' : running ? 'bg-primary' : 'bg-muted-foreground')}
              style={{ height: count === 0 ? emptyHeight : Math.max(leastHeight, Math.round((count / fullest) * fullHeight)) }}
            />
          )
        })}
      </span>
      <span className={cn('min-w-[2ch] text-right text-xs tabular-nums', total === 0 ? 'text-muted-foreground' : 'text-foreground')}>
        {total}
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
