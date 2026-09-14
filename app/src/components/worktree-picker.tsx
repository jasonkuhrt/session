import * as React from 'react'

import type { WorktreeSummary } from '../../contract'
import { IndexApi } from '../lib/api'
import { parentPath } from '../lib/format'
import { Copyable } from './copyable'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './ui/combobox'

/** A worktree this board can switch to. */
type Option = { key: string; name: string; path: string }

/**
 * How the list names a worktree: what it is called, then where it sits. It
 * wraps rather than overflowing, because the popup is as wide as the control
 * it hangs off and a worktree path is longer than any sane control; a name cut
 * off mid-path is worse than one that takes a second line.
 */
function WorktreeLabel({ name, path }: Option) {
  const parent = parentPath(path)
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
      <span className="font-medium">{name}</span>
      {parent === '' ? null : <span className="wrap-anywhere text-muted-foreground">{parent}</span>}
    </span>
  )
}

/**
 * Characters of room for the control, which is also the width the popup takes.
 * Half the worktrees on a busy machine name themselves inside it, and the rest
 * wrap; the longest real one wants about four times a sane header's width.
 */
const controlCharacters = 44

/** Typing narrows on what a person would type: the name, or where it lives. */
const matches = (option: Option, query: string) => {
  const needle = query.trim().toLowerCase()
  return needle === '' || `${option.name} ${option.path}`.toLowerCase().includes(needle)
}

/**
 * The worktree the board is showing, and a way to switch to another one.
 *
 * The options are the served rows of the root index; a row the daemon refuses
 * to serve is not somewhere this can go. Until that list arrives, and if it
 * never does, the name is the plain text it was before the picker existed: the
 * board itself never depends on the index answering.
 *
 * The directory sits beside the control rather than inside it, because it is a
 * path someone copies and a control cannot hold a second control.
 */
export function WorktreePicker({ current }: { current: { name: string; path: string } }) {
  const [worktrees, setWorktrees] = React.useState<readonly WorktreeSummary[] | null>(null)

  // The registry of served worktrees lives at the root whichever page is open.
  // It is the picker's own concern, so no surface has to fetch it to have one.
  React.useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const next = await IndexApi.read(controller.signal)
        if (!controller.signal.aborted) setWorktrees(next)
      } catch {
        // Nothing to say: the header falls back to the plain name.
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  const options: Option[] = (worktrees ?? [])
    .filter((row) => row.conflict === null)
    .map((row) => ({ key: row.key, name: row.name, path: row.path }))
    .toSorted((left, right) => left.name.localeCompare(right.name))
  const selected = options.find((option) => option.path === current.path) ?? null
  const parent = parentPath(current.path)

  return (
    <span className="flex items-baseline gap-2">
      {options.length === 0 ? <span className="font-medium">{current.name}</span> : (
        <Combobox
          items={options}
          value={selected}
          itemToStringLabel={(option: Option) => option.name}
          isItemEqualToValue={(left: Option, right: Option) => left.key === right.key}
          filter={matches}
          onValueChange={(next: Option | null) => {
            if (next === null || next.key === selected?.key) return
            window.location.assign(`/w/${next.key}/`)
          }}
        >
          <ComboboxInput aria-label="Switch worktree" placeholder="Switch worktree" size={controlCharacters} />
          <ComboboxContent>
            <ComboboxEmpty>No worktree matches</ComboboxEmpty>
            <ComboboxList>
              {(option: Option) => (
                <ComboboxItem key={option.key} value={option}>
                  <WorktreeLabel {...option} />
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
      {parent === '' ? null : (
        <Copyable value={current.path}>
          <span className="text-sm font-normal text-muted-foreground">{parent}</span>
        </Copyable>
      )}
    </span>
  )
}
