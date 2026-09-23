import type { PullRequest } from '../../contract'

/**
 * How the header words a pull request. Each word on the chip is gh's own,
 * lowercased to sit quietly in a line of text, and the sentence behind it
 * names the exact word gh gave, so nothing on the chip is a word gh did not
 * say.
 */

/** Where the pull request stands: `draft` for an open draft, otherwise gh's state. */
export const stateWord = (pr: PullRequest) => (pr.state === 'OPEN' && pr.isDraft ? 'draft' : pr.state.toLowerCase())

/** gh's review decision as words: `CHANGES_REQUESTED` reads `changes requested`. */
export const reviewWord = (decision: string) => decision.toLowerCase().replaceAll('_', ' ')

const stateMeanings: Record<PullRequest['state'], string> = {
  OPEN: 'it is open',
  MERGED: 'it has been merged',
  CLOSED: 'it was closed without being merged',
}

/** What the state word means, naming the word gh gave. */
export const stateMeaning = (pr: PullRequest) =>
  pr.state === 'OPEN' && pr.isDraft
    ? 'gh reports it OPEN and a draft: it is open, and marked as not ready for review.'
    : `gh reports it ${pr.state}: ${stateMeanings[pr.state]}.`

const reviewMeanings: Record<string, string> = {
  APPROVED: 'the reviews it needs approve it',
  CHANGES_REQUESTED: 'a reviewer has asked for changes',
  REVIEW_REQUIRED: 'it needs an approving review before it can merge',
}

/**
 * What the review decision means, naming the word gh gave. gh gives none when
 * the repository asks for no review, and a word this build has never heard of
 * is still named rather than folded into one it knows.
 */
export const reviewMeaning = (decision: string | null) => {
  if (decision === null) return 'gh reports no review decision.'
  const known = reviewMeanings[decision]
  return known === undefined
    ? `gh reports the review decision ${decision}, a decision this build does not know.`
    : `gh reports the review decision ${decision}: ${known}.`
}

/**
 * The one glyph a chip carries for its checks, and the sentence it stands
 * for, with the three counts in it so the glyph hides nothing. A failure
 * outranks a check still to finish, which outranks a pass; a pull request gh
 * reports no checks for gets no glyph at all.
 */
export const checksMark = ({ passed, failed, pending }: PullRequest['checks']) => {
  const counts = `${passed} passed, ${failed} failed, ${pending} pending`
  if (failed > 0) return { kind: 'failed', meaning: `A check failed: ${counts}.` } as const
  if (pending > 0) return { kind: 'pending', meaning: `Some checks have not finished: ${counts}.` } as const
  if (passed > 0) return { kind: 'passed', meaning: `Every check passed: ${counts}.` } as const
  return null
}
