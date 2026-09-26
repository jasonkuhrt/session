import { CollisionPriority } from '@dnd-kit/abstract'
import { pointerIntersection } from '@dnd-kit/collision'
import { DragOverlay, useDroppable } from '@dnd-kit/react'
import type * as React from 'react'

import type { Dashboard } from '../lib/dashboard'
import { epicCardsOf, sectionKeyOf } from '../lib/dashboard'
import { landing } from '../lib/drag'
import type { Dragged, Holding } from '../lib/epics'
import { draggedOf, dropOutcome, outcomeWords, outlinedBy, targetId } from '../lib/epics'
import { cn } from '../lib/utils'
import type { DragContext } from './worktree-cards'
import { cardsAccept, HeldPreview } from './worktree-cards'
import { AcrossProjects, ProjectSection } from './worktree-sections'

/**
 * The stack, as what is held and what it is over draw it: the card it would
 * land in is outlined, or, for a place among its siblings, a line drawn where
 * it would go, and the pointer carries the card with the words of what
 * dropping it there would do. While a worktree is held, a `+` after its own
 * repository's cards takes it into an epic of its own, which stands there.
 */
export function WorktreeStack({ dashboard, context, holding }: {
  dashboard: Dashboard
  context: DragContext
  holding: Holding | null
}) {
  const outcome = holding === null ? null : dropOutcome({ rows: context.rows, dashboard, holding })
  const target = holding?.target ?? null
  const landingOn = outcome === null || target === null ? null : outlinedBy({ outcome, target })
  const held: DragContext = { ...context, landingOn, marker: outcome?.kind === 'order' ? outcome.marker : null }
  const dragged = holding?.dragged ?? null
  const heldRow = dragged?.kind === 'row' ? context.rows.find((row) => row.path === dragged.path) ?? null : null
  const home = heldRow === null ? null : sectionKeyOf(heldRow)
  return (
    <>
      <CardSpace context={held}>
        <div className="flex flex-col gap-10">
          {dashboard.sections.map((section) =>
            section.kind === 'across'
              ? <AcrossProjects key={section.key} section={section} context={held} />
              : (
                <ProjectSection
                  key={section.key}
                  section={section}
                  context={held}
                  newEpicOf={section.key === home ? heldRow?.name ?? null : null}
                />
              )
          )}
        </div>
      </CardSpace>
      {/* Dropped, the card is drawn where the drop put it, so nothing flies back first. */}
      <DragOverlay dropAnimation={null}>
        {(carried) => (
          <Held
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

/** The card the pointer carries: the worktree's row, a project's head, or the whole epic, as each is drawn. */
function Held({ dragged, dashboard, context, words }: {
  dragged: Dragged | null
  dashboard: Dashboard
  context: DragContext
  words: string | null
}) {
  if (dragged === null) return null
  if (dragged.kind === 'epic') {
    const card = epicCardsOf(dashboard).find((candidate) => candidate.name === dragged.name)
    return card === undefined ? null : <HeldPreview held={{ kind: 'epic', card }} words={words} context={context} />
  }
  const row = context.rows.find((candidate) => candidate.path === dragged.path)
  return row === undefined ? null : <HeldPreview held={{ kind: dragged.kind, row }} words={words} context={context} />
}

/**
 * The space between and below the cards, the heads included: a worktree
 * dropped here leaves its epic and becomes a card of its own under its
 * repository, wherever it was dropped. It ranks below every card, so the
 * pointer over a card is over the card.
 */
function CardSpace({ context, children }: { context: DragContext; children: React.ReactNode }) {
  const space = targetId({ kind: 'space' })
  const { ref } = useDroppable({
    id: space,
    accept: cardsAccept,
    collisionDetector: pointerIntersection,
    collisionPriority: CollisionPriority.Lowest,
    disabled: context.writing,
  })
  return <div ref={ref} className={cn('flex-1 rounded-xl pb-24', context.landingOn === space && landing)}>{children}</div>
}
