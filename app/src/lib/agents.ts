import type { ClaudeSession, CodexThread } from '../../contract'

/**
 * What the two agent surfaces agree a listing means. The board's strip and the
 * index's cell read the same words off the same answers, so one can never call
 * a session something the other does not, and the actions beside a session are
 * the same list rendered twice.
 *
 * The concept under both is live against resumable. A live thing has a process
 * behind it: a Claude Code session with a pid, or a Codex thread an app holds
 * open. Only a live thing can need you now. A resumable thing is a handle and
 * the last state anything knew it in; the only thing to do with one is pick it
 * back up.
 */

/** A session the listing gave neither a status nor a state for. */
const missingStatus = 'no status'

/** The one status that means a live session is waiting on a person. */
const waitingStatus = 'waiting'

/** The one state that means a session is waiting on a person. */
const blockedState = 'blocked'

/** A session with a process behind it. Without one it is a handle, not a session at work. */
export const isLive = (session: ClaudeSession) => session.pid !== null

/**
 * A thread nothing holds: the locks were read, and this one was not among
 * them. It is the only Codex answer that is a handle rather than a thing at
 * work, and the only one that carries a command to pick it back up. A thread
 * whose locks could not be read is not this, and is never demoted as if it
 * were.
 */
export const isParkedThread = (thread: CodexThread) => thread.loaded === false

/** What to call a session: its name, else whatever handle identifies it. */
export const sessionName = (session: ClaudeSession) =>
  session.name ?? session.backgroundId ?? (session.pid === null ? 'Session' : `pid ${session.pid}`)

/**
 * The one word for a session. A live session says what it is doing now; a
 * resumable one can only say the state Claude Code last knew it in.
 */
export const wordOf = (session: ClaudeSession) =>
  (isLive(session) ? session.status : session.state) ?? missingStatus

/**
 * Whether this session is waiting on a person right now. Only a live session
 * can be: a parked session's `blocked` is a memory, not a request. This is the
 * one thing on either surface that earns a colour.
 */
export const needsYou = (session: ClaudeSession) =>
  isLive(session) && (session.status === waitingStatus || session.state === blockedState)

/** What Claude Code means by a live session's status word. */
const statusMeanings: Record<string, string> = {
  busy: 'It is working on a turn.',
  idle: 'It is waiting for your next prompt.',
  shell: 'It is running a shell command.',
}

/** What Claude Code meant by the state it last knew a session in. */
const stateMeanings: Record<string, string> = {
  working: 'it was driving its own work, a turn, a loop iteration, or a wait on CI',
  blocked:
    'it was waiting on you, for a question it asked, a permission or sandbox decision, an error only you can clear, or its first prompt',
  done: 'its last turn had finished and it was ready for the next prompt',
  failed: 'it had ended with an error',
  stopped: 'it had been stopped',
}

/** Why a live session is waiting on you, in the listing's own words when it gives them. */
const needsYouMeaning = (session: ClaudeSession) =>
  session.waitingFor === null
    ? 'It needs you, and the listing did not say what for.'
    : `It needs you: ${session.waitingFor}.`

/** What is left to say about a session whose process is gone. */
const resumableMeaning = (session: ClaudeSession) => {
  const attach = '`claude attach` picks it up.'
  if (session.state === null) {
    return `Its process is gone and Claude Code reported no state for it. ${attach}`
  }
  const known = stateMeanings[session.state]
  return known === undefined
    ? `Its process is gone. Claude Code last knew it as ${session.state}, a state this build does not know. ${attach}`
    : `Its process is gone. Claude Code last knew it as ${session.state}: ${known}. ${attach}`
}

/**
 * What the word beside a session means, as a sentence. Needing a person
 * outranks any other word, because it is the one thing that is about you
 * rather than about the session. A word this build has never heard of is still
 * shown, and says only where it came from.
 */
export const meaningOf = (session: ClaudeSession): string => {
  if (!isLive(session)) return resumableMeaning(session)
  if (needsYou(session)) return needsYouMeaning(session)
  if (session.status === null) return 'Its process is running and the listing reported no status for it.'
  return statusMeanings[session.status]
    ?? `Claude Code reported its status as ${session.status}, a status this build does not know.`
}

/** What the Codex word means. It is about an app holding the thread, never a turn. */
export const loadedMeaning = (loaded: boolean | null) =>
  loaded === null
    ? 'Whether an app holds this thread could not be read.'
    : loaded
    ? 'An app holds this thread open.'
    : 'No app holds this thread. Open it in Codex, or resume it in a terminal.'

