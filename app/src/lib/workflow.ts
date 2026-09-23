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

/**
 * What a group is called in each stage and what it is there: in Queue and
 * Execute every item is in one, and a group there is a batch. The heading
 * sentence hangs off a group's heading on the board, the field sentence off the
 * label the item page gives the group's name.
 */
export const groupMeta: Record<Stage, { label: 'Group' | 'Batch'; heading: string; field: string }> = {
  TRIAGE: {
    label: 'Group',
    heading: 'A group: candidates in Triage gathered under one name.',
    field: 'The group this item is gathered in, in Triage.',
  },
  DESIGN: {
    label: 'Group',
    heading: 'A group: work in Design gathered under one name.',
    field: 'The group this item is gathered in, in Design.',
  },
  BATCH: {
    label: 'Group',
    heading: 'A proposed batch: settled items gathered under one name, so the batch they could make shows before it is queued.',
    field: 'The proposed batch this item is gathered in, in Batch.',
  },
  QUEUE: {
    label: 'Batch',
    heading: 'A batch waiting to start: these items start together, under this name.',
    field: 'The batch this item was queued in.',
  },
  EXECUTE: {
    label: 'Batch',
    heading: 'The batch under way: these items were started together.',
    field: 'The batch this item was started in.',
  },
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
