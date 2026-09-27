import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { Effect, Option, Schema } from 'effect'
import * as React from 'react'

import { type StreamEvent, StreamEventSchema } from '../../contract'
import { DaemonApi, eventsUrl } from './api'
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
 * What a page does with what its stream says: each event the stream carries,
 * and the stream opening again after a drop, when changes may have landed
 * unheard.
 */
type Listener = {
  readonly event: (event: StreamEvent) => void
  readonly reopened: () => void
}

/**
 * What the tab holding a stream tells the tabs following it: the name of each
 * event the stream carried, or `reopened` when the stream opened again. A
 * message this build does not read, which only a tab loaded from another
 * build could send, is ignored.
 */
const RelaySchema = Schema.Literals([...StreamEventSchema.literals, 'reopened'])
const decodeRelay = Schema.decodeUnknownOption(RelaySchema)
const encodeRelay = Schema.encodeSync(RelaySchema)

/**
 * One page's stream, a board's under its prefix or the index's at the root.
 * It carries only the events the page names, and each runs its read. The
 * daemon's events carry no payload, only the word that an answer changed, so
 * every event is one read of the query it names. The tabs following one
 * address share one stream, which one of them holds, and each still reads
 * what an event names. A stream that dropped and came back runs every read
 * once, since changes land while it is down, unless the daemon it came back
 * to was rebuilt, when the page reloads instead. While held, an event of the
 * hold runs nothing and is remembered, and the hold's release runs once when
 * it ends, as the board and the index hold their reads for a drag. The page
 * never polls.
 */
export function useStream({ board, on, hold }: {
  /** The board's prefix, or nothing for the index. */
  readonly board: string
  /** The read each event runs; events that share a read run it once after a drop. */
  readonly on: Partial<Record<StreamEvent, Read>>
  readonly hold?: Hold | undefined
}) {
  const client = useQueryClient()
  // The build the page was loaded from, which a stream that comes back checks.
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
    const reopened = async () => {
      if (!(await reloadedWhenRebuilt(client))) runEachRead({ events, on: latest.current, run })
    }
    return followShared({ url: eventsUrl({ board, events }), events, listener: { event: run, reopened } })
  }, [board, client, names])

  const held = hold?.held === true
  React.useEffect(() => {
    if (held || !missed.current) return
    missed.current = false
    void holding.current?.release()
  }, [held])
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
 * Reloads the page, once, when the daemon its stream came back to was started
 * from other sources than the one the page was loaded from, as after `bun run
 * build` and `session daemon restart`, so the page runs the build now on disk
 * instead of reading on with its own. The reload waits for nothing: a drag in
 * progress is dropped with the page, and nothing of it is written, since the
 * board and the index write only when the sortable library ends a drag, which
 * it does only on a pointer or key event. A restart from the same sources
 * answers the stamp the page has, as does a daemon that cannot be asked, and
 * neither reloads it. Answers whether the page reloads.
 */
async function reloadedWhenRebuilt(client: QueryClient) {
  const loaded = client.getQueryData(reads.daemon().queryKey)?.sourceStamp
  if (loaded === undefined) return false
  const now = await DaemonApi.describe().then(({ sourceStamp }) => sourceStamp, () => loaded)
  if (now === loaded) return false
  window.location.reload()
  return true
}

/**
 * Follows the stream at `url` with every other tab of this origin that follows
 * it. The browser gives a host six connections, and a stream holds one for as
 * long as its page is open, so one tab holds the stream and passes on what it
 * hears over a `BroadcastChannel` named for the address. The tab that holds it
 * is the one holding the Web Lock of that name: the first to ask opens the
 * stream, the others wait in line and follow, and when that tab closes the
 * browser releases its lock and the next in line opens the stream itself. A
 * tab that cannot take part, where the browser has no Web Locks or refuses the
 * lock, holds a stream of its own, as every tab did before. Answers what stops
 * following.
 */
function followShared({ url, events, listener }: {
  readonly url: string
  readonly events: ReadonlyArray<StreamEvent>
  readonly listener: Listener
}) {
  if (!('locks' in navigator)) return openStream({ url, events, listener, tookOver: false })
  const name = `session stream ${url}`
  const channel = channelOf({ name, listener })
  const stopped = new AbortController()
  let close: (() => void) | undefined
  // The lock is held until what its callback answers settles, which is when this page stops following.
  const lead = (tookOver: boolean) => {
    if (stopped.signal.aborted) return null
    close = openStream({ url, events, listener: channel.relaying, tookOver })
    return Effect.runPromiseExit(Effect.never, { signal: stopped.signal })
  }
  const alone = () => {
    if (stopped.signal.aborted) return
    channel.close()
    close = openStream({ url, events, listener, tookOver: false })
  }
  // Asked first without waiting, so a tab that waited knows it took the stream over from another.
  navigator.locks
    .request(name, { ifAvailable: true }, (lock) =>
      lock === null ? navigator.locks.request(name, { signal: stopped.signal }, () => lead(true)) : lead(false))
    .catch(alone)
  return () => {
    stopped.abort()
    close?.()
    channel.close()
  }
}

/**
 * A shared stream's channel, named for its address. What the tab holding the
 * stream says on it reaches the listener of every other tab following the
 * stream, and `relaying` is the listener that says it, for the tab that holds
 * it, which hears what it says itself.
 */
function channelOf({ name, listener }: { readonly name: string; readonly listener: Listener }) {
  const channel = new BroadcastChannel(name)
  channel.addEventListener('message', ({ data }: MessageEvent) => {
    const relay = decodeRelay(data)
    if (Option.isNone(relay)) return
    if (relay.value === 'reopened') listener.reopened()
    else listener.event(relay.value)
  })
  const tell = (relay: typeof RelaySchema.Type) =>
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- A BroadcastChannel reaches only its own origin and takes no target origin; the rule is for Window.postMessage.
    channel.postMessage(encodeRelay(relay))
  const relaying: Listener = {
    event: (event) => {
      tell(event)
      listener.event(event)
    },
    reopened: () => {
      tell('reopened')
      listener.reopened()
    },
  }
  return { relaying, close: () => channel.close() }
}

/**
 * The stream itself, one `EventSource`: each event it carries, and `reopened`
 * when it opens again after dropping, since changes land while it is down.
 * One taken over from a tab that closed opens as reopened too, since what
 * changed after that tab's stream closed and before this one opened was heard
 * by no tab. Answers what closes it.
 */
function openStream({ url, events, listener, tookOver }: {
  readonly url: string
  readonly events: ReadonlyArray<StreamEvent>
  readonly listener: Listener
  readonly tookOver: boolean
}) {
  const source = new EventSource(url)
  let dropped = tookOver
  for (const event of events) source.addEventListener(event, () => listener.event(event))
  source.addEventListener('error', () => {
    dropped = true
  })
  source.addEventListener('open', () => {
    if (!dropped) return
    dropped = false
    listener.reopened()
  })
  return () => source.close()
}
