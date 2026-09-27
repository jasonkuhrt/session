import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'

import { foldBoardKey, unfoldBoardKey } from './lib/base'
import { routeTree } from './routeTree.gen'

/**
 * The board's router, made once for each document. Every page is a file
 * route under `routes/`, matched from the address, and moving between pages
 * stays in the document: a link or a key that opens a page navigates the
 * router, which is safe because the board is one script, so no page's code is
 * fetched after the document loaded. A page leaving unmounts, which closes its
 * streams and its dialogs and drops its reads; the page arriving mounts, reads
 * and opens its own.
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
        // A page reads when it mounts, even when the page it replaced was
        // showing the same answer a moment ago, as the index and a board's
        // picker share the worktrees: the page's stream only hears of changes
        // from the moment it opens.
        refetchOnMount: 'always',
      },
    },
  })
  return createRouter({
    routeTree,
    trailingSlash: 'preserve',
    // A page is one component per address: a move to another board, item or
    // file of the same page mounts it afresh, with its own state, reads and
    // stream, as a document load did.
    defaultRemountDeps: ({ params }) => params,
    // Back and Forward come back where the page was scrolled, as they did when
    // every move loaded a document; a page whose content arrives after it
    // mounts scrolls there once its content is drawn (`ScrollRestored`).
    scrollRestoration: true,
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
