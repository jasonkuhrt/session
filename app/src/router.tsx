import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'

import { foldBoardKey, unfoldBoardKey } from './lib/base'
import { routeTree } from './routeTree.gen'

/**
 * The board's router, made once for each document. Every page is a file
 * route under `routes/`, matched from the address the document was loaded
 * at, and every link between pages is an anchor, so moving to another page
 * loads a document, as the board always has.
 */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // A page's stream is the one thing that asks for a read again: an
        // answer never goes stale on a clock, and nothing is read again on
        // focus or reconnect, even after a read failed.
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // A failed read says so at once, as it always has.
        retry: false,
        // The daemon is on this machine, so a browser that reports itself
        // offline must not pause a read of it.
        networkMode: 'always',
        // An answer no page shows is dropped, so a page that mounts again
        // reads again instead of drawing an old answer.
        gcTime: 0,
      },
    },
  })
  return createRouter({
    routeTree,
    trailingSlash: 'preserve',
    // A board's key may hold a slash, and a route's parameter is one segment.
    rewrite: {
      input: ({ url }) => {
        url.pathname = foldBoardKey(url.pathname)
        return url
      },
      output: ({ url }) => {
        url.pathname = unfoldBoardKey(url.pathname)
        return url
      },
    },
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}
