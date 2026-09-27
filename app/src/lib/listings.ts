import type { Listing } from './base'

/**
 * What each of a board's listings is called and what it holds. The sentence
 * is the only explanation any surface gives, so it names the page first: the
 * header hangs it off the listing's icon, and a page hangs it off the step of
 * its trail that names the listing.
 */
export const listingMeta: Record<Listing, { label: string; meaning: string }> = {
  ledger: {
    label: 'Ledger',
    meaning:
      'The ledger: what another agent, or you, must know to act correctly in this session and would not learn from the items, as dated entries written once and never edited.',
  },
  context: {
    label: 'Context',
    meaning: 'Context: the files agents keep under context/ as supporting material for the items, as a tree.',
  },
  archive: {
    label: 'Archive',
    meaning: 'The archive: every item filed away, finished or set aside, newest first.',
  },
}

/** The ledger an epic's board and a project's carry: every worktree's in view, merged. */
export const unionLedgerMeaning =
  'The ledger of every worktree in view: their entries merged, newest first, each named for the worktree it was written in.'
