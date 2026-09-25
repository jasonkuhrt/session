import { Archive, FolderTree, ScrollText } from 'lucide-react'

import type { Listing } from '../lib/base'
import { listingHref } from '../lib/base'
import { listingMeta } from '../lib/listings'
import { Tip } from './tip'
import { Button } from './ui/button'

/** The mark of each listing, from the one icon set the board draws with. */
const icons = { ledger: ScrollText, context: FolderTree, archive: Archive } as const

const listings: readonly Listing[] = ['ledger', 'context', 'archive']

/**
 * The session's three listings beside its lanes, as one icon link apiece:
 * the ledger, `context/` and the archive. Each names its page on hover and
 * carries nothing else, no count and no age, because the lanes are the one
 * place that says what needs you.
 */
export function PageLinks() {
  return (
    <nav aria-label="The session’s pages" className="flex items-center gap-1">
      {listings.map((listing) => {
        const Icon = icons[listing]
        return (
          <Tip
            key={listing}
            meaning={listingMeta[listing].meaning}
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                nativeButton={false}
                render={<a aria-label={listingMeta[listing].label} href={listingHref(listing)} />}
              />
            }
          >
            <Icon />
          </Tip>
        )
      })}
    </nav>
  )
}
