import { Schema } from 'effect'

import { ScopeSchema } from './levels'
import type { WrittenCommand } from './substrate/commands'
import { substrateCommands, writeCommand as command } from './substrate/commands'
import { registrySchema } from './substrate/registry'

/**
 * Session's registry: every command there is, the substrate's first, each
 * registered once with its keys, its clicks, its summary and the input it
 * takes. It is decoded when this module loads, which every page and the
 * build's prerender do, so a key bound twice in one scope, a repeated id, or
 * a root key bound anywhere else fails the build and `bun run check` with it.
 * The palette and the key map read it, and every key is bound from it.
 */
const written: readonly WrittenCommand[] = [
  ...substrateCommands('all'),
  command({ id: 'settings', name: 'Settings', scope: 'all', keys: [], summary: 'How the board draws in this browser: tips, the code colour and the term colour.' }),

  command({
    id: 'project.open',
    name: 'Open the project’s board',
    scope: 'project',
    keys: ['Enter'],
    clicks: [{ on: 'a project' }],
    summary: 'Every worktree of the project on one board, a row each; a project of one worktree opens that worktree’s board.',
  }),
  command({
    id: 'project.down',
    name: 'Carry down',
    scope: 'project',
    keys: ['Shift+j', 'Shift+ArrowDown'],
    clicks: [{ on: 'a drag of the project below another' }],
    summary: 'Place the project after the next one on the index, by its main worktree’s rank.',
  }),
  command({
    id: 'project.up',
    name: 'Carry up',
    scope: 'project',
    keys: ['Shift+k', 'Shift+ArrowUp'],
    clicks: [{ on: 'a drag of the project above another' }],
    summary: 'Place the project before the one above it on the index, by its main worktree’s rank.',
  }),
  command({
    id: 'project.ledger',
    name: 'Ledger of the project',
    scope: 'project',
    keys: [],
    summary: 'The ledgers of every worktree of the project, merged, newest first.',
  }),

  command({
    id: 'epic.open',
    name: 'Open the epic’s board',
    scope: 'epic',
    keys: ['Enter'],
    clicks: [{ on: 'an epic' }],
    summary: 'Every worktree of the epic on one board, a row each.',
  }),
  command({
    id: 'epic.rename',
    name: 'Rename the epic…',
    scope: 'epic',
    keys: [],
    input: 'name',
    clicks: [{ on: 'a drag of the epic onto another, which merges the two' }],
    summary: 'Give the epic a new name, which every worktree in it takes; a name another epic has merges the two.',
  }),
  command({
    id: 'epic.ledger',
    name: 'Ledger of the epic',
    scope: 'epic',
    keys: [],
    summary: 'The ledgers of every worktree of the epic, merged, newest first.',
  }),

  command({
    id: 'worktree.open',
    name: 'Open the board',
    scope: 'worktree',
    keys: ['Enter'],
    clicks: [{ on: 'a worktree' }],
    summary: 'The worktree’s own board; i goes in to the same place.',
  }),
  command({
    id: 'worktree.terminal',
    name: 'Terminal',
    scope: 'worktree',
    keys: ['t'],
    summary: 'Bring forward the cmux workspace working in the worktree, or open one there.',
  }),
  command({
    id: 'worktree.editor',
    name: 'Editor',
    scope: 'worktree',
    keys: ['e'],
    summary: 'Bring forward the Zed window on the worktree, or open one; a window on another folder is left alone.',
  }),
  command({
    id: 'worktree.pr',
    name: 'Pull request',
    scope: 'worktree',
    keys: [],
    clicks: [{ on: 'the pull request’s number, wherever it is drawn: a row, a step of the path line or a worktree’s name' }],
    summary: 'Open the branch’s pull request, bringing back the tab this board opened for it.',
  }),
  command({
    id: 'worktree.linear',
    name: 'Linear issue…',
    scope: 'worktree',
    keys: [],
    input: 'choice',
    summary: 'Choose one of the Linear issues the branch and its pull request name, and open it.',
  }),
  command({
    id: 'worktree.agents',
    name: 'Agents…',
    scope: 'worktree',
    keys: ['a'],
    input: 'choice',
    summary: 'Choose an agent in the worktree, then focus its terminal, open it in Codex, or copy its resume command or id.',
  }),
  command({ id: 'worktree.ledger', name: 'Ledger', scope: 'worktree', keys: [], summary: 'The session’s log, newest first.' }),
  command({ id: 'worktree.context', name: 'Context', scope: 'worktree', keys: [], summary: 'The session’s context/, as a tree.' }),
  command({ id: 'worktree.archive', name: 'Archive', scope: 'worktree', keys: [], summary: 'The items filed away, finished or set aside, newest first.' }),
  command({ id: 'worktree.rules', name: 'Rules', scope: 'worktree', keys: [], summary: 'The session’s standing rules, RULES.md.' }),
  command({
    id: 'worktree.join',
    name: 'Join an epic…',
    scope: 'worktree',
    keys: [],
    input: 'name',
    clicks: [{ on: 'a drag of the worktree onto an epic, a worktree or the +' }],
    summary: 'Put the marked worktrees, else the focused one, in the epic of the name given, new or existing.',
  }),
  command({
    id: 'worktree.leave',
    name: 'Leave the epic',
    scope: 'worktree',
    keys: [],
    clicks: [{ on: 'a drag of the worktree out of its epic' }],
    summary: 'Take the marked worktrees, else the focused one, out of their epics.',
  }),
  command({ id: 'worktree.copyPath', name: 'Copy path', scope: 'worktree', keys: [], summary: 'Copy the worktree’s folder.' }),
  command({ id: 'worktree.copyBranch', name: 'Copy branch', scope: 'worktree', keys: [], summary: 'Copy the branch checked out in it.' }),
  command({
    id: 'worktree.down',
    name: 'Carry down',
    scope: 'worktree',
    keys: ['Shift+j', 'Shift+ArrowDown'],
    clicks: [{ on: 'a drag of the worktree below another in its epic' }],
    summary: 'Place the worktree after the next one in its epic.',
  }),
  command({
    id: 'worktree.up',
    name: 'Carry up',
    scope: 'worktree',
    keys: ['Shift+k', 'Shift+ArrowUp'],
    clicks: [{ on: 'a drag of the worktree above another in its epic' }],
    summary: 'Place the worktree before the one above it in its epic.',
  }),

  command({
    id: 'stage.group',
    name: 'Group the marks…',
    scope: 'stage',
    keys: [],
    input: 'name',
    clicks: [{ on: 'a drag of a card onto another, or onto a group’s heading' }],
    summary: 'Gather the marked cards of this lane, else the focused card, under a name; a name the lane has adds them to that group.',
  }),
  command({
    id: 'stage.batch',
    name: 'Queue the marks as a batch…',
    scope: 'stage',
    keys: [],
    input: 'name',
    summary: 'From Batch: send the marked cards, else the focused card, to Queue as one named batch.',
  }),
  command({
    id: 'stage.start',
    name: 'Start the first batch',
    scope: 'stage',
    keys: [],
    summary: 'From Queue, while Execute is empty: move the first batch on to Execute.',
  }),

  command({
    id: 'group.ungroup',
    name: 'Ungroup',
    scope: 'group',
    keys: [],
    summary: 'Take the group’s cards out of it, each to the end of its lane.',
  }),
  command({
    id: 'group.rename',
    name: 'Rename the group…',
    scope: 'group',
    keys: [],
    input: 'name',
    summary: 'Give the group or the queued batch a new name, where it stands.',
  }),
  command({
    id: 'group.queue',
    name: 'Queue the group as a batch…',
    scope: 'group',
    keys: [],
    input: 'name',
    summary: 'From Batch: send this group’s cards to Queue as one named batch, starting from the group’s name.',
  }),

  command({
    id: 'item.open',
    name: 'Open',
    scope: 'item',
    keys: ['Enter'],
    clicks: [{ on: 'a card' }],
    summary: 'The item’s page; i goes in to the same place.',
  }),
  command({
    id: 'item.previous',
    name: 'Carry to the stage before',
    scope: 'item',
    keys: ['Shift+h', 'Shift+ArrowLeft'],
    clicks: [{ on: 'a drag of the card to the lane on its left' }],
    summary: 'Move the item to the stage before its own, when the rules let it go there.',
  }),
  command({
    id: 'item.next',
    name: 'Carry to the next stage',
    scope: 'item',
    keys: ['Shift+l', 'Shift+ArrowRight'],
    clicks: [{ on: 'a drag of the card to the lane on its right' }],
    summary: 'Move the item to the stage after its own, when the rules let it go there.',
  }),
  command({
    id: 'item.down',
    name: 'Carry down its lane',
    scope: 'item',
    keys: ['Shift+j', 'Shift+ArrowDown'],
    clicks: [{ on: 'a drag of the card down its lane' }],
    summary: 'Move the card down, past the next card, and out of its group at the group’s end.',
  }),
  command({
    id: 'item.up',
    name: 'Carry up its lane',
    scope: 'item',
    keys: ['Shift+k', 'Shift+ArrowUp'],
    clicks: [{ on: 'a drag of the card up its lane' }],
    summary: 'Move the card up, past the card before, and out of its group at the group’s start.',
  }),
  command({
    id: 'item.stage',
    name: 'Move to a stage…',
    scope: 'item',
    keys: [],
    input: 'choice',
    clicks: [{ on: 'a stage on the item’s page' }],
    summary: 'Choose any stage the rules let the item go to from its own.',
  }),
  command({
    id: 'item.complete',
    name: 'Complete',
    scope: 'item',
    keys: [],
    summary: 'In Execute: file the item under archive/ as done.',
  }),
  command({
    id: 'item.editor',
    name: 'Editor',
    scope: 'item',
    keys: ['e'],
    summary: 'Open the item’s file in Zed at its first line, in the worktree’s own window.',
  }),
  command({ id: 'item.copyId', name: 'Copy id', scope: 'item', keys: [], summary: 'Copy the item’s id.' }),
  command({ id: 'item.copyPath', name: 'Copy path', scope: 'item', keys: [], summary: 'Copy the item’s file, as a terminal opens it.' }),

  command({
    id: 'section.enter',
    name: 'Fold, unfold or open',
    scope: 'section',
    keys: ['Enter'],
    clicks: [{ on: 'a section’s heading or an entry' }],
    summary: 'A section or a ledger entry folds to its heading or opens again; a directory of context/ opens or closes; a file or a record opens.',
  }),
  command({
    id: 'section.copyPath',
    name: 'Copy path',
    scope: 'section',
    keys: [],
    summary: 'Copy the file an entry of the ledger, of context/ or of the archive is.',
  }),
  command({ id: 'record.copyPath', name: 'Copy path', scope: 'record', keys: [], summary: 'Copy the page’s file or directory.' }),
]

export const registry = Schema.decodeUnknownSync(registrySchema({ scope: ScopeSchema, root: 'all' }))(written)
