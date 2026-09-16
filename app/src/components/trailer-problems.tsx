import type { TrailerProblem } from '../../contract'
import { problemCount, problemSentence, trailerMeaning } from '../lib/trailers'
import { Explained } from './agent-marks'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
import { Badge } from './ui/badge'
import { TooltipProvider } from './ui/tooltip'

/**
 * The trailers on this branch's unpushed commits that could not be acted on.
 * Each is a commit saying something this session cannot honour, so it reads as
 * a problem to fix before the commit leaves the machine, and it is gone once
 * it is fixed or pushed.
 */
export function TrailerProblems({ problems }: { problems: readonly TrailerProblem[] }) {
  if (problems.length === 0) return null
  return (
    <TooltipProvider>
      <Alert variant="destructive" aria-label="Commit trailers not applied" className="mx-6 mt-4 w-auto">
        <AlertTitle>
          <Explained meaning={trailerMeaning} className="w-fit">Commit trailers not applied</Explained>
        </AlertTitle>
        <AlertDescription>
          <ul className="space-y-1">
            {problems.map((problem) => (
              <li key={`${problem.commit}:${problem.id}:${problem.kind}`} className="wrap-anywhere">
                {problemSentence(problem)}
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    </TooltipProvider>
  )
}

/**
 * The same problems on the index: a count beside the worktree's name, with the
 * sentences one hover or one focus away, so there is something to read on its
 * board.
 */
export function TrailerCount({ problems }: { problems: readonly TrailerProblem[] }) {
  if (problems.length === 0) return null
  return (
    <Explained
      meaning={
        <span className="block space-y-2">
          <span className="block">{trailerMeaning}</span>
          {problems.map((problem) => (
            <span key={`${problem.commit}:${problem.id}:${problem.kind}`} className="block">
              {problemSentence(problem)}
            </span>
          ))}
        </span>
      }
    >
      <Badge variant="destructive">{problemCount(problems.length)}</Badge>
    </Explained>
  )
}
