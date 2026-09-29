import * as React from 'react'

import { cn } from '../lib/utils'
import type { Address, LinkProps } from './seam'
import { InsideLinkContext, useSurfaceContext } from './surface-context'

/**
 * A link stretched across the element that holds it: it draws no box, so what
 * it holds flows in the holder's layout, and its hit area is the whole of the
 * holder, beneath what is drawn there, so the holder's empty parts are the
 * link's and what is drawn on it, a word with its tip or a control of its
 * own, is met first. It works only in an element that is positioned and holds
 * its own stacking context, which `LinkHolder` makes of its own.
 */
const stretched = "contents after:absolute after:inset-0 after:-z-10 after:content-['']"

/** The link a holder holds, which what is drawn beside it can be drawn in again. */
type Held = {
  /** Where the link goes. */
  readonly address: Address
  /** What a plain click on it does, for a link whose click is the surface's own; the browser follows it otherwise. */
  readonly onClick?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined
  /** Whether it is a node's own link, whose click the view hears and answers. */
  readonly node: boolean
}

const HeldLinkContext = React.createContext<Held | null>(null)

/** What a link a holder draws is drawn with: the link's own attributes and what it holds. */
export type HeldLinkProps = Omit<LinkProps, 'address'>

/** What every link of a holder is given: never the browser's focus, which stays with the page, and the surface's own click. */
const linkProps = ({ node, onClick }: Pick<Held, 'node' | 'onClick'>): HeldLinkProps => ({
  tabIndex: -1,
  onMouseDown: (event) => event.preventDefault(),
  onClick,
  ...(node ? { 'data-node-link': '' } : {}),
})

/**
 * An element that holds a link and what stands beside it: what a click opens
 * another page from is drawn as a link, and a link holds no other, so a
 * control of its own that belongs there, a link to somewhere else, stands
 * beside it. The holder is positioned and holds its own stacking context, and
 * its link is stretched across it, so the whole holder is the link but for
 * what stands on it, which is met first. What stands beside the link may be
 * a control, which is its own, or marks that are none, which are drawn in
 * `BesideLink`, the same link again, so they are the link's too. What stands
 * beside the link lets the pointer through, around its links and controls,
 * to the link stretched under it, so no gap between them and no strip around
 * them is dead; a control takes the pointer back for itself with
 * `pointer-events-auto`, as `BesideLink` does. A holder with no address holds
 * what it is given as it is.
 */
export function LinkHolder({ as: Tag = 'div', address, node = false, onLinkClick, renderLink, beside, className, ref, children, ...rest }: {
  readonly as?: 'div' | 'li' | 'section' | 'h2' | 'h3' | 'span'
  /** Where its link goes. */
  readonly address: Address | null
  /** Whether the link is a node's own, whose click the view hears and answers. */
  readonly node?: boolean
  /** What a plain click on the link does, when it is the surface's own; the browser follows the link otherwise. */
  readonly onLinkClick?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined
  /** Draws the link, given what the holder needs it drawn with, where the surface's link is not what it is drawn as. */
  readonly renderLink?: ((props: HeldLinkProps) => React.ReactNode) | undefined
  /** What stands beside the link. */
  readonly beside?: React.ReactNode
  readonly className?: string | undefined
  /** A ref for the element, which a drag library or a registry may need. */
  readonly ref?: ((element: Element | null) => (() => void) | void) | undefined
  /** What the link holds. */
  readonly children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const { Link } = useSurfaceContext()
  const props: HeldLinkProps = {
    ...linkProps({ node, onClick: onLinkClick }),
    className: stretched,
    children: <InsideLinkContext value>{children}</InsideLinkContext>,
  }
  const held = renderLink === undefined ? (address === null ? children : <Link address={address} {...props} />) : renderLink(props)
  const context = React.useMemo(() => (address === null ? null : { address, onClick: onLinkClick, node }), [address, onLinkClick, node])
  return (
    <Tag {...rest} ref={ref} className={cn('relative isolate', className)}>
      <HeldLinkContext value={context}>
        {held}
        {beside === undefined || beside === null ? null : <span className="pointer-events-none contents">{beside}</span>}
      </HeldLinkContext>
    </Tag>
  )
}

/**
 * What stands beside a holder's link, drawn in that link again, as a box of
 * its own that the caller shapes and that holds the space it leaves around
 * what it holds, so a click on any of it is the link's and a click with a
 * modifier is the browser's, as on the link. Drawn beside nothing that holds
 * a link, it is the box alone.
 */
export function BesideLink({ className, children }: { readonly className?: string | undefined; readonly children: React.ReactNode }) {
  const held = React.use(HeldLinkContext)
  const { Link } = useSurfaceContext()
  const box = cn('pointer-events-auto', className)
  if (held === null) return <span className={box}>{children}</span>
  return (
    <Link address={held.address} {...linkProps(held)} className={box}>
      <InsideLinkContext value>{children}</InsideLinkContext>
    </Link>
  )
}
