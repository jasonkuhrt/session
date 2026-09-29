import * as React from 'react'

import type { Address } from './seam'
import { InsideLinkContext, useSurfaceContext } from './surface-context'

/**
 * The link of what a view draws something beside: a node's link, a step's, a
 * name's. A link holds no other, so a control of its own that belongs there,
 * a link to somewhere else, is drawn beside the link and not in it; and the
 * rest of what is drawn beside it, the words that are no controls, can be
 * drawn in `BesideLink`, which is that link again, so a click on them is the
 * link's and a click with a modifier is the browser's, as it is on the link.
 */
type Beside = {
  /** Where the link goes. */
  readonly address: Address
  /** What a plain click on it does, for a link whose click is the view's own; the browser follows it otherwise. */
  readonly onClick?: ((event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined
  /** Whether it is a node's own link, whose click the view hears and answers. */
  readonly node?: boolean
}

/** The link that what is drawn beside a link can be drawn in again. */
export const BesideLinkContext = React.createContext<Beside | null>(null)

/**
 * What is drawn in the link of what it is beside, again, without a box of its
 * own, so what it holds flows where it is drawn. Drawn beside nothing that
 * has a link, it holds its children as they are.
 */
export function BesideLink({ children }: { readonly children: React.ReactNode }) {
  const beside = React.use(BesideLinkContext)
  const { Link } = useSurfaceContext()
  if (beside === null) return children
  return (
    <Link
      address={beside.address}
      data-node-link={beside.node === true ? '' : undefined}
      // Never the browser's focus, which stays with the page.
      tabIndex={-1}
      className="contents"
      onMouseDown={(event) => event.preventDefault()}
      onClick={beside.onClick}
    >
      <InsideLinkContext value>{children}</InsideLinkContext>
    </Link>
  )
}
