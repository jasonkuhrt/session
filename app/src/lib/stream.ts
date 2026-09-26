import * as React from 'react'

import type { StreamEvent } from '../../contract'
import { eventsUrl } from './api'

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
 * came back runs every read once, since changes land while it is down. While
 * held, an event of the hold runs nothing and is remembered, and the hold's
 * release runs once when it ends, as the board and the index hold their reads
 * for a drag. The page never polls.
 */
export function useStream({ board, on, hold }: {
  /** The board's prefix, or nothing for the index. */
  readonly board: string
  /** The read each event runs; events that share a read run it once after a drop. */
  readonly on: Partial<Record<StreamEvent, Read>>
  readonly hold?: Hold | undefined
}) {
  const reads = React.useRef(on)
  const holding = React.useRef(hold)
  const missed = React.useRef(false)
  React.useEffect(() => {
    reads.current = on
    holding.current = hold
  })

  const names = Object.keys(on).join(',')
  React.useEffect(() => {
    const events = names.split(',').filter((name): name is StreamEvent => name !== '')
    const source = new EventSource(eventsUrl({ board, events }))
    const run = (event: StreamEvent) => {
      const current = holding.current
      if (current?.held === true && current.events.includes(event)) {
        missed.current = true
        return
      }
      void reads.current[event]?.()
    }
    let dropped = false
    for (const event of events) source.addEventListener(event, () => run(event))
    source.addEventListener('error', () => {
      dropped = true
    })
    source.addEventListener('open', () => {
      if (!dropped) return
      dropped = false
      runEachRead({ events, reads: reads.current, run })
    })
    return () => source.close()
  }, [board, names])

  const held = hold?.held === true
  React.useEffect(() => {
    if (held || !missed.current) return
    missed.current = false
    void holding.current?.release()
  }, [held])
}

/** Every read the events name, each once however many events share it, as the stream would have run them. */
function runEachRead({ events, reads, run }: {
  readonly events: ReadonlyArray<StreamEvent>
  readonly reads: Partial<Record<StreamEvent, Read>>
  readonly run: (event: StreamEvent) => void
}) {
  const ran = new Set<Read>()
  for (const event of events) {
    const read = reads[event]
    if (read === undefined || ran.has(read)) continue
    ran.add(read)
    run(event)
  }
}
