import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'

import { foldKey, unfoldKey } from './lib/base'
import { routeTree } from './routeTree.gen'

/**
 * The board's router, made once for each document. Every page is a file
 * route under `routes/`, matched from the address, and moving between pages
 * stays in the document: a link or a key that opens a page navigates the
 * router, which is safe because the board is one script, so no page's code is
 * fetched after the document loaded. A page leaving unmounts, which closes its
 * streams and its dialogs and keeps its reads; the page arriving mounts, draws
 * the last answer the document has of each read it makes, reads each again and
 * lands that over it, and opens its own stream. Where a page is scrolled
 * follows its focus, which the address carries, so Back comes back to the
 * focus it left, brought into view, rather than to a scroll offset kept aside.
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
        // Every answer is kept for as long as the document lives, so a page
        // that mounts again draws the last answer of each read it makes at
        // once, and a skeleton is drawn only while the document holds no
        // answer for the key.
        gcTime: Number.POSITIVE_INFINITY,
        // A page reads when it mounts, even when it drew an answer the
        // document already had a moment ago, since its stream only hears of
        // changes from the moment it opens, and what that read brings lands
        // over what the page drew. What the daemon says about itself is the
        // one read a page does not make again as it mounts (`reads.daemon`).
        refetchOnMount: 'always',
      },
    },
  })
  return createRouter({
    routeTree,
    context: { queryClient },
    trailingSlash: 'preserve',
    // A page is one component per address: a move to another board, epic,
    // project, item or file of the same page mounts it afresh, with its own
    // state, reads and stream, as a document load did.
    defaultRemountDeps: ({ params }) => params,
    // A worktree's key and a project's may hold a slash, and a route's parameter is one segment.
    rewrite: {
      input: ({ url }) => {
        url.pathname = foldKey(url.pathname)
        return url
      },
      output: ({ url }) => {
        url.pathname = unfoldKey(url.pathname)
        return url
      },
    },
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}
