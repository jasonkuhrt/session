import { CollisionPriority } from '@dnd-kit/abstract'
import { pointerDistance, pointerIntersection } from '@dnd-kit/collision'
import { DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react'
import * as React from 'react'

import type { WorktreeSummary } from '../../contract'
import type { AcrossSection, Dashboard, EpicCardShape, ProjectSection } from '../lib/dashboard'
import { acrossName, sectionKeyOf, sectionRowOf } from '../lib/dashboard'
import { landing } from '../lib/drag'
import type { DropOutcome, Holding } from '../lib/epics'
import { draggedId, draggedOf, dropOutcome, movable, outcomeWords, outlinedBy, targetId } from '../lib/epics'
import { epicList, sectionsList } from '../lib/order'
import { cn } from '../lib/utils'
import { idOf, rootId } from '../levels'
import { Node } from '../substrate/node'
import type { Path } from '../substrate/seam'
import type { OutlineContext } from './index-outline-parts'
import { HeldCopy, NewEpicTarget, RefusedRow, rowGrid, WorktreeNode } from './index-outline-parts'
import { LandingLine, markedSide } from './landing-line'
import { useTip } from './tip'
import { Card, CardContent } from './ui/card'

/**
 * The index as an outline: one column of projects, each a card holding its
 * rows, the project's own, then its epics, each a heading over its worktrees,
 * and its worktrees in no epic, each row its name, the glyph of what its
 * session holds, and its marks. Every fact beyond those is in the detail line
 * while the row has the focus. Ordering, ranks and dimming are the stack's:
 * the projects placed by hand first, the rest and every card by what is
 * happening in them, quiet ones dim and last.
 *
 * Drag stays for the mouse: a worktree is held by its row, an epic by its
 * row, and a project by its row while a main worktree with a session heads
 * it, and each drop is the one a command also makes: carry, join, leave, or
 * rename into another epic's name.
 */

/** Every card takes worktrees and epics; a project is placed among the sections instead. */
const cardsAccept = ['row', 'epic']


/** One ref for an element that is two things to the drag library at once, held and taking others. */
function useBothRefs(first: (element: Element | null) => void, second: (element: Element | null) => void) {
  return React.useCallback((element: Element | null) => {
    first(element)
    second(element)
  }, [first, second])
}

/**
 * A worktree in an epic, held by its row: dragged up or down within its epic
 * it takes a place there, onto another epic it joins it, onto a worktree in
 * no epic the two make one, and onto the space between the rows it leaves.
 */
function MemberRow({ path, row, epic, context }: { path: Path; row: WorktreeSummary; epic: string; context: OutlineContext }) {
  const { ref: holdRef, isDragSource } = useDraggable({
    id: draggedId({ kind: 'row', path: row.path }),
    type: 'row',
    disabled: !movable(row) || context.writing,
  })
  const { ref: dropRef } = useDroppable({
    id: targetId({ kind: 'member', path: row.path }),
    accept: cardsAccept,
    collisionDetector: pointerIntersection,
    collisionPriority: CollisionPriority.High,
    disabled: context.writing,
  })
  const ref = useBothRefs(holdRef, dropRef)
  const side = markedSide({ marker: context.marker, list: epicList(epic), id: row.path })
  return (
    <WorktreeNode path={path} nodeRef={ref} className={cn(isDragSource && 'opacity-40')} row={row} context={context} indent="pl-8">
      {side === null ? null : <LandingLine side={side} gap="row" />}
    </WorktreeNode>
  )
}

/** A worktree in no epic: onto an epic it joins it, onto another like it the two make an epic, and onto the `+` an epic of its own. */
function LooseRow({ path, row, context, quiet }: { path: Path; row: WorktreeSummary; context: OutlineContext; quiet: boolean }) {
  const onto = targetId({ kind: 'loose', path: row.path })
  const { ref: holdRef, isDragSource } = useDraggable({
    id: draggedId({ kind: 'row', path: row.path }),
    type: 'row',
    disabled: !movable(row) || context.writing,
  })
  const { ref: dropRef } = useDroppable({ id: onto, accept: cardsAccept, collisionDetector: pointerIntersection, collisionPriority: CollisionPriority.Normal, disabled: context.writing })
  const ref = useBothRefs(holdRef, dropRef)
  return (
    <WorktreeNode
      path={path}
      nodeRef={ref}
      className={cn(quiet && 'opacity-60', isDragSource && 'opacity-40', context.landingOn === onto && landing)}
      row={row}
      context={context}
      indent="pl-4"
    />
  )
}

/**
 * An epic within its project's card: its row, drawn as a heading over its
 * worktrees, and its worktrees. It takes a worktree or a whole epic dropped
 * on it, and is held by its row.
 */
function EpicBlock({ projectPath, card, context }: { projectPath: Path; card: EpicCardShape; context: OutlineContext }) {
  const into = targetId({ kind: 'epic', name: card.name })
  const tip = useTip()
  const { ref: holdRef, isDragSource } = useDraggable({ id: draggedId({ kind: 'epic', name: card.name }), type: 'epic', disabled: context.writing })
  const { ref: dropRef } = useDroppable({ id: into, accept: cardsAccept, collisionDetector: pointerIntersection, collisionPriority: CollisionPriority.Normal, disabled: context.writing })
  const path = [...projectPath, idOf({ kind: 'epic', name: card.name })]
  return (
    // Its room above and below is its own, so a held worktree passes from a
    // row to the epic with no space between them, where it would leave.
    <div ref={dropRef} className={cn('rounded-md py-1', card.quiet && 'opacity-60', isDragSource && 'opacity-40', context.landingOn === into && landing)}>
      <Node path={path} nodeRef={holdRef} className={rowGrid}>
        <span
          className="min-w-0 truncate pl-4 text-xs font-medium tracking-wide text-muted-foreground"
          title={tip(`The epic “${card.name}”: the worktrees whose sessions name it.`)}
        >
          {card.name}
        </span>
        <span />
        <span />
      </Node>
      {card.rows.map((row) => (
        <MemberRow key={row.path} path={[...path, idOf({ kind: 'worktree', path: row.path })]} row={row} epic={card.name} context={context} />
      ))}
    </div>
  )
}

/** The words a head that is no session's row reads as, beside its name. */
const headWord = { untracked: 'Not tracked', bare: 'Git directory', folder: 'Outside Git' } as const

/** The row a project's head is drawn as: its main worktree's while it has a session, or the folder outside Git it is. */
const headRowOf = (section: ProjectSection, rows: readonly WorktreeSummary[]): WorktreeSummary | null => {
  const { head } = section
  if (head.kind === 'tracked') return head.row
  return head.kind === 'folder' ? rows.find((row) => row.path === head.path) ?? null : null
}

/** A head that is no session's row: its name, dim, and what it is. */
function NamedHead({ section }: { section: ProjectSection }) {
  const tip = useTip()
  const { head } = section
  if (head.kind === 'tracked') return null
  return (
    <>
      <span className="min-w-0 truncate font-medium text-muted-foreground" title={tip(head.kind === 'folder' ? head.path : head.repository.path)}>
        {section.name} <span className="text-xs font-normal">· {headWord[head.kind]}</span>
      </span>
      <span />
      <span />
    </>
  )
}

/** A project's card or the one across projects: the stock card, holding the rows. */
function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col">{children}</CardContent>
    </Card>
  )
}

