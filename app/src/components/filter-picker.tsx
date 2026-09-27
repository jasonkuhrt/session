import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type { Session } from '../../contract'
import { useNow } from '../lib/clock'
import type { Filter, FilterOption, UnionFilter } from '../lib/filter'
import { filterId, filterOf, filterOptions, toFilter, unionOf } from '../lib/filter'
import { checkoutLabel } from '../lib/format'
import { reads, sinceMount } from '../lib/reads'
import { cn } from '../lib/utils'
import { useTip } from './tip'
import { Button } from './ui/button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox'
import { CheckoutMark, EpicMark, ProjectMark, WorktreeMark } from './worktree-marks'

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
  className?: string | undefined
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

/** How many worktrees an epic or a project holds, in words. */
const worktreeCount = (count: number) => `${count} ${count === 1 ? 'worktree' : 'worktrees'}`

/**
 * How the picker names an epic or a project, in the same two lines: its mark
 * and its name, over how many worktrees are in it, under a worktree's mark.
 * Until the rows are read there is no count to give.
 */
function UnionLabel({ kind, name, count, className }: {
  kind: UnionFilter['kind']
  name: string
  count: number | null
  className?: string | undefined
}) {
  return (
    <span className={cn('grid min-w-0 gap-0.5 text-left', className)}>
      <span className="flex min-w-0 items-center gap-1.5">
        {kind === 'epic' ? <EpicMark /> : <ProjectMark />}
        <span className="truncate font-medium">{name}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
        <WorktreeMark />
        <span className="truncate">{count === null ? 'Worktrees' : worktreeCount(count)}</span>
      </span>
    </span>
  )
}

function OptionLabel({ option }: { option: FilterOption }) {
  if (option.kind === 'worktree') return <WorktreeLabel name={option.name} branch={option.branch} detached={option.detached} />
  return <UnionLabel kind={option.kind} name={option.name} count={option.count} />
}

/** What picking an option does, as its tip. */
const optionMeaning = (option: FilterOption) => {
  if (option.kind === 'worktree') return `Switch to the board of ${option.name}.`
  if (option.kind === 'epic') return `Switch to the board of the epic “${option.name}”, the lanes of its ${worktreeCount(option.count)}.`
  return `Switch to the board of the project ${option.name}, at ${option.path}, the lanes of its ${worktreeCount(option.count)}.`
}

/** A kind of filter as the list heads it, with what a board of that kind shows. */
type PickerGroup = { readonly label: string; readonly meaning: string; readonly items: readonly FilterOption[] }

const groupMeanings = {
  worktrees: 'Each worktree’s own board: its session’s lanes, with its agents, its pull request and its pages.',
  epics: 'Each epic’s board: the lanes of every worktree whose session names it, each under its name.',
  projects: 'Each project’s board: the lanes of every worktree of its repository, or of the one folder outside Git it is, each under its name.',
} as const

/** What the control says it is, for each kind of board. */
const controlMeanings = {
  worktree: 'The worktree whose session this board shows, and the branch checked out in it. Pick another worktree, an epic or a project to switch to its board.',
  epic: 'The epic this board shows: every worktree whose session names it, how many under its name. Pick a worktree, another epic or a project to switch to its board.',
  project: 'The project this board shows: every worktree of its repository, or the folder outside Git it is, how many under its name. Pick a worktree, an epic or another project to switch to its board.',
} as const

/** Typing narrows on what the list shows: a worktree's name or branch, an epic's name, a project's name or path. */
const matches = (option: FilterOption, query: string) => {
  const needle = query.trim().toLowerCase()
  const shown = option.kind === 'worktree'
    ? `${option.name} ${option.branch ?? ''}`
    : option.kind === 'project'
    ? `${option.name} ${option.path}`
    : option.name
  return needle === '' || shown.toLowerCase().includes(needle)
}

/** Whether an option is what the board shows: the worktree at the path the board's own read gives, or the epic or project of the filter. */
const isShown = ({ option, filter, worktree }: {
  option: FilterOption
  filter: Filter
  worktree: NonNullable<Session['worktree']> | undefined
}) => {
  if (option.kind === 'worktree') return filter.kind === 'worktree' && option.path === worktree?.path
  if (option.kind === 'epic') return filter.kind === 'epic' && option.name === filter.name
  return filter.kind === 'project' && option.path === filter.path
}

/** The name a union goes by before the rows say it: the epic's own, or the last folder of the project's path. */
const unreadName = (filter: UnionFilter) => (filter.kind === 'epic' ? filter.name : filter.path.split('/').at(-1) ?? filter.path)

