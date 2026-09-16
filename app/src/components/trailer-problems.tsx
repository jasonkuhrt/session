import type { TrailerProblem } from '../../contract'
import { problemSentence, trailerMeaning } from '../lib/trailers'
import { Explained } from './agent-marks'
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
      <section
        role="alert"
        aria-label="Commit trailers not applied"
        className="mx-6 mt-4 space-y-2 rounded-lg border border-destructive bg-muted p-3 text-sm"
      >
        <Explained meaning={trailerMeaning} className="w-fit">
          <span className="font-medium">Commit trailers not applied</span>
        </Explained>
        <ul className="space-y-1">
          {problems.map((problem) => (
            <li key={`${problem.commit}:${problem.id}:${problem.kind}`} className="wrap-anywhere">
              {problemSentence(problem)}
            </li>
          ))}
        </ul>
      </section>
    </TooltipProvider>
  )
}
