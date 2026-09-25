import { Archive, FolderTree, Gavel, type LucideIcon, ScrollText } from 'lucide-react'

import { rulesFile } from '../../contract'
import type { Listing } from '../lib/base'
import { filePageHref, listingHref } from '../lib/base'
import { listingMeta } from '../lib/listings'
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
 * place that says what needs you.
 */
export function PageLinks({ rules }: { rules: boolean }) {
  return (
    <nav aria-label="The session’s pages" className="flex items-center gap-1">
      {rules ? <PageLink icon={Gavel} label="Rules" meaning={rulesMeaning} href={filePageHref(rulesFile)} /> : null}
      {listings.map((listing) => (
        <PageLink
          key={listing}
          icon={icons[listing]}
          label={listingMeta[listing].label}
          meaning={listingMeta[listing].meaning}
          href={listingHref(listing)}
        />
      ))}
    </nav>
  )
}

function PageLink({ icon: Icon, label, meaning, href }: {
  icon: LucideIcon
  label: string
  meaning: string
  href: string
}) {
  return (
    <Tip
      meaning={meaning}
      render={<Button variant="ghost" size="icon-sm" nativeButton={false} render={<a aria-label={label} href={href} />} />}
    >
      <Icon />
    </Tip>
  )
}
