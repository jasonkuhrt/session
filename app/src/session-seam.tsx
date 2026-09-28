import type { LinkOptions } from '@tanstack/react-router'
import { Link, linkOptions, useNavigate } from '@tanstack/react-router'
import * as React from 'react'

import type { DaemonCapabilities, FocusResult } from '../contract'
import { SettingsPanel } from './components/settings-panel'
import { useTip } from './components/tip'
import type { SessionWrite } from './lib/session-mutations'
import type { Node } from './levels'
import { nodeOf, rootId, scopeNames, scopeOfId } from './levels'
import { registry } from './registry'
import { itemRunners } from './runners/items'
import { laneRunners } from './runners/lanes'
import { pageRunners } from './runners/pages'
import type { RunnerContext } from './runners/shared'
import { reasonOf } from './runners/shared'
import { epicRunners, projectRunners } from './runners/structure'
import { worktreeRunners } from './runners/worktree'
import type { LinkProps, Path, Runner, Seam, SurfaceApi } from './substrate/seam'
import type { Place, TreeData } from './tree-types'
import type { Tree } from './tree'
import { makeTree } from './tree'

/**
 * Session, as the substrate reads it: the seam a view builds from what it
 * has read, with every command's runner. A view hands in where it is, the
 * leaf its address names, what it read, and what it can do to the files, and
 * gets back the seam its surface draws; the tree says what each node is, and
 * the runners here say what each command does to it and why it cannot.
 */

/**
 * What a page does with its entries: Enter on one, which opens another page
 * from some and stays on the page for the rest, and the file each is, for a
 * copy.
 */
export type PageActions = {
  /** Enter on an entry that stays on the page: a fold, or a tab of its own. */
  readonly enter?: ((at: string, surface: SurfaceApi) => void | Promise<void>) | undefined
  /** Where Enter on an entry takes the focus, from the entry's path, when it opens another page; null when it stays. */
  readonly opens?: ((at: string, path: Path) => Path | null) | undefined
  readonly pathOf: (at: string) => string | null
  /** The page's own file or directory, absolute. */
  readonly path: string | null
}

/** Session's links go where the router's options say, which the substrate hands back to `SessionLink` as they are. */
declare module './substrate/seam' {
  interface Register {
    readonly address: LinkOptions
  }
}

/**
 * The substrate's link: the router's `Link` to the address the seam gave, so
 * a link or a key that opens a page goes through the router, with what the
 * substrate puts on the element.
 */
function SessionLink({ address, ...attributes }: LinkProps) {
  return <Link {...address} {...attributes} />
}

/** What a view hands its seam. */
export type SeamInput = {
  readonly place: Place
  readonly leaf: string | undefined
  readonly data: TreeData
  readonly ready: boolean
  readonly held: boolean
  readonly capabilities: DaemonCapabilities
  /** A write to a worktree's records, which the view lands where it draws it; absent on a view that draws none. */
  readonly write: SessionWrite | null
  readonly pending: boolean
  /** Reads the rows again, after a write about epics or order. */
  readonly readRows: () => Promise<unknown>
  /** Asks the daemon to bring a session's terminal forward. */
  readonly focusAgent: (pid: number) => Promise<FocusResult>
  readonly page: PageActions | null
  /** Whether the session a worktree's page is of holds `RULES.md`, when it has been read. */
  readonly rules: boolean | null
}

