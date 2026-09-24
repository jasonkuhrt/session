import type { LedgerEntry } from '../contract'
import { BoardPageFrame, ListingEmpty, ListingNotices, PageLoading } from './components/board-page'
import { Markdown } from './components/markdown'
import { useTip } from './components/tip'
import { Card, CardContent } from './components/ui/card'
import { problemOf, readPlace, SessionApi, worktreeOf } from './lib/api'
import { useNow } from './lib/clock'
import { useFollowed } from './lib/follow'
import { absoluteTime, relativeTime } from './lib/format'
import { listingMeta } from './lib/listings'

/** The page reads where it stands and the ledger's entries together, so the two never disagree. */
const readLedger = (signal: AbortSignal) => Promise.all([readPlace(signal), SessionApi.ledger(signal)])

/** What each key of an entry says, beside its value. */
const keyMeaning = {
  by: 'Who wrote the entry: a Claude Code session, a Codex thread, or a person.',
  branch: 'The Git branch checked out when the entry was written.',
  commit: 'The commit checked out when the entry was written.',
  batch: 'The batch Execute was running when the entry was written.',
} as const

/**
 * An entry's keys beyond its date and title, as the entry has them: `by`
 * always, and each of the others only when the entry names one.
 */
const keysOf = (entry: LedgerEntry) =>
  (['by', 'branch', 'commit', 'batch'] as const).flatMap((key) => {
    const value = entry[key]
    return value === null ? [] : [{ key, value, meaning: keyMeaning[key] }]
  })

/**
 * The session's ledger, newest first. Every entry is a card, read where it
 * stands: nothing here is unread, and nothing asks to be dismissed. A file in
 * `ledger/` that breaks the ledger's rules is not an entry, and the line above
 * the cards names it.
 */
export function LedgerPage() {
  const now = useNow()
  const { value, error } = useFollowed(readLedger)
  const [place, ledger] = value ?? [null, null]
  return (
    <BoardPageFrame
      title={listingMeta.ledger.label}
      worktree={worktreeOf(place)}
      boardMeaning="The board of the session this ledger belongs to."
      crumbs={[{ label: listingMeta.ledger.label, meaning: listingMeta.ledger.meaning }]}
      problem={error ?? problemOf(place)}
    >
      {ledger === null ? (error === null ? <PageLoading /> : null) : (
        <>
          <ListingNotices notices={ledger.notices} />
          {ledger.entries.length === 0
            ? <ListingEmpty>No entries.</ListingEmpty>
            : (
              <ol className="space-y-4">
                {ledger.entries.map((entry) => (
                  <li key={entry.path}>
                    <EntryCard entry={entry} now={now} />
                  </li>
                ))}
              </ol>
            )}
        </>
      )}
    </BoardPageFrame>
  )
}

/** One entry: what it says, when it was written, its body, and the rest of what it records. */
function EntryCard({ entry, now }: { entry: LedgerEntry; now: number }) {
  const tip = useTip()
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-pretty text-lg leading-snug font-medium">{entry.title}</h2>
          <span className="shrink-0 text-xs text-muted-foreground" title={tip(`Written at ${absoluteTime(entry.date)}.`)}>
            {relativeTime(entry.date, now)}
          </span>
        </div>
        {entry.body === '' ? null : <Markdown>{entry.body}</Markdown>}
        <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          {keysOf(entry).map(({ key, value, meaning }) => (
            <span key={key} className="wrap-anywhere" title={tip(meaning)}>
              {key}: {value}
            </span>
          ))}
        </p>
      </CardContent>
    </Card>
  )
}
