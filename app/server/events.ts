/**
 * The push seam between the daemon and the board. The daemon watches a
 * worktree's `.session` and calls `changed()`; the HTTP layer subscribes and
 * writes one server-sent event per notification. Nothing here touches the
 * filesystem, so both sides can depend on it.
 */

/** What the HTTP layer needs: subscribe, and stop listening. */
export type SessionEvents = {
  /** Registers a listener and returns the function that removes it. */
  readonly subscribe: (notify: () => void) => () => void;
};

/** What the daemon needs on top: the trigger, whether anyone is listening, and the shutdown. */
export type SessionEventSource = SessionEvents & {
  /** Records a change; listeners hear about it once the burst settles. */
  readonly changed: () => void;
  /** True while at least one page holds a stream subscribed to this source. */
  readonly watched: () => boolean;
  readonly close: () => void;
};

/** Editors and the engine write several files per change; collapse the burst. */
const settleMilliseconds = 150;

/**
 * A source that tells its listeners once a burst of changes has been quiet for
 * `settle` milliseconds. With a `ceiling`, a burst that never goes quiet is
 * told at least that often, measured from its first change, so changes that
 * keep arriving hold its listeners back no longer than that.
 */
export const makeSessionEvents = (
  { settle = settleMilliseconds, ceiling }: { readonly settle?: number; readonly ceiling?: number } = {},
): SessionEventSource => {
  const listeners = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (pending !== undefined) clearTimeout(pending);
    if (deadline !== undefined) clearTimeout(deadline);
    pending = undefined;
    deadline = undefined;
  };

  const flush = () => {
    stop();
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    changed: () => {
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(flush, settle);
      if (ceiling !== undefined && deadline === undefined) deadline = setTimeout(flush, ceiling);
    },
    watched: () => listeners.size > 0,
    close: () => {
      stop();
      listeners.clear();
    },
  };
};
