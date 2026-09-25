import { House } from 'lucide-react'

import type { AcrossSection, ProjectSection as ProjectSectionShape, SectionHead } from '../lib/dashboard'
import { acrossName } from '../lib/dashboard'
import {
  acrossMeaning,
  bareHeadMeaning,
  folderHeadMeaning,
  mainMeaning,
  notTrackedMeaning,
  quietAcrossMeaning,
  quietHeadMeaning,
  trackedHeadMeaning,
  untrackedHeadMeaning,
} from '../lib/index-meanings'
import { cn } from '../lib/utils'
import { Explained, useTip } from './tip'
import { Badge } from './ui/badge'
import type { DragContext } from './worktree-cards'
import { EpicCard, LooseCard, NewEpicTarget } from './worktree-cards'
import { WorktreeMark } from './worktree-marks'
import type { RowContext } from './worktree-row'
import { Checkout, WorktreeRow } from './worktree-row'

/**
 * The index's stack: a section per project, headed by what heads it, with the
 * project's cards below, and one for the epics across projects, all ordered
 * alike, busiest first. A head is drawn as the constant it is and never
 * dragged.
 */

/** The columns a head shares with every row, so its name lines up with the names in the cards below. */
const headGrid = 'grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1'

/** What sets a head off from its cards: a rule under it, and a name a size above theirs. */
const headRule = 'border-b px-3 pb-3 text-base'

/**
 * A section's head, and where a quiet section says it is dim, in the words
 * true of what it heads; its cards are dim by what happens in each.
 */
function Head({ section, context }: { section: ProjectSectionShape; context: RowContext }) {
  const tip = useTip()
  const { head, name, quiet } = section
  return (
    <div title={quiet ? tip(quietHeadMeaning(head)) : undefined} className={cn(headRule, quiet && 'opacity-60')}>
      {head.kind === 'tracked'
        ? <WorktreeRow row={head.row} context={context} meaning={trackedHeadMeaning} name={name} />
        : <NamedHead head={head} name={name} />}
    </div>
  )
}

/**
 * A head that is no session's row, so it has no glyph, no link, no actions
 * and no agents: the daemon opens and lists nothing for what it does not
 * track. A main worktree with no session is named with what Git lists it as
 * having checked out, and marked as not tracked; a repository Git lists by its
 * Git directory is named alone, since no worktree is there to have anything
 * checked out and no session belongs there; a folder outside Git is named
 * alone, since it has no Git to ask.
 */
function NamedHead({ head, name }: { head: Exclude<SectionHead, { kind: 'tracked' }>; name: string }) {
  const tip = useTip()
  const path = head.kind === 'folder' ? head.path : head.repository.path
  return (
    <div className={headGrid}>
      <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {head.kind === 'untracked' ? (
          <>
            <Explained meaning={mainMeaning} className="text-muted-foreground">
              <House aria-hidden className="size-3.5" />
            </Explained>
            <Explained meaning={untrackedHeadMeaning}>
              <WorktreeMark />
            </Explained>
          </>
        ) : null}
        <span
          className={cn('min-w-0 font-medium wrap-anywhere', head.kind !== 'folder' && 'text-muted-foreground')}
          title={tip(path)}
        >
          {name}
        </span>
        {head.kind === 'untracked' ? <Badge variant="outline" title={tip(notTrackedMeaning)}>Not tracked</Badge> : null}
        {head.kind === 'bare' ? <Badge variant="outline" title={tip(bareHeadMeaning)}>Git directory</Badge> : null}
        {head.kind === 'folder' ? <Badge variant="outline" title={tip(folderHeadMeaning)}>Outside Git</Badge> : null}
      </div>
      {head.kind === 'untracked' ? (
        <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {head.repository.checkout === null
            ? <span className="text-xs">Git could not list this repository.</span>
            : <Checkout branch={head.repository.checkout.branch} detached={head.repository.checkout.detached} />}
        </div>
      ) : null}
    </div>
  )
}

/**
 * One project's section: its head, then its cards, busiest first, and,
 * while one of its worktrees is held, the `+` after them that starts an epic
 * of that worktree alone. A project whose worktrees are all in epics across
 * projects is its head alone, the home its worktrees go back to.
 */
export function ProjectSection({ section, context, newEpicOf }: {
  section: ProjectSectionShape
  context: DragContext
  /** The name of the worktree held from this project, whose `+` this section draws; null while none is. */
  newEpicOf: string | null
}) {
  const { cards } = section
  return (
    <section aria-label={section.name} className="flex flex-col gap-3">
      <Head section={section} context={context} />
      {cards.length === 0 && newEpicOf === null ? null : (
        <div className="worktree-cards">
          {cards.map((card) =>
            card.kind === 'epic'
              ? <EpicCard key={`epic:${card.name}`} card={card} context={context} />
              : <LooseCard key={card.row.path} card={card} context={context} />
          )}
          {newEpicOf === null ? null : <NewEpicTarget name={newEpicOf} context={context} />}
        </div>
      )}
    </section>
  )
}

/**
 * The epics whose worktrees belong to more than one project, each drawn once,
 * in a section of their own, since an epic across projects is the one thing
 * higher than a project. It stands among the projects by what is happening in
 * it, dim and last when nothing is, and its heading lines up with the names
 * in the heads.
 */
export function AcrossProjects({ section, context }: { section: AcrossSection; context: DragContext }) {
  const tip = useTip()
  return (
    <section aria-label={acrossName} className="flex flex-col gap-3">
      <div
        title={section.quiet ? tip(quietAcrossMeaning) : undefined}
        className={cn(headGrid, headRule, section.quiet && 'opacity-60')}
      >
        <h2 className="col-start-2 font-medium">
          <Explained meaning={acrossMeaning}>{acrossName}</Explained>
        </h2>
      </div>
      <div className="worktree-cards">
        {section.cards.map((card) => <EpicCard key={`epic:${card.name}`} card={card} context={context} />)}
      </div>
    </section>
  )
}
