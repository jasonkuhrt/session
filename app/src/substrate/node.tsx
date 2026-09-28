import { Link } from '@tanstack/react-router'
import * as React from 'react'

import { cn } from '../lib/utils'
import { leafOf, pathKey } from './path'
import type { Path } from './seam'
import { useSurfaceContext } from './surface-context'

/**
 * A node the view draws: something the focus can be on. It says where it is,
 * so the moves read it at its level in the drawn geometry, and it draws the
 * focus as a soft fill with a rule at its left edge, and a mark as a dot. The
 * surface hears its clicks. A node a click opens another page from is drawn
 * as a link to that page's address, so the browser treats it as one: a click
 * with a modifier or the middle button opens a new tab, the context menu
 * offers it, and the status bar shows where it goes. When it becomes the
 * focus it brings itself into view, so a move scrolls to what it reached and
 * a read that moves nodes around never scrolls the page.
 */
export function Node({ path, as: Tag = 'div', holds = false, className, nodeRef, children, ...rest }: {
  readonly path: Path
  readonly as?: 'div' | 'li' | 'section' | 'h2' | 'h3'
  /**
   * Whether other nodes are drawn inside this one, as a worktree's part of a
   * lane holds its cards: a click on its own space only takes the focus, and
   * it is never a link, since a link cannot hold another.
   */
  readonly holds?: boolean
  readonly className?: string | undefined
  /** A ref the drag library also needs on this element. */
  readonly nodeRef?: ((element: Element | null) => void) | undefined
  readonly children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const { focusKey, marks, scopeOf, register, linkOf } = useSurfaceContext()
  const key = pathKey(path)
  const focused = key === focusKey
  const marked = marks.has(leafOf(path))
  const element = React.useRef<Element | null>(null)
  const scope = scopeOf(leafOf(path))
  // Registered from its element, so a node that becomes a link, or stops
  // being one, which is another element, registers the one drawn.
  const ref = React.useCallback((node: Element | null) => {
    element.current = node
    nodeRef?.(node)
    if (node !== null) register(key, { scope, element: node, holds })
    return () => {
      element.current = null
      nodeRef?.(null)
      register(key, null)
    }
  }, [nodeRef, register, key, scope, holds])
  const link = holds ? null : linkOf(path)
  const linked = link !== null
  React.useEffect(() => {
    if (focused) element.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [focused])
  const attributes = {
    ref,
    'data-node': key,
    // Never the browser's focus, which stays with the page, so every key
    // reaches the registry: the focus is the substrate's, drawn on the node.
    tabIndex: -1,
    'data-focused': focused ? '' : undefined,
    'data-marked': marked ? '' : undefined,
    className: cn(
      'relative scroll-my-12 rounded-md data-focused:bg-primary/10 data-focused:shadow-[inset_2px_0_0_var(--color-primary)]',
      // A link is inline by itself, and a node is a block unless it says otherwise.
      linked && 'block',
      className,
    ),
    ...rest,
  }
  const content = (
    <>
      {children}
      {marked ? <span aria-label="marked" className="absolute top-2.5 right-2 size-1.5 rounded-full bg-primary" /> : null}
    </>
  )
  return link === null ? <Tag {...attributes}>{content}</Tag> : <Link {...link} {...attributes}>{content}</Link>
}
