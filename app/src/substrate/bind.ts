import { useHotkeys } from '@tanstack/react-hotkeys'

import type { Key } from './registry'
import { keyText } from './registry'

/**
 * The one place a key is bound: every key the registry names, once each,
 * through TanStack Hotkeys, and nowhere else, which the lint rule
 * `session/hotkeys-in-binder` holds. A key does not run a command here; it
 * is handed to `press`, which finds the command the nearest scope binds to it
 * at the focus, and answers whether the key did something, run or refused,
 * which is when the browser's own use of it is taken away.
 */
export function useKeys({ keys, press }: {
  readonly keys: readonly Key[]
  readonly press: (key: Key, event: KeyboardEvent) => boolean
}) {
  const distinct = new Map(keys.map((key) => [keyText(key), key]))
  useHotkeys(
    [...distinct.values()].map((key) => ({
      hotkey: { key: key.key.length === 1 ? key.key.toUpperCase() : key.key, shift: key.shift, ctrl: key.ctrl },
      callback: (event: KeyboardEvent) => {
        if (press(key, event)) event.preventDefault()
      },
    })),
    // The substrate decides about fields itself: a mode's keys act in its
    // input, and every other key leaves a field's typing alone.
    { ignoreInputs: false, preventDefault: false, stopPropagation: false },
  )
}
