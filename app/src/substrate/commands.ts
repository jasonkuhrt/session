import type { CommandSchema } from './registry'

/**
 * The substrate's own commands, which every app's registry starts with: the
 * palette, the key map and leaving, the moves among peers and through depth,
 * marking, the go-to, and the keys of the two modes. The moves are commands
 * of the root scope, so no level binds `h` `j` `k` `l`, `i`, `n` or the
 * arrows to anything else.
 */

/** The scopes of the two modes that take keys of their own while they are open. An app's scopes end with these. */
export const modeScopes = ['palette', 'dialog'] as const

/** A command as a registry writes it, before it is decoded: keys as text. */
type Written = Omit<typeof CommandSchema.Encoded, 'scope'> & { readonly scope: string }

const command = (fields: Omit<Written, 'clicks' | 'input'> & Partial<Pick<Written, 'clicks' | 'input'>>): Written => ({
  clicks: [],
  input: 'none',
  ...fields,
})

/** Ids of the substrate's commands, which the substrate runs itself. */
export const substrateIds = {
  palette: 'palette',
  keyMap: 'keymap',
  leave: 'leave',
  left: 'left',
  down: 'down',
  up: 'up',
  right: 'right',
  in: 'in',
  out: 'out',
  mark: 'mark',
  focus: 'focus',
  goTo: 'goto',
  next: 'palette.next',
  previous: 'palette.previous',
  choose: 'palette.run',
  confirm: 'dialog.confirm',
} as const

/** The moves, the one kind of command a held key repeats. */
export const steps: ReadonlySet<string> = new Set([substrateIds.left, substrateIds.down, substrateIds.up, substrateIds.right])

/** Where the substrate's own commands name the root scope, whatever the app calls it. */
const rootScope = 'root'

const written: readonly Written[] = [
  command({
    id: substrateIds.palette,
    name: 'Command palette',
    scope: rootScope,
    keys: [';'],
    summary: 'The commands you can run here, nearest first, then everything there is to go to.',
  }),
  command({
    id: substrateIds.keyMap,
    name: 'Key map',
    scope: rootScope,
    keys: ['?'],
    summary: 'Every command and its keys, by scope, the current scope first; one that cannot run here is dim.',
  }),
  command({
    id: substrateIds.leave,
    name: 'Leave',
    scope: rootScope,
    keys: ['Escape'],
    clicks: [{ on: 'outside the palette, the key map or a dialog' }],
    summary: 'Close the palette, the key map or a dialog; else clear the marks. The focus stays.',
  }),
  command({
    id: substrateIds.left,
    name: 'Left',
    scope: rootScope,
    keys: ['h', 'ArrowLeft'],
    summary: 'The nearest peer to the left at this level, across containers.',
  }),
  command({
    id: substrateIds.down,
    name: 'Down',
    scope: rootScope,
    keys: ['j', 'ArrowDown'],
    summary: 'The nearest peer below at this level, across containers; in the palette, the next entry.',
  }),
  command({
    id: substrateIds.up,
    name: 'Up',
    scope: rootScope,
    keys: ['k', 'ArrowUp'],
    summary: 'The nearest peer above at this level, across containers; in the palette, the entry before.',
  }),
  command({
    id: substrateIds.right,
    name: 'Right',
    scope: rootScope,
    keys: ['l', 'ArrowRight'],
    summary: 'The nearest peer to the right at this level, across containers.',
  }),
  command({
    id: substrateIds.in,
    name: 'In',
    scope: rootScope,
    keys: ['i'],
    summary: 'Go in, to the child last focused there, else the first; a node that stands for another goes into that one.',
  }),
  command({
    id: substrateIds.out,
    name: 'Out',
    scope: rootScope,
    keys: ['n'],
    summary: 'Come out to the parent, landing on the node you came from.',
  }),
  command({
    id: substrateIds.mark,
    name: 'Mark',
    scope: rootScope,
    keys: ['Space'],
    summary: 'Mark or unmark the focused node. A command that takes several nodes takes the marks when there are any, else the focus.',
  }),
  command({
    id: substrateIds.focus,
    name: 'Focus',
    scope: rootScope,
    keys: [],
    clicks: [{ on: 'a node' }, { on: 'a step of the path line' }],
    summary:
      'Put the focus on what was clicked and run its own Enter, so one click opens a card, a row or a step of the path line and folds a section; a lane’s or a group’s heading, which has no Enter of its own, and a worktree’s part of a lane, which holds cards, only take the focus. With ⌘, Ctrl, Alt or Shift, or with another button than the first, a click is the browser’s, and a link opens in a new tab.',
  }),
  command({
    id: substrateIds.goTo,
    name: 'Go to…',
    scope: rootScope,
    keys: [],
    input: 'choice',
    summary: 'Anything there is, by name or id: the palette’s second half on its own.',
  }),
  command({
    id: substrateIds.next,
    name: 'Next entry',
    scope: 'palette',
    keys: ['Ctrl+j'],
    summary: 'Move the highlight down; the down arrow does too.',
  }),
  command({
    id: substrateIds.previous,
    name: 'Previous entry',
    scope: 'palette',
    keys: ['Ctrl+k'],
    summary: 'Move the highlight up; the up arrow does too.',
  }),
  command({
    id: substrateIds.choose,
    name: 'Run the entry',
    scope: 'palette',
    keys: ['Enter'],
    clicks: [{ on: 'an entry' }],
    summary: 'Run the highlighted command, take the highlighted choice, or go to the highlighted name.',
  }),
  command({
    id: substrateIds.confirm,
    name: 'Confirm',
    scope: 'dialog',
    keys: ['Enter'],
    summary: 'Take the name typed and finish the command that asked for it.',
  }),
]

/** The substrate's commands for an app whose root scope is `root`. */
export const substrateCommands = (root: string): readonly Written[] =>
  written.map((entry) =>
    entry.scope === rootScope
      ? { id: entry.id, name: entry.name, scope: root, keys: entry.keys, clicks: entry.clicks, summary: entry.summary, input: entry.input }
      : entry
  )

/** A command as a registry writes it, for an app to write its own in the substrate's form. */
export type WrittenCommand = Written

/** Makes a written command, a command with no clicks and no input unless it says otherwise. */
export const writeCommand = command
