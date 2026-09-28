import type { Key } from './registry'

/** How a named key is drawn: an arrow for an arrow, and a short word for the rest. */
const named: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Enter: 'Enter',
  Space: 'Space',
}

/** A key as the palette and the key map draw it: `Shift J`, `Ctrl k`, `Esc`, a letter in the case it is typed. */
export const keyLabel = (key: Key) =>
  [key.ctrl ? 'Ctrl' : null, key.shift ? 'Shift' : null, named[key.key] ?? (key.shift ? key.key.toUpperCase() : key.key)]
    .filter((part) => part !== null)
    .join(' ')
