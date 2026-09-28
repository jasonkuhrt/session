import * as React from 'react'

import { cn } from '../lib/utils'
import { leafOf, pathKey } from './path'
import type { Path } from './seam'
import { useSurfaceContext } from './surface-context'

/**
 * A node the view draws: something the focus can be on. It says where it is,
 * so the moves read it at its level in the drawn geometry, and it draws the
 * focus as a soft fill with a rule at its left edge, and a mark as a dot. The
 * surface hears its clicks. When it becomes the focus it brings itself into
 * view, so a move scrolls to what it reached and a read that moves nodes
 * around never scrolls the page.
 */
export function Node({ path, as: Tag = 'div', className, nodeRef, children, ...rest }: {
  readonly path: Path
  readonly as?: 'div' | 'li' | 'section' | 'h2' | 'h3'
  readonly className?: string | undefined
  /** A ref the drag library also needs on this element. */
  readonly nodeRef?: ((element: Element | null) => void) | undefined
  readonly children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const { focusKey, marks, scopeOf, register } = useSurfaceContext()
  const key = pathKey(path)
  const focused = key === focusKey
  const marked = marks.has(leafOf(path))
  const element = React.useRef<Element | null>(null)
  const ref = React.useCallback((node: Element | null) => {
    element.current = node
    nodeRef?.(node)
  }, [nodeRef])
  const scope = scopeOf(leafOf(path))
  React.useLayoutEffect(() => {
    const node = element.current
    if (node !== null) register(key, { scope, element: node })
    return () => register(key, null)
  }, [key, register, scope])
  React.useEffect(() => {
    if (focused) element.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [focused])
  return (
    <Tag
      ref={ref}
      data-node={key}
      // Never the browser's focus, which stays with the page, so every key
      // reaches the registry: the focus is the substrate's, drawn on the node.
      tabIndex={-1}
      data-focused={focused ? '' : undefined}
      data-marked={marked ? '' : undefined}
      className={cn(
        'relative scroll-my-12 rounded-md data-focused:bg-primary/10 data-focused:shadow-[inset_2px_0_0_var(--color-primary)]',
        className,
      )}
      {...rest}
    >
      {children}
      {marked ? <span aria-label="marked" className="absolute top-2.5 right-2 size-1.5 rounded-full bg-primary" /> : null}
    </Tag>
  )
}
