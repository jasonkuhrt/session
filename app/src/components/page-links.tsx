import { Link } from '@tanstack/react-router'
import { Archive, FolderTree, Gavel, type LucideIcon, ScrollText } from 'lucide-react'

import { rulesFile } from '../../contract'
import type { Destination, Listing } from '../lib/base'
import { toEpicLedger, toFile, toListing, toProjectLedger } from '../lib/base'
import type { Filter } from '../lib/filter'
import { listingMeta, unionLedgerMeaning } from '../lib/listings'
import { Tip } from './tip'
import { Button } from './ui/button'

/** The mark of each listing, from the one icon set the board draws with. */
const icons = { ledger: ScrollText, context: FolderTree, archive: Archive } as const

const listings: readonly Listing[] = ['ledger', 'context', 'archive']

const rulesMeaning =
  'The rules: RULES.md, the standing procedure you set for this session, which agents read first and follow over their own habits.'

/**
 * What the session keeps beside its lanes, as one icon link apiece, in the
 * order an agent reads it: the rules, when the session has `RULES.md`, then
 * the ledger, `context/` and the archive. Each names its page on hover and
 * carries nothing else, no count and no age, because the lanes are the one
 * place that says what needs you. An epic's board and a project's carry the
 * ledger of every worktree in view alone: the rest are each one session's,
 * on its own board.
 */
export function PageLinks({ filter, rules }: { filter: Filter; rules: boolean }) {
  if (filter.kind !== 'worktree') {
    const ledger = filter.kind === 'epic' ? toEpicLedger(filter.name) : toProjectLedger(filter.path)
    return (
      <nav aria-label="The pages of every worktree in view" className="flex items-center gap-1">
        <PageLink icon={icons.ledger} label={listingMeta.ledger.label} meaning={unionLedgerMeaning} to={ledger} />
      </nav>
    )
  }
  const { name } = filter
  return (
    <nav aria-label="The session’s pages" className="flex items-center gap-1">
      {rules ? <PageLink icon={Gavel} label="Rules" meaning={rulesMeaning} to={toFile({ name, path: rulesFile })} /> : null}
      {listings.map((listing) => (
        <PageLink
          key={listing}
          icon={icons[listing]}
          label={listingMeta[listing].label}
          meaning={listingMeta[listing].meaning}
          to={toListing({ name, listing })}
        />
      ))}
    </nav>
  )
}

function PageLink({ icon: Icon, label, meaning, to }: {
  icon: LucideIcon
  label: string
  meaning: string
  to: Destination
}) {
  return (
    <Tip
      meaning={meaning}
      render={<Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link {...to} aria-label={label} />} />}
    >
      <Icon />
    </Tip>
  )
}
