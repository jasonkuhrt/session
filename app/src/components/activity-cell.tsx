import type { Activity } from '../../contract'
import { absoluteTime, relativeTime } from '../lib/format'

/**
 * What happened here last, and what left the moment behind, so a status change
 * and an item file are never read as the same thing. The cell names who; the
 * sentence behind it says exactly what they did and when.
 */

/** Who did the newest thing here. */
const activityWho: Record<Activity['kind'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  items: 'Items',
}

/** The same fact as a sentence, with the exact moment in it. */
const activityMeaning = (activity: Activity) => {
  const at = absoluteTime(activity.at)
  if (activity.kind === 'claude') return `A Claude Code session last changed status at ${at}.`
  if (activity.kind === 'codex') return `A Codex thread was last updated at ${at}.`
  return `An item file was last written at ${at}.`
}

export function ActivityCell({ activity, now }: { activity: Activity | null; now: number }) {
  if (activity === null) return <span title="Nothing has happened in this worktree yet.">—</span>
  return (
    <span title={activityMeaning(activity)}>
      {activityWho[activity.kind]} · {relativeTime(activity.at, now)}
    </span>
  )
}
