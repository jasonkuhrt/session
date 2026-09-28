import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { emptySections } from '../../stage-rules'

/**
 * What each stage holds. A stage is shown by its own name, as the files and
 * the CLI write it, so there is no second spelling to drift from it. The hint
 * is a sentence because it is the only explanation either surface gives: the
 * board hangs it off the lane's heading, the index off its column, and the
 * item page off the move it would make.
 */
export const stageHint: Record<Stage, string> = {
  Triage: 'Candidates not yet accepted for work; decide here what to pursue.',
  Design: 'Accepted work with open design questions; settle them here before it can be batched.',
  Batch: 'Settled work, ready to be grouped into a batch.',
  Queue: 'Batches waiting to start.',
  Execute: 'The batch under way; its items leave only by being completed.',
}

/**
 * What a group is in each stage, the sentence its heading carries on the
 * board, its step of the path line and its detail line: in Queue and Execute
 * every item is in one, and a group there is a batch.
 */
export const groupMeaning: Record<Stage, string> = {
  Triage: 'A group: candidates in Triage gathered under one name.',
  Design: 'A group: work in Design gathered under one name.',
  Batch: 'A proposed batch: settled items gathered under one name, so the batch they could make shows before it is queued.',
  Queue: 'A batch waiting to start: these items start together, under this name.',
  Execute: 'The batch under way: these items were started together.',
}

/**
 * What the word `None` says where it is all a required section holds, as the
 * item page draws it there, very dim.
 */
export const noneMeaning =
  'Intentionally empty: None, alone in a section a stage requires, says there is nothing to write here, and the stage accepts it.'

export function isStage(value: unknown): value is Stage {
  return stageNames.some(stage => stage === value)
}

// Items enter Execute only by starting the next queued batch, and enter Queue
// only by composing one in Batch. Every other move is a stage change whose
// target sections must already be written.
export function moveAvailability(item: Item, current: Stage, target: Stage) {
  if (target === current) return { enabled: false, reason: `Already in ${target}` }
  if (current === 'Execute') return { enabled: false, reason: 'Complete this execution item before changing its stage' }
  if (target === 'Execute') return { enabled: false, reason: 'Start the next queued batch' }
  if (target === 'Queue') return { enabled: false, reason: 'Select it in Batch and queue a batch' }
  const missing = emptySections(target, item.body)
  if (missing.length === 0) return { enabled: true, reason: null }
  if (target === 'Batch') return { enabled: false, reason: 'Settle the outcome and acceptance with your agent first' }
  if (target === 'Design') return { enabled: false, reason: 'Write the open questions with your agent first' }
  return { enabled: false, reason: 'Write the decision with your agent first' }
}
