import * as React from 'react'

import type { Session, WorktreeSummary } from '../../contract'
import { IndexApi } from '../lib/api'
import { checkoutLabel } from '../lib/format'
import { cn } from '../lib/utils'
import { useTip } from './tip'
import { Button } from './ui/button'
import { CheckoutMark, WorktreeMark } from './worktree-marks'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox'

/** A worktree this board can switch to. */
type Option = { key: string; name: string; path: string; branch: string | null; detached: boolean }

/**
 * How the picker names a worktree, on the control and in the list alike: its
 * name over what it has checked out, a line each, and each line marked with
 * what it is, as every row of the index marks it. A line too long for the
 * popup is cut short rather than wrapped, so every option is the same two
 * lines and the list reads down one edge.
 */
function WorktreeLabel({ name, branch, detached, className }: {
  name: string
  branch: string | null
  detached: boolean
  className?: string
}) {
  return (
    <span className={cn('grid min-w-0 gap-0.5 text-left', className)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <WorktreeMark />
        <span className="truncate font-medium">{name}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
        <CheckoutMark detached={detached} />
        <span className="truncate">{checkoutLabel({ branch, detached })}</span>
      </span>
    </span>
  )
}

/** Typing narrows on what the list shows: the name, or the branch. */
const matches = (option: Option, query: string) => {
  const needle = query.trim().toLowerCase()
  return needle === '' || `${option.name} ${option.branch ?? ''}`.toLowerCase().includes(needle)
}

/**
 * The worktree the board is showing and the branch checked out in it, as the
 * control that switches to another worktree.
 *
 * The options are the served rows of the root index; a row the daemon refuses
 * to serve is not somewhere this can go. Until that list arrives, and if it
 * never does, the name and branch are plain text: the board itself never
 * depends on the index answering. The branch on the control is the board's
 * own read, which is newer than the index's whenever the two differ.
 */
export function WorktreePicker({ current }: { current: NonNullable<Session['worktree']> }) {
  const [worktrees, setWorktrees] = React.useState<readonly WorktreeSummary[] | null>(null)
  const tip = useTip()

  // The registry of served worktrees lives at the root whichever page is open.
  // It is the picker's own concern, so no surface has to fetch it to have one.
  React.useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const next = await IndexApi.read(controller.signal)
        if (!controller.signal.aborted) setWorktrees(next)
      } catch {
        // Nothing to say: the header falls back to the plain name and branch.
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  const options: Option[] = (worktrees ?? [])
    .filter((row) => row.conflict === null)
    .map((row) => ({ key: row.key, name: row.name, path: row.path, branch: row.branch, detached: row.detached }))
    .toSorted((left, right) => left.name.localeCompare(right.name))
  const selected = options.find((option) => option.path === current.path) ?? null

  // As wide as the control that replaces it can be, so a long branch is cut the same way.
  if (options.length === 0) {
    return <WorktreeLabel name={current.name} branch={current.branch} detached={current.detached} className="max-w-80" />
  }

  return (
    <Combobox
      items={options}
      value={selected}
      itemToStringLabel={(option: Option) => option.name}
      isItemEqualToValue={(left: Option, right: Option) => left.key === right.key}
      filter={matches}
      // Typing narrows to the worktree wanted, so Enter goes there.
      autoHighlight
      onValueChange={(next: Option | null) => {
        if (next === null || next.key === selected?.key) return
        window.location.assign(`/w/${next.key}/`)
      }}
    >
      <ComboboxTrigger
        aria-label="Switch worktree"
        title={tip('The worktree whose session this board shows, and the branch checked out in it. Pick another worktree to switch to its board.')}
        render={<Button variant="outline" className="h-auto max-w-80 justify-between gap-3 py-1.5" />}
      >
        <WorktreeLabel name={current.name} branch={current.branch} detached={current.detached} />
      </ComboboxTrigger>
      {/* The popup grows to the longest option, up to a cap past which a line
          is cut short, so a long name does not squeeze every other one. */}
      <ComboboxContent className="w-auto max-w-[min(36rem,var(--available-width))]">
        <ComboboxInput showTrigger={false} aria-label="Find a worktree" placeholder="Find a worktree" />
        <ComboboxEmpty>No worktree matches</ComboboxEmpty>
        <ComboboxList className="max-h-[min(28rem,calc(var(--available-height)---spacing(9)))]">
          {(option: Option) => (
            <ComboboxItem key={option.key} value={option}>
              <WorktreeLabel name={option.name} branch={option.branch} detached={option.detached} />
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