/** A project's card, its head and its rows: held by its head, while a main worktree with a session heads it, it takes a place among the projects. */
function ProjectBlock({ section, context, newEpicOf }: { section: ProjectSection; context: OutlineContext; newEpicOf: string | null }) {
  const main = sectionRowOf(section)
  const path = [rootId, idOf({ kind: 'project', key: section.key })]
  const { ref: holdRef, isDragSource } = useDraggable({
    id: draggedId({ kind: 'head', path: main?.path ?? section.key }),
    type: 'head',
    disabled: main === null || context.writing,
  })
  const { ref: dropRef } = useDroppable({ id: targetId({ kind: 'section', key: section.key }), accept: 'head', collisionDetector: pointerDistance, disabled: context.writing })
  const side = markedSide({ marker: context.marker, list: sectionsList, id: section.key })
  const head = headRowOf(section, context.rows)
  return (
    <section ref={dropRef} aria-label={section.name} className={cn('relative', isDragSource && 'opacity-40')}>
      {side === null ? null : <LandingLine side={side} gap="section" />}
      <SectionCard>
        {head === null
          ? <Node path={path} nodeRef={holdRef} className={cn(rowGrid, section.quiet && 'opacity-60')}><NamedHead section={section} /></Node>
          : (
            <WorktreeNode
              path={path}
              nodeRef={holdRef}
              className={cn(section.quiet && 'opacity-60')}
              row={head}
              name={section.name}
              context={context}
              indent=""
              heading
            />
          )}
        {section.cards.map((card) =>
          card.kind === 'epic'
            ? <EpicBlock key={`epic:${card.name}`} projectPath={path} card={card} context={context} />
            : card.row.path === head?.path
            ? null
            : <LooseRow key={card.row.path} path={[...path, idOf({ kind: 'worktree', path: card.row.path })]} row={card.row} context={context} quiet={card.quiet} />
        )}
        {newEpicOf === null ? null : <NewEpicTarget name={newEpicOf} context={context} />}
      </SectionCard>
    </section>
  )
}

