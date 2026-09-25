import { House } from 'lucide-react'

import type { Repository } from '../../contract'
import type { EpicCardShape, RepositorySection, SectionHead } from '../lib/dashboard'
import { cn } from '../lib/utils'
import { Explained, useTip } from './tip'
import { Badge } from './ui/badge'
import type { DragContext } from './worktree-cards'
import { EpicCard, LooseCard, NewEpicTarget } from './worktree-cards'
import { WorktreeMark } from './worktree-marks'
import type { RowContext } from './worktree-row'
import { Checkout, mainMeaning, WorktreeRow } from './worktree-row'

/**
 * The index's stack: the epics whose worktrees belong to more than one
 * repository, drawn once above the rest, then a section per repository,
 * headed by its main worktree, drawn as the constant it is and never dragged,
 * with the repository's cards below it.
 */

/** The order the repositories stand in, said by every head, since the page has no heading to say it once. */
const repositoryOrder = 'The repositories with a live agent come first, then the newest activity.'

const headMeaning =
  `A main worktree, on this page while it has a session, at the head of its repository: below it stand the repository’s epics and its worktrees in no epic. ${repositoryOrder}`

const untrackedHeadMeaning =
  `A main worktree with no session, at the head of its repository all the same, so that its worktrees have a home: below it stand the repository’s epics and its worktrees in no epic. ${repositoryOrder}`

const notTrackedMeaning =
  'This main worktree has no session, so the daemon does not track it and it has no board. A session command run in it, such as session init, gives it one and puts it on this page.'

const quietRepositoryMeaning = 'Nothing is live here and nothing has happened in five days, so this repository is dim, and last.'

const acrossMeaning =
  'Epics whose worktrees belong to more than one repository, each drawn once, here, above the repositories. A worktree that leaves one goes back to its repository.'

/** The columns a head shares with every row, so its name lines up with the names in the cards below. */
const headGrid = 'grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1'

/** What sets a head off from its cards: a rule under it, and a name a size above theirs. */
const headRule = 'border-b px-3 pb-3 text-base'

/**
 * A section's head: the main worktree's row while it has a session, or the
 * repository as Git names it when it has none, its name a size above the
 * cards' so it reads as the heading of what is below it. The head is where a
 * quiet repository says it is dim; its cards are dim by what happens in each.
 */
function Head({ head, quiet, context }: { head: SectionHead; quiet: boolean; context: RowContext }) {
  const tip = useTip()
  return (
    <div title={quiet ? tip(quietRepositoryMeaning) : undefined} className={cn(headRule, quiet && 'opacity-60')}>
      {head.kind === 'tracked'
        ? <WorktreeRow row={head.row} context={context} meaning={headMeaning} />
        : <UntrackedHead repository={head.repository} />}
    </div>
  )
}

/**
 * The head of a repository whose main worktree has no session: its name and
 * what it has checked out, as Git lists them, marked as not tracked. It has no
 * glyph, since no session holds items there, no link, since there is no board,
 * and no actions or agents, since the daemon opens and lists nothing for a
 * worktree it does not track.
 */
function UntrackedHead({ repository }: { repository: Repository }) {
  const tip = useTip()
  return (
    <div className={headGrid}>
      <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Explained meaning={mainMeaning} className="text-muted-foreground">
          <House aria-hidden className="size-3.5" />
        </Explained>
        <span className="flex min-w-0 items-center gap-1.5">
          <Explained meaning={untrackedHeadMeaning}>
            <WorktreeMark />
          </Explained>
          <span className="min-w-0 font-medium wrap-anywhere text-muted-foreground" title={tip(repository.path)}>
            {repository.name}
          </span>
        </span>
        <Badge variant="outline" title={tip(notTrackedMeaning)}>Not tracked</Badge>
      </div>
      <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {repository.checkout === null
          ? <span className="text-xs">Git could not list this repository.</span>
          : <Checkout branch={repository.checkout.branch} detached={repository.checkout.detached} />}
      </div>
    </div>
  )
}

/**
 * One repository's section: its head, then its cards, busiest first, and,
 * while one of its worktrees is held, the `+` after them that starts an epic
 * of that worktree alone. A section with nothing to draw, a folder outside Git
 * whose worktree is in an epic across repositories, is drawn only while that
 * worktree is held, for its `+`.
 */
export function ProjectSection({ section, context, newEpicOf }: {
  section: RepositorySection
  context: DragContext
  /** The name of the worktree held from this repository, whose `+` this section draws; null while none is. */
  newEpicOf: string | null
}) {
  const { head, cards } = section
  if (head === null && cards.length === 0 && newEpicOf === null) return null
  return (
    <section aria-label={section.name} className="flex flex-col gap-3">
      {head === null ? null : <Head head={head} quiet={section.quiet} context={context} />}
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
 * The epics whose worktrees belong to more than one repository, each drawn
 * once, above the repositories, since an epic is the one thing higher than a
 * repository. Its heading lines up with the names in the heads below it.
 */
export function AcrossProjects({ cards, context }: { cards: readonly EpicCardShape[]; context: DragContext }) {
  if (cards.length === 0) return null
  return (
    <section aria-label="Across projects" className="flex flex-col gap-3">
      <div className={cn(headGrid, headRule)}>
        <h2 className="col-start-2 font-medium">
          <Explained meaning={acrossMeaning}>Across projects</Explained>
        </h2>
      </div>
      <div className="worktree-cards">
        {cards.map((card) => <EpicCard key={`epic:${card.name}`} card={card} context={context} />)}
      </div>
    </section>
  )
}
