import type { AgentsSummary } from '../../contract'
import { loadedCount, statusCounts, waitingStatus } from '../lib/agents'
import { cn } from '../lib/utils'

/**
 * The counts for one worktree's row. Only what is there: a status with no
 * sessions is absent, and Codex is named only while a thread is open in an app.
 */
export function AgentsCell({ agents }: { agents: AgentsSummary }) {
  const counts = statusCounts(agents.claude)
  const open = loadedCount(agents.codex)
  if (counts.length === 0 && open === 0) return <span className="text-muted-foreground">—</span>

  const parts = counts.map((entry) => ({
    key: entry.status,
    text: `${entry.count} ${entry.status}`,
    accent: entry.status === waitingStatus,
  }))
  if (open > 0) parts.push({ key: 'codex', text: `${open} Codex open`, accent: false })

  return (
    <span className="flex flex-wrap items-baseline whitespace-nowrap text-muted-foreground">
      {parts.map((part, index) => (
        // The separator belongs to the part after it, so a wrap never leaves
        // one dangling at the end of a line.
        <span key={part.key} className={cn('tabular-nums', part.accent && 'font-medium text-amber-400')}>
          {index === 0 ? null : <span aria-hidden className="text-muted-foreground/40">&nbsp;·&nbsp;</span>}
          {part.text}
        </span>
      ))}
    </span>
  )
}
