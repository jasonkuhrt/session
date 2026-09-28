import { useQuery } from '@tanstack/react-query'

import type { DaemonCapabilities } from '../../contract'
import { reads } from './reads'

const noCapabilities: DaemonCapabilities = { terminal: false, zed: false }

/**
 * What this page can offer a worktree: a terminal, when the daemon can run
 * cmux, and Zed, when it can run zed. The daemon runs both from its own PATH
 * and says whether each is there; it is read when the page loads, and again
 * when the page's stream comes back, so a restarted daemon's answer replaces
 * it. Until that answer arrives, and if it never does, neither command can
 * run, and the page's own read is what says the daemon cannot be reached.
 */
export function useCapabilities(): DaemonCapabilities {
  // A failed read offers nothing, and has nothing to say twice.
  return useQuery(reads.daemon()).data ?? noCapabilities
}
