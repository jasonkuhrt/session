import '@fontsource-variable/geist'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { ItemPage } from './item-page'
import { isBoard, itemId } from './lib/base'
import { WorktreeIndex } from './worktree-index'

const root = document.querySelector('#root')

if (!root) throw new Error('Missing #root')

// The daemon serves one bundle at three locations: one item under
// `/w/<key>/item/<ID>`, the board under `/w/<key>/`, and the index of tracked
// worktrees everywhere else.
createRoot(root).render(
  <StrictMode>
    {isBoard ? (itemId === null ? <App /> : <ItemPage id={itemId} />) : <WorktreeIndex />}
  </StrictMode>,
)
