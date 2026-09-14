import * as React from 'react'

/**
 * One clock for the page, moved once a minute. Every age on a surface is read
 * off the same value, so the rows, the bands they are grouped under and the
 * chips beside them can never disagree about which side of a boundary a moment
 * is on.
 */
export function useNow() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
