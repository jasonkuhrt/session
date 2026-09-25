import type { ClaudeSession } from '../../contract'
import { registryFile } from './agents'

/**
 * What a session is called, and where the name came from, as both agent
 * surfaces say it. The listing gives the name; the session's registry file
 * says whether Claude Code made it up or someone gave it, and that word is all
 * the board goes by.
 */

/** What to call a session: its name, else whatever handle identifies it. */
export const sessionName = (session: ClaudeSession) =>
  session.name ?? session.backgroundId ?? (session.pid === null ? 'Session' : `pid ${session.pid}`)

/** The registry's word for the name Claude Code makes from the folder, `<folder>-<two hex>`, when nobody named the session. */
const derivedName = 'derived'

/** The registry's word for a name given with `/rename` or `--name`. */
const givenName = 'user'

/**
 * Whether a session goes by the name Claude Code made for it, which both
 * surfaces draw very dim. The registry's word is the whole test: a name that
 * only looks made up is not second-guessed.
 */
export const isDerivedName = (session: ClaudeSession) => session.name !== null && session.nameSource === derivedName

/** Where a session's name came from, in a sentence, from the registry's own word for it. */
export const nameMeaning = (session: ClaudeSession): string => {
  if (session.name === null) return 'Claude Code lists no name for it, so it goes by its handle.'
  if (session.pid === null) return 'It has no process, so no registry file says where this name came from.'
  const file = registryFile(session.pid)
  if (session.nameSource === derivedName) {
    return `Claude Code made this name from the folder because nobody has named the session, and ${file} records its source as derived. /rename names it.`
  }
  if (session.nameSource === givenName) {
    return `The name it was given with /rename or --name: ${file} records its source as user.`
  }
  if (session.nameSource === null) return `Nothing read from ${file} says where this name came from.`
  return `${file} records this name's source as ${session.nameSource}.`
}

/** What a Codex thread's name is, since the listing may name it by its preview. */
export const threadNameMeaning =
  "The thread's name in Codex; one without a name goes by the first line of its preview, and one with neither by its id."
