/// <reference types="vite/client" />
import '@fontsource-variable/geist'
import '../styles.css'

import type { QueryClient } from '@tanstack/react-query'
import { ClientOnly, createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type * as React from 'react'

import { NoPage } from '../components/no-page'

/** The board's mark on its tab. */
const icon =
  'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%2309090b%22/><circle cx=%2216%22 cy=%2216%22 r=%225%22 fill=%22%23fafafa%22/></svg>'

/**
 * What every route is handed: the document's query client, so a route can read
 * what decides whether its address is a page before the page mounts.
 */
type RouterContext = { readonly queryClient: QueryClient }

/**
 * Every page's document. The build prerenders it alone, with no page in it,
 * into the shell the daemon serves at every page's address; the page the
 * address names is drawn once the document has hydrated, never during it,
 * so the document the browser receives and the one it hydrates are the same.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'UTF-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { name: 'theme-color', content: '#0a0a0a' },
      { name: 'description', content: 'A file-backed session workflow.' },
      { title: 'Session' },
    ],
    links: [{ rel: 'icon', href: icon }],
  }),
  shellComponent: Document,
  component: Page,
  notFoundComponent: NoPage,
})

function Document({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function Page() {
  return (
    <ClientOnly>
      <Outlet />
    </ClientOnly>
  )
}
