import type { LinkOptions } from '@tanstack/react-router'
import * as React from 'react'

import type { Drawn } from './motion'
import { pathOfKey } from './path'
import type { Path, SurfaceApi } from './seam'

/** What a node reads of the surface it is drawn in: the focus, the marks, its level's scope, where it registers, and the link it is drawn as. */
type SurfaceContextValue = {
  readonly focusKey: string
  readonly marks: ReadonlySet<string>
  readonly scopeOf: (id: string) => string
  readonly register: (key: string, drawn: Drawn | null) => void
  /** The link a node is drawn as, to the page a click on it opens; null for a node a click keeps on the page. */
  readonly linkOf: (path: Path) => LinkOptions | null
}

export const SurfaceContext = React.createContext<SurfaceContextValue | null>(null)

export const useSurfaceContext = () => {
  const context = React.use(SurfaceContext)
  if (context === null) throw new Error('A node is drawn inside a surface.')
  return context
}

/** Where the focus is, as the surface draws it this render: what a view draws from it reads it here. */
export const useFocus = (): Path => pathOfKey(useSurfaceContext().focusKey)

/** What a view drawn inside a surface can ask of it, as a command can: a name, a line in the detail line, a move of the focus. */
export const ApiContext = React.createContext<SurfaceApi | null>(null)

export const useSurface = (): SurfaceApi => {
  const api = React.use(ApiContext)
  if (api === null) throw new Error('A view asks its surface from inside it.')
  return api
}

