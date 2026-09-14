import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { requiredSections, sectionHasContent } from '../../stage-rules'

/**
 * What each stage is called and what it holds. The hint is a sentence because
 * it is the only explanation either surface gives: the board hangs it off the
 * lane's heading, the index off its column, and the item page off the move it
 * would make.
 */
export const stageMeta: Record<Stage, { label: string; hint: string }> = {
  TRIAGE: { label: 'Triage', hint: 'Candidates not yet accepted for work; decide here what to pursue.' },
  DESIGN: { label: 'Design', hint: 'Accepted work with open design questions; settle them here before it can be batched.' },
  BATCH: { label: 'Batch', hint: 'Settled work, ready to be grouped into a batch.' },
  QUEUE: { label: 'Queue', hint: 'Batches waiting to start.' },
  EXECUTE: { label: 'Execute', hint: 'The batch under way; its items leave only by being completed.' },
}

export function isStage(value: unknown): value is Stage {
  return stageNames.some(stage => stage === value)
}

// Items enter Execute only by starting the next queued batch, and enter Queue
// only by composing one in Batch. Every other move is a stage change whose
// target sections must already be written.
export function moveAvailability(item: Item, current: Stage, target: Stage) {
  if (target === current) return { enabled: false, reason: `Already in ${stageMeta[target].label}` }
  if (current === 'EXECUTE') return { enabled: false, reason: 'Complete this execution item before changing its stage' }
  if (target === 'EXECUTE') return { enabled: false, reason: 'Start the next queued batch' }
  if (target === 'QUEUE') return { enabled: false, reason: 'Select it in Batch and queue a batch' }
  const missing = requiredSections[target].filter(section => !sectionHasContent(item.body, section))
  if (missing.length === 0) return { enabled: true, reason: null }
  if (target === 'BATCH') return { enabled: false, reason: 'Settle the outcome and acceptance with your agent first' }
  if (target === 'DESIGN') return { enabled: false, reason: 'Write the open questions with your agent first' }
  return { enabled: false, reason: 'Write the decision with your agent first' }
}
