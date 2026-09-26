import { pointerDistance } from '@dnd-kit/collision'
import { useDraggable, useDroppable } from '@dnd-kit/react'
import { House } from 'lucide-react'
import type * as React from 'react'

import type { AcrossSection, ProjectSection as ProjectSectionShape, SectionHead } from '../lib/dashboard'
import { acrossName, sectionRowOf } from '../lib/dashboard'
import { draggedId, targetId } from '../lib/epics'
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
import { sectionsList } from '../lib/order'
import { cn } from '../lib/utils'
import { LandingLine, markedSide } from './landing-line'
import { Explained, useTip } from './tip'
import { Badge } from './ui/badge'
import type { DragContext } from './worktree-cards'
import { EpicCard, LooseCard, NewEpicTarget } from './worktree-cards'
import { WorktreeMark } from './worktree-marks'
import type { RowContext } from './worktree-row'
import { Checkout, WorktreeRow } from './worktree-row'

/**
 * The index's stack: a section per project, headed by what heads it, with the
 * project's cards below, and one for the epics across projects. The sections
 * a main worktree placed by hand heads stand first, in their rank's order, and
 * the rest after them, busiest first. A section headed by a main worktree with
 * a session is held by its head and placed among the others; no other section
 * has a file of its own to keep a place in, so none other is held. A head is
 * never dragged over the project's cards.
 */

/** The columns a head shares with every row, so its name lines up with the names in the cards below. */
const headGrid = 'grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1'

/** What sets a head off from its cards: a rule under it, and a name a size above theirs. */
const headRule = 'border-b px-3 pb-3 text-base'

/**
 * A section's head, and where a quiet section says it is dim, in the words
 * true of what it heads; its cards are dim by what happens in each. A main
 * worktree's head is what holds its section, by `holdRef`.
 */
function Head({ section, context, holdRef }: {
  section: ProjectSectionShape
  context: RowContext
  holdRef: (element: Element | null) => void
}) {
  const tip = useTip()
  const { head, name, quiet } = section
  const title = quiet ? tip(quietHeadMeaning({ head, ranked: (sectionRowOf(section)?.rank ?? null) !== null })) : undefined
  if (head.kind !== 'tracked') {
    return (
      <div title={title} className={cn(headRule, quiet && 'opacity-60')}>
        <NamedHead head={head} name={name} />
      </div>
    )
  }
  return (
    <div
      ref={holdRef}
      // A role of its own, so the drag library does not make the head a button,
      // whose content would stop being controls: it holds a link and buttons.
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- An element that is dragged and holds its own controls has no tag of its own; `fieldset` groups a form's fields.
      role="group"
      aria-roledescription="Draggable project"
      aria-label={`Drag ${name}`}
      title={title}
      className={cn(headRule, 'cursor-grab outline-none', quiet && 'opacity-60')}
    >
      <WorktreeRow row={head.row} context={context} meaning={trackedHeadMeaning(head.row)} name={name} />
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
 * Where a held project lands among the sections: the section nearest the
 * pointer, the gaps between them included, is the one it goes before or
 * after, by which half of it the pointer is in. It takes nothing else.
 */
function useSectionDrop(key: string, context: DragContext) {
  return useDroppable({
    id: targetId({ kind: 'section', key }),
    accept: 'head',
    collisionDetector: pointerDistance,
    disabled: context.writing,
  })
}

/** A section's frame: the line where a held project would go before or after it, and faint while it is the one held. */
function SectionFrame({ label, sectionKey, context, held, dropRef, children }: {
  label: string
  sectionKey: string
  context: DragContext
  held: boolean
  dropRef: (element: Element | null) => void
  children: React.ReactNode
}) {
  const side = markedSide({ marker: context.marker, list: sectionsList, id: sectionKey })
  return (
    <section ref={dropRef} aria-label={label} className={cn('relative flex flex-col gap-3', held && 'opacity-40')}>
      {side === null ? null : <LandingLine side={side} gap="section" />}
      {children}
    </section>
  )
}

/**
 * One project's section: its head, then its cards, busiest first, and,
 * while one of its worktrees is held, the `+` after them that starts an epic
 * of that worktree alone. A project whose worktrees are all in epics across
 * projects is its head alone, the home its worktrees go back to. Held by the
 * head of its main worktree, while that has a session, it takes a place among
 * the sections.
 */
export function ProjectSection({ section, context, newEpicOf }: {
  section: ProjectSectionShape
  context: DragContext
  /** The name of the worktree held from this project, whose `+` this section draws; null while none is. */
  newEpicOf: string | null
}) {
  const { cards } = section
  const main = sectionRowOf(section)
  const { ref: holdRef, isDragSource } = useDraggable({
    id: draggedId({ kind: 'head', path: main?.path ?? section.key }),
    type: 'head',
    disabled: main === null || context.writing,
  })
  const { ref: dropRef } = useSectionDrop(section.key, context)
  return (
    <SectionFrame label={section.name} sectionKey={section.key} context={context} held={isDragSource} dropRef={dropRef}>
      <Head section={section} context={context} holdRef={holdRef} />
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
    </SectionFrame>
  )
}

/**
 * The epics whose worktrees belong to more than one project, each drawn once,
 * in a section of their own, since an epic across projects is the one thing
 * higher than a project. It stands after the projects placed by hand, among
 * the rest by what is happening in it, dim and last when nothing is, and its
 * heading lines up with the names in the heads. It has no file to keep a
 * place in, so it is never held, but a held project goes before or after it.
 */
export function AcrossProjects({ section, context }: { section: AcrossSection; context: DragContext }) {
  const tip = useTip()
  const { ref: dropRef } = useSectionDrop(section.key, context)
  return (
    <SectionFrame label={acrossName} sectionKey={section.key} context={context} held={false} dropRef={dropRef}>
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
    </SectionFrame>
  )
}
