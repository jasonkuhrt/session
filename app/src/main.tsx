import '@fontsource-variable/geist'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { ArchivePage } from './archive-page'
import { ContextPage } from './context-page'
import { FilePage } from './file-page'
import { ItemPage } from './item-page'
import { LedgerPage } from './ledger-page'
import type { BoardPage } from './lib/base'
import { page } from './lib/base'
import { WorktreeIndex } from './worktree-index'

const root = document.querySelector('#root')

if (!root) throw new Error('Missing #root')

/**
 * The daemon serves one bundle at every location: the index of tracked
 * worktrees at the root, each board under `/w/<key>/`, and the board's pages
 * under that: one item, the ledger, the context tree, the archive, and one
 * file of the session.
 */
function Page({ open }: { open: BoardPage | null }) {
  if (open === null) return <WorktreeIndex />
  if (open.kind === 'item') return <ItemPage id={open.id} />
  if (open.kind === 'file') return <FilePage path={open.path} />
  if (open.kind === 'ledger') return <LedgerPage />
  if (open.kind === 'context') return <ContextPage />
  if (open.kind === 'archive') return <ArchivePage />
  return <App />
}

createRoot(root).render(
  <StrictMode>
    <Page open={page} />
  </StrictMode>,
)
