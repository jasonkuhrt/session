import { substrateIds } from './commands'
import type { Mode } from './modes'
import { leafOf } from './path'
import type { Key } from './registry'
import { keyText } from './registry'
import type { Path, Seam, Target } from './seam'

/**
 * How a key finds its command: the nodes on the focus path, nearest first,
 * each at its scope, and what the focused node stands for right after it;
 * the nearest scope that binds the key decides, and when its command cannot
 * run there nothing runs and the reason is said, rather than the key falling
 * through to a farther scope. While a mode is open only its scope binds, with
 * the few root commands that still make sense inside it.
 */

/** The nodes on a path, nearest first, each with its scope, and what the focused node stands for after it. */
export const targetsOf = ({ seam, path }: { readonly seam: Seam; readonly path: Path }): Target[] => {
  const found: Target[] = []
  for (let at = path.length - 1; at >= 0; at--) {
    const prefix = path.slice(0, at + 1)
    const id = path[at] ?? ''
    found.push({ scope: seam.scopeOf(id), id, path: prefix })
    if (at === path.length - 1) {
      for (const standing of seam.standsFor(prefix)) {
        found.push({ scope: seam.scopeOf(leafOf(standing)), id: leafOf(standing), path: standing })
      }
    }
  }
  return found
}

const substrateCommandIds: ReadonlySet<string> = new Set(Object.values(substrateIds))

/**
 * Whether one of the substrate's own commands can act with the focus where it
 * is, as the surface answers it from what it draws and what the app says
 * through the seam: true, or why not, as an app's command answers.
 */
type OwnWhen = (id: string) => true | string

/** Whether a command can act on a target with the focus where it is: true, or why not. */
const canRun = ({ seam, id, target, focus, own }: {
  readonly seam: Seam
  readonly id: string
  readonly target: Target
  readonly focus: Path
  readonly own: OwnWhen
}): true | string => {
  if (substrateCommandIds.has(id)) return own(id)
  const runner = seam.runners[id]
  if (runner === undefined) return `${seam.registry.find((command) => command.id === id)?.name ?? id} does not apply here`
  return runner.when?.(target, focus) ?? true
}

/** Every command that can run at the focus, nearest scope first, each on the node it acts on. */
export const runnableAt = ({ seam, focus, own }: { readonly seam: Seam; readonly focus: Path; readonly own: OwnWhen }) => {
  const seen = new Set<string>()
  const found: Array<{ readonly id: string; readonly target: Target }> = []
  for (const target of targetsOf({ seam, path: focus })) {
    for (const command of seam.registry) {
      if (command.scope !== target.scope || seen.has(command.id) || canRun({ seam, id: command.id, target, focus, own }) !== true) continue
      seen.add(command.id)
      found.push({ id: command.id, target })
    }
  }
  return found
}

/** The scope a mode's keys resolve in, and the root's commands that still act while it is open. */
const modeKeys: Record<Mode['kind'], { readonly scope: string | null; readonly allows: ReadonlySet<string> }> = {
  palette: { scope: 'palette', allows: new Set([substrateIds.leave, substrateIds.up, substrateIds.down]) },
  choose: { scope: 'palette', allows: new Set([substrateIds.leave, substrateIds.up, substrateIds.down]) },
  name: { scope: 'dialog', allows: new Set([substrateIds.leave]) },
  keymap: { scope: null, allows: new Set([substrateIds.keyMap, substrateIds.leave, substrateIds.up, substrateIds.down]) },
  settings: { scope: null, allows: new Set([substrateIds.leave]) },
}

/** The command a key runs at the focus, on the node it acts on, and why it cannot when it cannot; null when no scope binds the key. */
export const resolveKey = ({ seam, key, focus, mode, own }: {
  readonly seam: Seam
  readonly key: Key
  readonly focus: Path
  readonly mode: Mode | null
  readonly own: OwnWhen
}) => {
  const text = keyText(key)
  const rules = mode === null ? null : modeKeys[mode.kind]
  const root = seam.scopes[0] ?? ''
  const targets: Target[] = rules === null
    ? targetsOf({ seam, path: focus })
    : [
      ...(rules.scope === null ? [] : [{ scope: rules.scope, id: rules.scope, path: focus }]),
      { scope: root, id: seam.root, path: [seam.root] },
    ]
  for (const target of targets) {
    const command = seam.registry.find((candidate) =>
      candidate.scope === target.scope && candidate.keys.some((bound) => keyText(bound) === text) &&
      (rules === null || target.scope !== root || rules.allows.has(candidate.id))
    )
    if (command === undefined) continue
    const answer = canRun({ seam, id: command.id, target, focus, own })
    return { command, target, refused: answer === true ? null : answer }
  }
  return null
}

/** Keys a field types with, which stay the field's while a mode's input has the focus. */
const typingKeys: ReadonlySet<string> = new Set(['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', ' '])

/** Whether a key comes from a field, where it types. */
const isField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))

/** Whether a key is a control's own, Enter or Space on a link or a button that has the browser's focus. */
const controlKeeps = (event: KeyboardEvent) =>
  (event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLElement &&
  event.target.closest('a[href], button, summary, [role="button"], [role="checkbox"]') !== null

/**
 * Whether a key is the page's own rather than the registry's: a letter or a
 * typing key in a field, which types; any key in a field outside a mode; and
 * Enter or Space on a control that has the browser's focus, outside a mode
 * and in the settings, whose controls are its own.
 */
export const keptByPage = ({ event, mode }: { readonly event: KeyboardEvent; readonly mode: Mode | null }) => {
  if (event.isComposing || event.metaKey || event.altKey) return true
  if (isField(event.target) && !event.ctrlKey && (event.key.length === 1 || typingKeys.has(event.key))) return true
  if (mode === null) return isField(event.target) || controlKeeps(event)
  return mode.kind === 'settings' && controlKeeps(event)
}
