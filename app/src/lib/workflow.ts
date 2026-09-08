import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { requiredSections, sectionHasContent } from '../../stage-rules'

export const stageMeta: Record<Stage, { label: string; hint: string }> = {
  TRIAGE: { label: 'Triage', hint: 'Decide what to pursue' },
  DESIGN: { label: 'Design', hint: 'Resolve open questions' },
  BATCH: { label: 'Batch', hint: 'Group settled work' },
  EXECUTE: { label: 'Execute', hint: 'Current batch' },
}

export function isStage(value: unknown): value is Stage {
  return stageNames.some(stage => stage === value)
}

export function moveAvailability(item: Item, current: Stage, target: Stage) {
  if (target === current) return { enabled: false, reason: `Already in ${stageMeta[target].label}` }
  if (current === 'EXECUTE') return { enabled: false, reason: 'Complete this execution item before changing its stage' }
  if (target === 'EXECUTE') return { enabled: false, reason: 'Start an execution batch from Batch' }
  const missing = requiredSections[target].filter(section => !sectionHasContent(item.body, section))
  if (missing.length === 0) return { enabled: true, reason: null }
  if (target === 'BATCH') return { enabled: false, reason: 'Settle the outcome and acceptance with your agent first' }
  if (target === 'DESIGN') return { enabled: false, reason: 'Write the open questions with your agent first' }
  return { enabled: false, reason: 'Write the decision with your agent first' }
}
