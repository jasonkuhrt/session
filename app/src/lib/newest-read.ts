import * as React from 'react'

/**
 * A read a page repeats whenever the daemon says its answer changed: the last
 * answer, why the latest read failed, and the read itself. Only the newest
 * read lands, so a slow one cannot put an older answer back, and a read that
 * fails keeps the last answer on screen.
 */
export function useNewestRead<A>({ read, describe }: {
  readonly read: (signal?: AbortSignal) => Promise<A>
  /** The sentence the page shows when a read fails. */
  readonly describe: (error: unknown) => string
}) {
  const [answer, setAnswer] = React.useState<A | null>(null)
  const [problem, setProblem] = React.useState<string | null>(null)
  const latest = React.useRef(0)
  const load = React.useCallback(async (signal?: AbortSignal) => {
    const mine = ++latest.current
    try {
      const next = await read(signal)
      if (!signal?.aborted && mine === latest.current) {
        setAnswer(next)
        setProblem(null)
      }
    } catch (error) {
      if (!signal?.aborted && mine === latest.current) setProblem(describe(error))
    }
  }, [read, describe])
  return { answer, problem, load }
}