/**
 * What the board shows, as the control that switches to another board: a
 * worktree with the branch checked out in it, an epic or a project with how
 * many worktrees are in it. The list holds every worktree the daemon serves,
 * every epic and every project, under a heading for each kind, and picking
 * one opens its board.
 *
 * The options are read from the rows of the root index; a row the daemon
 * refuses to serve is not somewhere this can go. Until that list arrives, and
 * if it never does, the control is plain text: the board itself never depends
 * on the index answering, and a worktree's board names its worktree from its
 * own read, which is newer than the index's whenever the two differ.
 */
export function FilterPicker({ filter, worktree }: {
  filter: Filter
  /** On a worktree's board, the worktree as the board's own read gives it. */
  worktree?: NonNullable<Session['worktree']> | undefined
}) {
  // The registry of served worktrees lives at the root whichever page is open.
  // It is the picker's own concern, so no surface has to fetch it to have one,
  // and on a worktree's board it is read once: a failed read says nothing, and
  // the header falls back to the plain name and branch. Only what this board
  // read counts, not rows the page it came from last drew.
  const rows = sinceMount(useQuery(reads.worktrees()))
  const now = useNow()
  const tip = useTip()
  const navigate = useNavigate()
  if (filter.kind === 'worktree' && worktree === undefined) return null

  const lists = rows === undefined ? null : filterOptions({ rows, now })
  const groups: PickerGroup[] = lists === null ? [] : [
    { label: 'Worktrees', meaning: groupMeanings.worktrees, items: lists.worktrees },
    { label: 'Epics', meaning: groupMeanings.epics, items: lists.epics },
    { label: 'Projects', meaning: groupMeanings.projects, items: lists.projects },
  ].filter(group => group.items.length > 0)
  const options = groups.flatMap(group => group.items)
  const selected = options.find(option => isShown({ option, filter, worktree })) ?? null
  const union = filter.kind === 'worktree' || rows === undefined ? null : unionOf({ filter, rows, now })
  const label = (className?: string) => (filter.kind === 'worktree'
    ? worktree === undefined ? null : <WorktreeLabel name={worktree.name} branch={worktree.branch} detached={worktree.detached} className={className} />
    : <UnionLabel kind={filter.kind} name={union?.name ?? unreadName(filter)} count={union?.rows.length ?? null} className={className} />)

  // As wide as the control that replaces it can be, so a long branch is cut the same way.
  if (options.length === 0) return label('max-w-80')

  return (
    <Combobox
      items={groups}
      value={selected}
      itemToStringLabel={(option: FilterOption) => option.name}
      isItemEqualToValue={(left: FilterOption, right: FilterOption) => filterId(filterOf(left)) === filterId(filterOf(right))}
      filter={matches}
      // Typing narrows to the board wanted, so Enter goes there.
      autoHighlight
      onValueChange={(next: FilterOption | null) => {
        if (next === null || isShown({ option: next, filter, worktree })) return
        // Within the document, as a link to the board goes.
        void navigate(toFilter(filterOf(next)))
      }}
    >
      <ComboboxTrigger
        aria-label="Switch board"
        title={tip(controlMeanings[filter.kind])}
        render={<Button variant="outline" className="h-auto max-w-80 justify-between gap-3 py-1.5" />}
      >
        {label()}
      </ComboboxTrigger>
      {/* The popup grows to the longest option, up to a cap past which a line
          is cut short, so a long name does not squeeze every other one, and is
          never narrower than what its field asks for. */}
      <ComboboxContent className="w-auto max-w-[min(36rem,var(--available-width))] min-w-[max(18rem,calc(var(--anchor-width)+--spacing(7)))]">
        <ComboboxInput showTrigger={false} aria-label="Find a worktree, an epic or a project" placeholder="Find a worktree, epic or project" />
        <ComboboxEmpty>Nothing matches</ComboboxEmpty>
        <ComboboxList className="max-h-[min(28rem,calc(var(--available-height)---spacing(9)))]">
          {(group: PickerGroup) => (
            <ComboboxGroup key={group.label} items={group.items}>
              <ComboboxLabel title={tip(group.meaning)}>{group.label}</ComboboxLabel>
              <ComboboxCollection>
                {(option: FilterOption) => (
                  <ComboboxItem key={filterId(filterOf(option))} value={option} title={tip(optionMeaning(option))}>
                    <OptionLabel option={option} />
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
