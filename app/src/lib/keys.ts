import { formatForDisplay, type Hotkey } from '@tanstack/react-hotkeys'

/**
 * The board's keys. Every binding is a registration in TanStack Hotkeys'
 * manager, which is the one registry: it holds each binding with the
 * sentence of what it does and the scope it lives in, and the legend on `?`
 * is read from it, so nothing is bound without being shown. A binding is
 * registered while its page can offer what it does and not otherwise, so the
 * legend never lists a key that cannot act.
 */

/**
 * Where a binding lives: a page, the index or a board, whose keys act while
 * the keyboard is on the page, or an open dialog, whose keys act while it is
 * open.
 */
export type KeyScope = 'index' | 'board' | 'dialog'

declare module '@tanstack/hotkeys' {
  interface HotkeyMeta {
    /** The scope the binding lives in, which the legend lists it under. */
    readonly scope: KeyScope
  }
}

/**
 * Every key the board answers to, named for what it does, in the order the
 * legend lists them. A letter is bound without Shift, so `j` is `j` and
 * Shift+J is nothing; `?` is typed with Shift, which the match allows. The
 * index's sections stand one above another, and each lays its cards out in
 * columns, so no arrow says which way the next section is: `h` and `l` step
 * between sections there, and the left and right arrows only between a
 * board's lanes.
 */
export const keys = {
  legend: ['?'],
  next: ['J', 'ArrowDown'],
  previous: ['K', 'ArrowUp'],
  left: ['H', 'ArrowLeft'],
  right: ['L', 'ArrowRight'],
  previousSection: ['H'],
  nextSection: ['L'],
  open: ['Enter'],
  back: ['['],
  forward: [']'],
  terminal: ['T'],
  close: ['Escape'],
} as const satisfies Record<string, ReadonlyArray<Hotkey>>

export type KeyName = keyof typeof keys

/** The names in the legend's order. */
export const keyOrder = Object.keys(keys) as ReadonlyArray<KeyName>

/**
 * A key as the legend draws it: TanStack's own label, an arrow for an arrow
 * and `Esc` for Escape, with a letter in the case it is typed, since a capital
 * would read as Shift and the letter.
 */
export const keyLabel = (hotkey: Hotkey): string => {
  const label = formatForDisplay(hotkey)
  return /^[A-Z]$/u.test(label) ? label.toLowerCase() : label
}
