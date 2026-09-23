import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { AgentsSummary } from '../../contract.ts';
import { claudeSessions, registryDirectory } from './claude.ts';
import { codexThreads, lockDirectory } from './codex.ts';

/**
 * The agents overlay: what Claude Code and Codex say is happening in a
 * worktree, asked fresh every time and never remembered as state. Both sources
 * answer with rows and, when they cannot answer, with a notice — so a source
 * that is down reads as "Codex not available" and never as an empty list, which
 * would say the opposite of the truth.
 */

type Services = FileSystem.FileSystem | ChildProcessSpawner;

/** What a worktree shows before any listing has run for it. */
export const notListed = DateTime.now.pipe(
  Effect.map((moment) =>
    ({
      claude: [],
      codex: [],
      notices: ['The agent listing has not run for this worktree yet.'],
      fetchedAt: DateTime.formatIso(moment),
    }) satisfies AgentsSummary
  ),
);

/**
 * One pass for every tracked worktree at once: both sources list the whole
 * machine in a single spawn each, so the cost is the same for one worktree as
 * for twenty. Every path passed in gets an entry, whether or not anything is
 * running in it.
 */
export const agentsFor = (
  worktrees: ReadonlyArray<string>,
): Effect.Effect<ReadonlyMap<string, AgentsSummary>, never, Services> =>
  Effect.gen(function*() {
    const [claude, codex] = yield* Effect.all(
      [claudeSessions(worktrees), codexThreads(worktrees)],
      { concurrency: 2 },
    );
    const fetchedAt = DateTime.formatIso(yield* DateTime.now);
    const notices = [claude.notice, ...codex.notices].filter((notice) => notice !== null);
    const summaries = new Map<string, AgentsSummary>();
    for (const path of worktrees) {
      summaries.set(path, {
        claude: claude.byWorktree.get(path) ?? [],
        codex: codex.byWorktree.get(path) ?? [],
        notices,
        fetchedAt,
      });
    }
    return summaries;
  });

/**
 * The directories whose contents change when the listings would change: Claude
 * Code's session registry and Codex's writer locks. One that does not exist is
 * left out; there is nothing to watch, and its absence is itself an answer the
 * sources already give.
 */
export const watchedDirectories = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const candidates = [yield* registryDirectory, yield* lockDirectory];
  const watchable: Array<string> = [];
  for (const path of candidates) {
    if (path === null) continue;
    if (yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false))) watchable.push(path);
  }
  return watchable;
});