/** The word beside a Codex thread; it says only whether an app holds it. */
export const wordOfThread = (thread: CodexThread) =>
  thread.loaded === null ? 'unknown' : thread.loaded ? 'open' : 'not open'

/**
 * The order a person needs sessions in: what is waiting on them, then what is
 * moving, then what is idle, then everything that is only a handle. A live word
 * this build does not know sits with `idle`: it is live, so it outranks a
 * resumable session, and it is not a request, so it does not outrank work.
 */
export const rank = (session: ClaudeSession): number => {
  if (!isLive(session)) return 3
  if (needsYou(session)) return 0
  const word = wordOf(session)
  return word === 'busy' || word === 'shell' ? 1 : 2
}

/** Codex says nothing about turns, so its order is only whether a thread is held. */
export const rankCodex = (thread: CodexThread): number =>
  thread.loaded === true ? 0 : thread.loaded === null ? 1 : 2

/** A moment as a number, where a stamp no date can hold sorts last. */
const moment = (iso: string) => {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? 0 : at
}

/**
 * The order both surfaces list sessions in. Inside the resumable tier the
 * newest is the one most likely to be picked back up, so it leads.
 */
export const sortSessions = (sessions: readonly ClaudeSession[]): ClaudeSession[] =>
  sessions.toSorted((left, right) => {
    const byRank = rank(left) - rank(right)
    if (byRank !== 0) return byRank
    if (isLive(left) || isLive(right)) return 0
    return moment(right.startedAt) - moment(left.startedAt)
  })

/** The same for threads: held first, then by recency. */
export const sortThreads = (threads: readonly CodexThread[]): CodexThread[] =>
  threads.toSorted((left, right) => {
    const byRank = rankCodex(left) - rankCodex(right)
    return byRank === 0 ? moment(right.updatedAt) - moment(left.updatedAt) : byRank
  })

/**
 * What can be done with one session, as data. Both surfaces render this list —
 * the strip as buttons, the index as a menu — so neither can offer an action
 * the other does not, and neither can offer one the listing did not support.
 * Every action carries the sentence that says what it does, so the control
 * explains itself wherever it is drawn.
 */
export type Action =
  | { kind: 'focus'; label: string; meaning: string; pid: number }
  | { kind: 'link'; label: string; meaning: string; href: string; external: boolean }
  | { kind: 'copy'; label: string; meaning: string; value: string }

/**
 * Where a Claude Code session can be reached, and only where it actually can
 * be. A session with a tab to focus is not offered a second copy of itself;
 * a resumable session has no tab, so its `claude attach` is always there.
 */
export const actionsFor = (session: ClaudeSession): Action[] => {
  const actions: Action[] = []
  if (session.terminal !== null && session.pid !== null) {
    actions.push({
      kind: 'focus',
      label: 'Focus terminal',
      meaning: 'Bring its cmux tab to the front.',
      pid: session.pid,
    })
  }
  if (session.web !== null) {
    actions.push({
      kind: 'link',
      label: 'Open on claude.ai',
      meaning: "Open this session's page on claude.ai.",
      href: session.web,
      external: true,
    })
  }
  if (session.terminal === null && session.resume !== null) {
    actions.push({
      kind: 'copy',
      label: 'Copy resume command',
      meaning: `Copies the command that picks this session up in a terminal: ${session.resume}`,
      value: session.resume,
    })
  }
  if (session.sessionId !== null) {
    actions.push({
      kind: 'copy',
      label: 'Copy session id',
      meaning: `Copies this session's id: ${session.sessionId}`,
      value: session.sessionId,
    })
  }
  return actions
}

/** The same for a Codex thread: the app that holds it, and its two handles. */
export const actionsForThread = (thread: CodexThread): Action[] => {
  const actions: Action[] = [
    {
      kind: 'link',
      label: 'Open in Codex',
      meaning: 'Open this thread in the Codex app.',
      href: thread.link,
      external: false,
    },
  ]
  if (thread.resume !== null) {
    actions.push({
      kind: 'copy',
      label: 'Copy resume command',
      meaning: `Copies the command that picks this thread up in a terminal: ${thread.resume}`,
      value: thread.resume,
    })
  }
  actions.push({
    kind: 'copy',
    label: 'Copy thread id',
    meaning: `Copies this thread's id: ${thread.id}`,
    value: thread.id,
  })
  return actions
}

/** One key per action within a session; a session never repeats a label. */
export const actionKey = (action: Action) => `${action.kind}:${action.label}`

/** What the two tiers mean, wherever they are named. */
export const tierMeaning = {
  live: 'A session whose process is running, or a thread an app holds open.',
  resumable: 'Nothing holds it now; the command in its row picks it back up.',
}