/** The epics whose worktrees belong to more than one project, under a heading of their own that is a node like a project's. */
function AcrossBlock({ section, context }: { section: AcrossSection; context: OutlineContext }) {
  const tip = useTip()
  const path = [rootId, idOf({ kind: 'project', key: section.key })]
  const { ref: dropRef } = useDroppable({ id: targetId({ kind: 'section', key: section.key }), accept: 'head', collisionDetector: pointerDistance, disabled: context.writing })
  const side = markedSide({ marker: context.marker, list: sectionsList, id: section.key })
  return (
    <section ref={dropRef} aria-label={acrossName} className="relative">
      {side === null ? null : <LandingLine side={side} gap="section" />}
      <SectionCard>
        <Node path={path} className={cn(rowGrid, section.quiet && 'opacity-60')}>
          <span className="min-w-0 truncate font-medium" title={tip('Epics whose worktrees belong to more than one project, drawn once here.')}>{acrossName}</span>
          <span />
          <span />
        </Node>
        {section.cards.map((card) => <EpicBlock key={`epic:${card.name}`} projectPath={path} card={card} context={context} />)}
      </SectionCard>
    </section>
  )
}

/**
 * The space between and below the rows: a worktree dropped here leaves its
 * epic. It ranks below every row, so the pointer over a row is over the row.
 */
function RowSpace({ context, children }: { context: OutlineContext; children: React.ReactNode }) {
  const space = targetId({ kind: 'space' })
  const { ref } = useDroppable({ id: space, accept: cardsAccept, collisionDetector: pointerIntersection, collisionPriority: CollisionPriority.Lowest, disabled: context.writing })
  return <div ref={ref} className={cn('flex flex-col gap-4 rounded-md pb-24', context.landingOn === space && landing)}>{children}</div>
}

/** The outline, as what is held and what it is over draw it. */
export function IndexOutline({ dashboard, context, holding }: { dashboard: Dashboard; context: OutlineContext; holding: Holding | null }) {
  const outcome: DropOutcome | null = holding === null ? null : dropOutcome({ rows: context.rows, dashboard, holding })
  const target = holding?.target ?? null
  const held: OutlineContext = {
    ...context,
    landingOn: outcome === null || target === null ? null : outlinedBy({ outcome, target }),
    marker: outcome?.kind === 'order' ? outcome.marker : null,
  }
  const dragged = holding?.dragged ?? null
  const heldRow = dragged?.kind === 'row' ? context.rows.find((row) => row.path === dragged.path) ?? null : null
  const home = heldRow === null ? null : sectionKeyOf(heldRow)
  return (
    <>
      <RowSpace context={held}>
        {dashboard.sections.map((section) =>
          section.kind === 'across'
            ? <AcrossBlock key={section.key} section={section} context={held} />
            : <ProjectBlock key={section.key} section={section} context={held} newEpicOf={section.key === home ? heldRow?.name ?? null : null} />
        )}
        {context.rows.filter((row) => !row.resolved).map((row) => <RefusedRow key={row.path} row={row} />)}
      </RowSpace>
      {/* Dropped, the row is drawn where the drop put it, so nothing flies back first. */}
      <DragOverlay dropAnimation={null}>
        {(carried) => (
          <HeldCopy
            dragged={draggedOf(carried.id)}
            dashboard={dashboard}
            context={context}
            words={outcome === null ? null : outcomeWords({ outcome, rows: context.rows })}
          />
        )}
      </DragOverlay>
    </>
  )
}
