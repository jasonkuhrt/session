import * as React from 'react'

/**
 * What an overlay should render: the value it has, or the last one it had.
 *
 * A dialog driven straight off its subject unmounts the instant that subject
 * is cleared, so the closing transition the primitive already defines never
 * plays and any copy naming the subject loses its noun on the way out. Holding
 * the last value lets the overlay close the way it opened, still saying what
 * it was about. Pass a stable value: a fresh object every render would hold a
 * new one every render.
 */
export function useLastPresent<A>(value: A | null): A | null {
  const [held, setHeld] = React.useState(value)
  if (value !== null && value !== held) setHeld(value)
  return value ?? held
}
