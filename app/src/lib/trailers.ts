import type { TrailerProblem } from '../../contract'
import { doneTrailer } from '../../contract'

/**
 * How the board and the index word a trailer that could not be acted on. Both
 * read these, so a problem never reads one way in one place and another way in
 * the other.
 */

/** A commit as a person refers to it: its short hash and its subject. */
const commitName = (problem: TrailerProblem) => `${problem.commit.slice(0, 7)} “${problem.subject}”`

/** Words as a sentence offers them, each quoted, the last after “or”: “is”, “written” or “here”. */
const wordList = (words: ReadonlyArray<string>): string => {
  const quoted = words.map((word) => `“${word}”`)
  const last = quoted.pop()
  return quoted.length === 0 ? (last ?? '') : `${quoted.join(', ')} or ${last ?? ''}`
}

/** A problem with a whole line, some of whose words name no item. */
type UnknownProblem = Extract<TrailerProblem, { readonly kind: 'unknown' }>

/** A problem with a line that names nothing. */
type EmptyProblem = Extract<TrailerProblem, { readonly kind: 'empty' }>

/** A problem with one id a line named. */
type IdProblem = Exclude<TrailerProblem, { readonly kind: 'unknown' | 'empty' }>

const unknownSentence = (problem: UnknownProblem) =>
  `Commit ${commitName(problem)} has the line “${problem.line}”, but this session has no item ${wordList(problem.words)}, open or archived. A ${doneTrailer} line is filed whole or not at all, so nothing on it is filed; amend it before you push.`

const emptySentence = (problem: EmptyProblem) =>
  `Commit ${commitName(problem)} has the line “${problem.line}”, which names no item, so nothing on it is filed. Amend it before you push.`

const idSentences: Record<IdProblem['kind'], (problem: IdProblem) => string> = {
  'outside-trailers': (problem) =>
    `Commit ${commitName(problem)} names ${problem.id} on a ${doneTrailer} line outside its last paragraph, so Git does not read it as a trailer and ${problem.id} stays open. Amend the line into the closing trailer block before you push.`,
  'close-failed': (problem) =>
    `Commit ${commitName(problem)} says ${problem.id} is done, but filing it away failed: ${problem.detail ?? 'no reason was given.'} It is tried again whenever the session or the branch changes.`,
}

/** What went wrong with one trailer, and what puts it right. */
export const problemSentence = (problem: TrailerProblem): string => {
  if (problem.kind === 'unknown') return unknownSentence(problem)
  if (problem.kind === 'empty') return emptySentence(problem)
  return idSentences[problem.kind](problem)
}

/** One problem among a worktree's: a commit's line, or a commit's id, for each way a trailer can go wrong. */
export const problemKey = (problem: TrailerProblem): string =>
  `${problem.commit}:${problem.kind}:${problem.kind === 'unknown' || problem.kind === 'empty' ? problem.line : problem.id}`

/** What these trailers are, for whichever surface names them. */
export const trailerMeaning =
  `A commit whose message ends with “${doneTrailer}: <ID>” files that item as done when the commit is made. Only this branch’s unpushed commits are read, so a problem shows while the commit can still be amended, and goes once it is fixed or pushed.`

/** The count, as the index names it. */
export const problemCount = (count: number) =>
  count === 1 ? '1 commit trailer not applied' : `${count} commit trailers not applied`
