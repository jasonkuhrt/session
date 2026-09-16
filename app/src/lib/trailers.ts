import type { TrailerProblem } from '../../contract'
import { doneTrailer } from '../../contract'

/**
 * How the board and the index word a trailer that could not be acted on. Both
 * read these, so a problem never reads one way in one place and another way in
 * the other.
 */

/** A commit as a person refers to it: its short hash and its subject. */
const commitName = (problem: TrailerProblem) => `${problem.commit.slice(0, 7)} “${problem.subject}”`

const sentences: Record<TrailerProblem['kind'], (problem: TrailerProblem) => string> = {
  unknown: (problem) =>
    `Commit ${commitName(problem)} says ${problem.id} is done, but this session has no item ${problem.id}, open or archived. Amend the trailer before you push.`,
  'outside-trailers': (problem) =>
    `Commit ${commitName(problem)} names ${problem.id} on a ${doneTrailer} line outside its last paragraph, so Git does not read it as a trailer and ${problem.id} stays open. Amend the line into the closing trailer block before you push.`,
  'close-failed': (problem) =>
    `Commit ${commitName(problem)} says ${problem.id} is done, but filing it away failed: ${problem.detail ?? 'no reason was given.'} It is tried again whenever the session or the branch changes.`,
}

/** What went wrong with one trailer, and what puts it right. */
export const problemSentence = (problem: TrailerProblem): string => sentences[problem.kind](problem)

/** What these trailers are, for whichever surface names them. */
export const trailerMeaning =
  `A commit whose message ends with “${doneTrailer}: <ID>” files that item as done when the commit is made. Only this branch’s unpushed commits are read, so a problem shows while the commit can still be amended, and goes once it is fixed or pushed.`

/** The count, as the index names it. */
export const problemCount = (count: number) =>
  count === 1 ? '1 commit trailer not applied' : `${count} commit trailers not applied`
