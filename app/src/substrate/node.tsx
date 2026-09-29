import * as React from 'react'

import { cn } from '../lib/utils'
import { LinkHolder } from './link-holder'
import { leafOf, pathKey } from './path'
import type { Path } from './seam'
import { InsideLinkContext, useSurfaceContext } from './surface-context'

/**
 * A node the view draws: something the focus can be on. It says where it is,
 * so the moves read it at its level in the drawn geometry, and it draws the
 * focus as a ring around its whole surface, the surface of what the view
 * draws inside it, and a mark as a dot. The surface hears its clicks. A
 * node a click opens another page from is drawn as the app's link to that
 * page's address, so the browser treats it as one: a click with a modifier or
 * the middle button opens a new tab, the context menu offers it, and the
 * status bar shows where it goes. When it becomes the focus it brings itself
 * into view, so a move scrolls to what it reached and a read that moves nodes
 * around never scrolls the page.
 *
 * A link may hold no other, so a control of its own that belongs on the node,
 * such as a link to somewhere else, is drawn `beside` it. The node is then a
 * `LinkHolder`: the element that holds the link and what is beside it, and
 * its link is stretched across the node, so a click on the node is still the
 * node's, wherever it lands but on the control.
 */
export function Node({ path, as: Tag = 'div', holds = false, beside, className, nodeRef, children, ...rest }: {
  readonly path: Path
  readonly as?: 'div' | 'li' | 'section' | 'h2' | 'h3'
  /**
   * Whether the node is drawn around what a click inside it is meant for,
   * other nodes or a body of text: a click on it only takes the focus, and it
   * is never a link, since a link can hold no other link.
   */
  readonly holds?: boolean
  /**
   * What is drawn beside the node's link, outside it: a control of its own,
   * which a link cannot hold. A click on it is its own, so it neither takes
   * the focus nor runs the node's Enter; what a view draws there that is no
   * control can be drawn in `BesideLink`, so it is the node's again. What is
   * beside the link lets the pointer through, to the link stretched under it,
   * so a control takes the pointer for itself with `pointer-events-auto`.
   */
  readonly beside?: React.ReactNode
  readonly className?: string | undefined
  /** A ref the drag library also needs on this element. */
  readonly nodeRef?: ((element: Element | null) => void) | undefined
  readonly children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const { focusKey, marks, scopeOf, register, linkOf, Link } = useSurfaceContext()
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
  const address = holds ? null : linkOf(path)
  // A node with a control beside its link is the element that holds both.
  const holding = address !== null && beside !== undefined
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
      'relative scroll-my-12 rounded-md data-focused:ring-2 data-focused:ring-primary',
      // A link is inline by itself, and a node is a block unless it says otherwise.
      address !== null && !holding && 'block',
      className,
    ),
    ...rest,
  }
  const mark = marked ? <span aria-label="marked" className="absolute top-2.5 right-2 size-1.5 rounded-full bg-primary" /> : null
  if (address === null) {
    return (
      <Tag {...attributes}>
        {children}
        {beside}
        {mark}
      </Tag>
    )
  }
  if (holding) {
    return (
      <LinkHolder as={Tag} address={address} node beside={<>{beside}{mark}</>} {...attributes}>
        {children}
      </LinkHolder>
    )
  }
  return (
    <Link address={address} data-node-link="" {...attributes}>
      <InsideLinkContext value>{children}</InsideLinkContext>
      {mark}
    </Link>
  )
}
