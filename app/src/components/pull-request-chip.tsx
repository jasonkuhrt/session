import { Check, CircleDashed, X } from 'lucide-react'

import type { PullRequest } from '../../contract'
import { absoluteTime } from '../lib/format'
import { checksMark, reviewMeaning, reviewWord, stateMeaning, stateWord } from '../lib/links'
import { openOnceOnClick } from '../lib/open-once'
import { Tip } from './tip'
import { Badge } from './ui/badge'

/** The glyph for each way the checks can stand; drawn in the chip's own muted text, never in a colour. */
const glyphs = {
  failed: X,
  pending: CircleDashed,
  passed: Check,
} as const

/**
 * The pull request for a worktree's branch, as one chip that is a link to it,
 * the same in a board's header and on the index's row: the number, gh's state
 * word and review decision, and one glyph for its checks, with every sentence
 * behind them one hover away. A click opens the pull request once: the tab it
 * already has comes forward instead of another. It carries no colour, because
 * the lanes are where anything that needs you is shown; this only says where
 * the work stands on GitHub.
 */
export function PullRequestChip({ pr, reportedAt }: { pr: PullRequest; reportedAt: string }) {
  const mark = checksMark(pr.checks)
  const Glyph = mark === null ? null : glyphs[mark.kind]
  return (
    <Tip
      meaning={
        <span className="block space-y-1">
          <span className="block font-medium">#{pr.number} {pr.title}</span>
          <span className="block">{stateMeaning(pr)}</span>
          <span className="block">{reviewMeaning(pr.reviewDecision)}</span>
          <span className="block">{mark === null ? 'gh reports no checks on it.' : mark.meaning}</span>
          <span className="block">gh was asked at {absoluteTime(reportedAt)}.</span>
          <span className="block">Brings forward the GitHub tab this page opened for it, or opens one.</span>
        </span>
      }
      render={
        <Badge
          variant="outline"
          render={
            <a
              aria-label={`Pull request #${pr.number}: ${pr.title}`}
              href={pr.url}
              rel="noreferrer"
              target="_blank"
              onClick={openOnceOnClick(pr.url)}
            />
          }
        />
      }
    >
      <span>#{pr.number}</span>
      <span className="font-normal text-muted-foreground">
        · {stateWord(pr)}{pr.reviewDecision === null ? null : ` · ${reviewWord(pr.reviewDecision)}`}
      </span>
      {Glyph === null ? null : <Glyph aria-hidden className="text-muted-foreground" />}
    </Tip>
  )
}
