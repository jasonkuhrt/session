import type { TrailerProblem } from '../../contract'
import { doneTrailer } from '../../contract'

/**
 * How the board and the index word a trailer that could not be acted on. Both
 * read these, so a problem never reads one way in one place and another way in
 * the other.
 */

/** A commit as a person refers to it: its short hash and its subject. */
const commitName = (problem: TrailerProblem) => `${problem.commit.slice(0, 7)} “${problem.subject}”`

/** Words as a sentence lists them, each quoted: “is”, “written” and “here”. */
const wordList = (words: ReadonlyArray<string>): string => {
  const quoted = words.map((word) => `“${word}”`)
  const last = quoted.pop()
  return quoted.length === 0 ? (last ?? '') : `${quoted.join(', ')} and ${last ?? ''}`
}

/** A problem with one id a line named. */
type IdProblem = Exclude<TrailerProblem, { readonly kind: 'not-ids' }>

/** A problem with a whole line, whose value holds words that are not ids. */
type LineProblem = Extract<TrailerProblem, { readonly kind: 'not-ids' }>

const idSentences: Record<IdProblem['kind'], (problem: IdProblem) => string> = {
  unknown: (problem) =>
    `Commit ${commitName(problem)} says ${problem.id} is done, but this session has no item ${problem.id}, open or archived. Amend the trailer before you push.`,
  'outside-trailers': (problem) =>
    `Commit ${commitName(problem)} names ${problem.id} on a ${doneTrailer} line outside its last paragraph, so Git does not read it as a trailer and ${problem.id} stays open. Amend the line into the closing trailer block before you push.`,
  'close-failed': (problem) =>
    `Commit ${commitName(problem)} says ${problem.id} is done, but filing it away failed: ${problem.detail ?? 'no reason was given.'} It is tried again whenever the session or the branch changes.`,
}

const lineSentence = (problem: LineProblem) =>
  `Commit ${commitName(problem)} has the line “${problem.line}”, where ${wordList(problem.words)} ${problem.words.length === 1 ? 'is not an item id' : 'are not item ids'}, so nothing on it is filed. A ${doneTrailer} value holds ids only, separated by commas or spaces; amend the line before you push.`

/** What went wrong with one trailer, and what puts it right. */
export const problemSentence = (problem: TrailerProblem): string =>
  problem.kind === 'not-ids' ? lineSentence(problem) : idSentences[problem.kind](problem)

/** One problem among a worktree's: a commit's id, or a commit's line, for each way a trailer can go wrong. */
export const problemKey = (problem: TrailerProblem): string =>
  `${problem.commit}:${problem.kind}:${problem.kind === 'not-ids' ? problem.line : problem.id}`

/** What these trailers are, for whichever surface names them. */
export const trailerMeaning =
  `A commit whose message ends with “${doneTrailer}: <ID>” files that item as done when the commit is made. Only this branch’s unpushed commits are read, so a problem shows while the commit can still be amended, and goes once it is fixed or pushed.`

/** The count, as the index names it. */
export const problemCount = (count: number) =>
  count === 1 ? '1 commit trailer not applied' : `${count} commit trailers not applied`