export function useSessionSeam(input: SeamInput): { readonly seam: Seam; readonly tree: Tree } {
  const navigate = useNavigate()
  const tip = useTip()
  const tree = makeTree(input.data)
  const focus = tree.focusOf(input.place, input.leaf)
  const [busy, setBusy] = React.useState(false)
  const writing = busy || input.pending

  /**
   * Where a path is drawn, as the router's options for going there, each
   * checked against its route where it is written: the view that draws it,
   * and the focus as its leaf; null for a path no view draws. A move within a
   * view replaces its entry, which for a page is where the focus comes back
   * to. A key goes there and a link names it, so the two go to one address.
   */
  const address = (path: Path, { replace }: { readonly replace: boolean }): LinkOptions | null => {
    const index = (kind: Node['kind']) => path.findLastIndex((id) => nodeOf(id)?.kind === kind)
    const leaf = path.at(-1)
    const itemAt = index('item')
    const sectionAt = index('section')
    const recordAt = index('record')
    const stageAt = path.findIndex((id) => nodeOf(id)?.kind === 'stage')
    if (sectionAt !== -1 && itemAt === sectionAt - 1) {
      const item = nodeOf(path[itemAt] ?? '')
      const row = item?.kind === 'item' ? tree.rowOfKey(item.key) : null
      if (item?.kind !== 'item' || row === null) return null
      const context = stageAt === -1 ? null : nodeOf(path[stageAt - 1] ?? '')?.kind
      const via = context === 'epic' ? 'epic' : context === 'project' ? 'project' : undefined
      return linkOptions({ to: '/w/$key/item/$id', params: { key: row.name, id: item.id }, search: { focus: leaf, via } })
    }
    if (recordAt !== -1) {
      const record = nodeOf(path[recordAt] ?? '')
      const owner = nodeOf(path[recordAt - 1] ?? '')
      // Opened, a page lands on its first entry; come back to within it, the page itself keeps the focus.
      const search = { focus: sectionAt === -1 && !replace ? undefined : leaf }
      if (record?.kind !== 'record' || owner === null) return null
      if (owner.kind === 'epic') return linkOptions({ to: '/e/$name/ledger', params: { name: owner.name }, search })
      if (owner.kind === 'project') return linkOptions({ to: '/p/$key/ledger', params: { key: owner.key }, search })
      const row = owner.kind === 'worktree' ? tree.rowAt(owner.path) : null
      if (row === null) return null
      if (record.page === 'file') return linkOptions({ to: '/w/$key/file/$', params: { key: row.name, _splat: record.path }, search })
      const to = record.page === 'ledger' ? '/w/$key/ledger' : record.page === 'context' ? '/w/$key/context' : '/w/$key/archive'
      return linkOptions({ to, params: { key: row.name }, search })
    }
    const board = stageAt === -1 ? (itemAt === -1 ? -1 : itemAt) : stageAt
    if (board !== -1) {
      const owner = nodeOf(path[board - 1] ?? '')
      const search = { focus: leaf }
      if (owner?.kind === 'epic') return linkOptions({ to: '/e/$name/', params: { name: owner.name }, search })
      if (owner?.kind === 'project') return linkOptions({ to: '/p/$key/', params: { key: owner.key }, search })
      const row = owner?.kind === 'worktree' ? tree.rowAt(owner.path) : null
      return row === null ? null : linkOptions({ to: '/w/$key/', params: { key: row.name }, search })
    }
    return linkOptions({ to: '/', search: { focus: leaf === rootId ? undefined : leaf } })
  }

  /** Puts a path in the address: the view that draws it, and the focus as its leaf. */
  const go = async (path: Path, { replace }: { readonly replace: boolean }): Promise<void> => {
    const to = address(path, { replace })
    if (to !== null) await navigate({ ...to, replace })
  }

  /** Runs a write, one at a time, saying why it did not land. */
  const writeOnce = async (surface: SurfaceApi, write: () => Promise<string | null>, landed?: () => void) => {
    setBusy(true)
    try {
      const refused = await write()
      if (refused === null) landed?.()
      else surface.flash(refused)
      return refused
    } catch (error) {
      const reason = reasonOf({ error, fallback: 'The write failed' })
      surface.flash(reason)
      return reason
    } finally {
      setBusy(false)
    }
  }

  const noWrite = 'Another write is under way'

  const runners = runnersOf({ tree, input, focus, writeOnce, writing, noWrite })

  const seam: Seam = {
    root: rootId,
    scopes: Object.keys(scopeNames),
    scopeName: (scope) => (Object.hasOwn(scopeNames, scope) ? scopeNames[scope as keyof typeof scopeNames] : scope),
    registry,
    runners,
    focus,
    ready: input.ready,
    held: input.held,
    scopeOf: scopeOfId,
    kids: tree.kids,
    standsFor: tree.standsFor,
    normalize: tree.normalize,
    viewOf: tree.viewOf,
    go,
    link: address,
    Link: SessionLink,
    crumb: tree.crumb,
    facts: tree.facts,
    targetName: tree.targetName,
    goTo: tree.goTo,
    markable: (path) => {
      const node = nodeOf(path.at(-1) ?? '')
      if (node?.kind === 'item') return tree.itemOf(node.key, node.id) === null ? 'An item no stage holds cannot be marked' : true
      if (node?.kind === 'worktree') {
        const row = tree.rowAt(node.path)
        if (row === null || !row.resolved) return 'A path Git did not answer for cannot be marked'
        return row.main ? 'A main worktree is never in an epic, so it is not marked' : true
      }
      return 'Space marks a card, for a group or a batch, or a worktree, for an epic'
    },
    noInside: (path) => {
      const node = nodeOf(path.at(-1) ?? '')
      if (node?.kind === 'section') return 'A section is the deepest level'
      if (node?.kind === 'worktree') {
        const row = tree.rowAt(node.path)
        if (row !== null && !row.resolved) return `Git did not answer for ${row.path}, so it has no session to go into`
        if (row?.conflict !== null && row?.conflict !== undefined) return `${row.name} is not served: ${row.conflict}`
      }
      return `${tree.label(path)} has nothing inside`
    },
    noOut: () => 'All is the root: the index is all of it',
    settings: <SettingsPanel />,
    tip,
  }
  return { seam, tree }
}

function runnersOf(context: RunnerContext): Record<string, Runner> {
  return {
    settings: { run: (_target, surface) => surface.openSettings() },
    ...projectRunners(context),
    ...epicRunners(context),
    ...worktreeRunners(context),
    ...laneRunners(context),
    ...itemRunners(context),
    ...pageRunners(context),
  }
}
