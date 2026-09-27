import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import type { StreamEvent } from '../../contract'
import { eventsUrl } from './api'
import { reads } from './reads'

/** A read a page makes when its stream says an answer changed. */
type Read = () => Promise<unknown>

/**
 * What a drag or a write holds back while it lasts: the events it holds, and
 * the one catching-up read made when it ends, if any of them arrived.
 */
type Hold = {
  readonly held: boolean
  readonly events: ReadonlyArray<StreamEvent>
  readonly release: Read
}

/**
 * One page's stream, a board's under its prefix or the index's at the root.
 * It carries only the events the page names, and each runs its read. The
 * daemon's events carry no payload, only the word that an answer changed, so
 * every event is one read of the query it names. A stream that dropped and
 * came back runs every read once, since changes land while it is down, unless
 * the daemon it came back to was rebuilt, when the page reloads instead. A
 * stream's first opening checks the daemon too when the page already knows
 * the build it was loaded from, since the page may have been reached while
 * the stream before it was down. While held, an event of the hold runs nothing
 * and is remembered, and the hold's release runs once when it ends, as the
 * board and the index hold their reads for a drag. The page never polls.
 */
export function useStream({ board, on, hold }: {
  /** The board's prefix, or nothing for the index. */
  readonly board: string
  /** The read each event runs; events that share a read run it once after a drop. */
  readonly on: Partial<Record<StreamEvent, Read>>
  readonly hold?: Hold | undefined
}) {
  const client = useQueryClient()
  // The build the page was loaded from, which its streams check the daemon against.
  useQuery(reads.daemon())
  const latest = React.useRef(on)
  const holding = React.useRef(hold)
  const missed = React.useRef(false)
  React.useEffect(() => {
    latest.current = on
    holding.current = hold
  })

  const names = Object.keys(on).join(',')
  React.useEffect(() => {
    const events = names.split(',').filter((name): name is StreamEvent => name !== '')
    const run = (event: StreamEvent) => {
      const current = holding.current
      if (current?.held === true && current.events.includes(event)) {
        missed.current = true
        return
      }
      void latest.current[event]?.()
    }
    const readEach = () => runEachRead({ events, on: latest.current, run })
    return openStream({ url: eventsUrl({ board, events }), events, client, run, readEach })
  }, [board, client, names])

  const held = hold?.held === true
  React.useEffect(() => {
    if (held || !missed.current) return
    missed.current = false
    void holding.current?.release()
  }, [held])
}

/**
 * The stream itself, one `EventSource`: each event it carries runs, and an
 * opening after a drop reads every answer once, or reloads the page when the
 * daemon was rebuilt. Its first opening checks the daemon too when the page
 * already holds the stamp of the build it was loaded from. Answers what closes
 * it.
 */
function openStream({ url, events, client, run, readEach }: {
  readonly url: string
  readonly events: ReadonlyArray<StreamEvent>
  readonly client: QueryClient
  readonly run: (event: StreamEvent) => void
  readonly readEach: () => void
}) {
  const source = new EventSource(url)
  let dropped = false
  let opened = false
  for (const event of events) source.addEventListener(event, () => run(event))
  source.addEventListener('error', () => {
    dropped = true
  })
  source.addEventListener('open', async () => {
    const cameBack = dropped
    const check = cameBack || (!opened && client.getQueryData(reads.daemon().queryKey) !== undefined)
    dropped = false
    opened = true
    if (!check || (await reloadedWhenRebuilt(client))) return
    if (cameBack) readEach()
  })
  return () => source.close()
}

/** Every read the events name, each once however many events share it, as the stream would have run them. */
function runEachRead({ events, on, run }: {
  readonly events: ReadonlyArray<StreamEvent>
  readonly on: Partial<Record<StreamEvent, Read>>
  readonly run: (event: StreamEvent) => void
}) {
  const ran = new Set<Read>()
  for (const event of events) {
    const read = on[event]
    if (read === undefined || ran.has(read)) continue
    ran.add(read)
    run(event)
  }
}

/**
 * Reloads the page, once, when the daemon its stream opened on was started
 * from other sources than the one the page was loaded from, as after `bun run
 * build` and `session daemon restart`, so the page runs the build now on disk
 * instead of reading on with its own. The daemon is asked through the page's
 * own query of it, so streams that come back together share one ask, and what
 * the terminal and Zed actions offer follows the daemon that answered. The
 * reload waits for nothing: a drag in progress is dropped with the page, and
 * nothing of it is written, since the board and the index write only when the
 * sortable library ends a drag, which it does only on a pointer or key event.
 * A restart from the same sources answers the stamp the page has, as does a
 * daemon that cannot be asked, and neither reloads it. Answers whether the
 * page reloads.
 */
async function reloadedWhenRebuilt(client: QueryClient) {
  const loaded = client.getQueryData(reads.daemon().queryKey)?.sourceStamp
  if (loaded === undefined) return false
  const now = await client.query({ ...reads.daemon(), staleTime: 0 }).then(({ sourceStamp }) => sourceStamp, () => loaded)
  if (now === loaded) return false
  window.location.reload()
  return true
}
