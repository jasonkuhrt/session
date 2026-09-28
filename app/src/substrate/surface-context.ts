import * as React from 'react'

import type { Drawn } from './motion'
import { pathOfKey } from './path'
import type { Address, LinkProps, Path, SurfaceApi } from './seam'

/** What a node reads of the surface it is drawn in: the focus, the marks, its level's scope, where it registers, and the link it is drawn as. */
type SurfaceContextValue = {
  readonly focusKey: string
  readonly marks: ReadonlySet<string>
  readonly scopeOf: (id: string) => string
  readonly register: (key: string, drawn: Drawn | null) => void
  /** Where a node's link goes, the page a click on it opens; null for a node a click keeps on the page. */
  readonly linkOf: (path: Path) => Address | null
  /** The app's link, which a node drawn as one is. */
  readonly Link: React.ComponentType<LinkProps>
}

export const SurfaceContext = React.createContext<SurfaceContextValue | null>(null)

export const useSurfaceContext = () => {
  const context = React.use(SurfaceContext)
  if (context === null) throw new Error('A node is drawn inside a surface.')
  return context
}

/** Where the focus is, as the surface draws it this render: what a view draws from it reads it here. */
export const useFocus = (): Path => pathOfKey(useSurfaceContext().focusKey)

/**
 * Where a node's link goes, for a view that draws another link to the same
 * place beside the node, so the two go to one address.
 */
export const useLinkOf = () => useSurfaceContext().linkOf

/** What a view drawn inside a surface can ask of it, as a command can: a name, a line in the detail line, a move of the focus. */
export const ApiContext = React.createContext<SurfaceApi | null>(null)

export const useSurface = (): SurfaceApi => {
  const api = React.use(ApiContext)
  if (api === null) throw new Error('A view asks its surface from inside it.')
  return api
}

/** Whether what is drawn is inside a node drawn as a link, where nothing may be a control of its own. */
export const InsideLinkContext = React.createContext(false)

/**
 * Whether what is drawn is inside a node drawn as a link: a link may hold no
 * control, so a word there draws its tip without a button.
 */
export const useInsideLink = () => React.use(InsideLinkContext)
