import * as React from 'react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Kbd, KbdGroup } from '../components/ui/kbd'
import { substrateIds } from './commands'
import type { Key } from './registry'
import { keyLabel } from './key-labels'
import type { Choice, NameRequest, Path, Seam, Target } from './seam'

/**
 * The modes the surface opens over a view: the palette, where plain keys type
 * and Ctrl with `j` or `k` moves the highlight; the palette's list turned to
 * a command's choices; the key map; the dialog a name is typed in; and the
 * app's settings. Only a mode that is not the normal one shows, in the detail
 * line.
 */
/** A command that can run at the focus, on the node it acts on, as the palette and the key map list them when they open. */
type Runnable = { readonly id: string; readonly target: Target }

export type Mode =
  | {
    readonly kind: 'palette'
    readonly gotoOnly: boolean
    readonly query: string
    readonly highlight: number
    /** What could run at the focus when the palette opened, which it lists nearest first. */
    readonly runnable: readonly Runnable[]
  }
  | {
    readonly kind: 'choose'
    readonly prompt: string
    readonly choices: readonly Choice[]
    readonly query: string
    readonly highlight: number
  }
  /** The key map, with what could run at the focus when it opened, which it draws bright. */
  | { readonly kind: 'keymap'; readonly runnable: ReadonlySet<string> }
  | {
    readonly kind: 'name'
    readonly request: NameRequest
    readonly value: string
    readonly error: string | null
    readonly busy: boolean
  }
  | { readonly kind: 'settings' }

/** One line of the palette: a command on the node it acts on, somewhere to go, or one of a command's choices. */
export type PaletteEntry =
  | {
    readonly kind: 'command'
    readonly key: string
    readonly id: string
    readonly target: Target
    readonly name: string
    readonly on: string
    readonly keys: readonly Key[]
  }
  | { readonly kind: 'go'; readonly key: string; readonly path: Path; readonly name: string; readonly on: string; readonly id: string | undefined }
  | { readonly kind: 'choice'; readonly key: string; readonly choice: Choice; readonly name: string; readonly on: string }

/** The substrate's commands the palette leaves out: opening it, leaving, a click, the go-to it already is, and the moves among peers. */
const unlisted: ReadonlySet<string> = new Set([
  substrateIds.palette,
  substrateIds.leave,
  substrateIds.focus,
  substrateIds.goTo,
  substrateIds.left,
  substrateIds.right,
  substrateIds.up,
  substrateIds.down,
])

/** How many names to go to the palette draws at once; typing narrows past it. */
const goToShown = 200

/** The palette's lines for what is typed: every word typed is in each line's name, what it is, or its id. */
export function entriesOf({ mode, seam }: {
  readonly mode: Extract<Mode, { kind: 'palette' | 'choose' }>
  readonly seam: Seam
}): PaletteEntry[] {
  const words = mode.query.toLowerCase().split(/\s+/u).filter(Boolean)
  const matches = (...fields: ReadonlyArray<string | undefined>) => {
    const text = fields.join(' ').toLowerCase()
    return words.every((word) => text.includes(word))
  }
  if (mode.kind === 'choose') {
    return mode.choices
      .filter((choice) => matches(choice.name, choice.on))
      .map((choice) => ({ kind: 'choice', key: choice.key, choice, name: choice.name, on: choice.on }))
  }
  const commands: PaletteEntry[] = (mode.gotoOnly ? [] : mode.runnable).flatMap(({ id, target }) => {
    const command = seam.registry.find((candidate) => candidate.id === id)
    if (command === undefined || unlisted.has(id)) return []
    const on = seam.targetName(target)
    return matches(command.name, on)
      ? [{ kind: 'command', key: `command:${id}`, id, target, name: command.name, on, keys: command.keys }]
      : []
  })
  const places: PaletteEntry[] = seam.goTo()
    .filter((place) => matches(place.name, place.on, place.id))
    .slice(0, goToShown)
    .map((place) => ({ kind: 'go', key: `go:${place.path.join('/')}`, path: place.path, name: place.name, on: place.on, id: place.id }))
  return [...commands, ...places]
}

/**
 * The keys of a command as the palette and the key map draw them, each a key
 * cap. On the palette's highlighted line, whose fill is the cap's own, a cap
 * takes the page's ground instead, as the stock cap changes its ground inside
 * a tooltip, so it still reads as a key.
 */
export function Keys({ keys }: { readonly keys: readonly Key[] }) {
  if (keys.length === 0) return null
  return (
    <KbdGroup className="ml-auto shrink-0">
      {keys.map((key) => <Kbd key={keyLabel(key)} className="in-data-highlighted:bg-background">{keyLabel(key)}</Kbd>)}
    </KbdGroup>
  )
}

/**
 * The palette: an input, then the commands that can run at the focus,
 * nearest scope first, each its name with the node it acts on dim after it
 * and its keys as key caps at the right, then everything there is to go to,
 * each with what it is dim at the right; or, for a command that asks, its
 * choices. It opens empty each time, and its placeholder never says "pin" or
 * "password", which a password extension reads as a field to fill.
 */
export function Palette({ mode, entries, onQuery, onTake, onHighlight, onClose }: {
  readonly mode: Extract<Mode, { kind: 'palette' | 'choose' }>
  readonly entries: readonly PaletteEntry[]
  readonly onQuery: (query: string) => void
  readonly onTake: (entry: PaletteEntry | undefined) => void
  readonly onHighlight: (highlight: number) => void
  readonly onClose: () => void
}) {
  const count = entries.length
  const highlight = count === 0 ? -1 : ((mode.highlight % count) + count) % count
  const input = React.useRef<HTMLInputElement>(null)
  const placeholder = mode.kind === 'choose'
    ? 'Choose, or type to narrow'
    : mode.gotoOnly
    ? 'Go to anything by name or id'
    : 'Run a command, or type a name or id to go to'
  const firstGo = entries.findIndex((entry) => entry.kind === 'go')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent initialFocus={input} showCloseButton={false} className="top-[12vh] max-h-[76vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">{mode.kind === 'choose' ? mode.prompt : 'Command palette'}</DialogTitle>
        {mode.kind === 'choose' ? <p className="px-4 pt-3 text-xs text-muted-foreground">{mode.prompt}</p> : null}
        <div className="p-2">
          <Input
            ref={input}
            aria-label="Filter"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={mode.query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>
        <div className="min-h-0 overflow-y-auto px-2 pb-2">
          {count === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">Nothing matches</p> : null}
          {entries.map((entry, index) => (
            <React.Fragment key={entry.key}>
              {index === 0 && entry.kind !== 'go'
                ? <Heading>{entry.kind === 'choice' ? 'Choose one' : 'Here, nearest first'}</Heading>
                : null}
              {index === firstGo ? <Heading>Go to</Heading> : null}
              <button
                // The highlighted entry is brought into view as the highlight reaches it.
                ref={index === highlight ? revealEntry : undefined}
                type="button"
                tabIndex={-1}
                data-highlighted={index === highlight ? '' : undefined}
                className="flex w-full min-w-0 cursor-pointer items-baseline justify-between gap-6 rounded-md px-2 py-1.5 text-left text-sm data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                onMouseMove={() => index !== highlight && onHighlight(index)}
                onClick={() => onTake(entry)}
              >
                <span className="min-w-0 truncate">
                  <span className="text-foreground">{entry.name}</span>
                  <EntryAfter entry={entry} />
                </span>
                <EntryEnd entry={entry} />
              </button>
            </React.Fragment>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Brings the highlighted entry into view, as the palette's list scrolls under it. */
const revealEntry = (element: HTMLButtonElement | null) => element?.scrollIntoView({ block: 'nearest' })

/**
 * What an entry names dim after its own name: the node a command acts on, the
 * id a place goes by, or what a choice is.
 */
function EntryAfter({ entry }: { readonly entry: PaletteEntry }) {
  if (entry.kind === 'go') return entry.id === undefined ? null : <span className="ml-2 font-mono text-xs text-muted-foreground">{entry.id}</span>
  return entry.on === '' ? null : <span className="ml-2 text-muted-foreground">{entry.on}</span>
}

/**
 * What an entry holds at its right: a command's keys as key caps, or what a
 * place to go to is, dim, which takes at most two fifths of the line and is
 * cut short past that, so a long one never squeezes out the name.
 */
function EntryEnd({ entry }: { readonly entry: PaletteEntry }) {
  if (entry.kind === 'command') return <Keys keys={entry.keys} />
  return entry.kind === 'go' ? <span className="max-w-[40%] min-w-0 truncate text-xs text-muted-foreground">{entry.on}</span> : null
}

function Heading({ children }: { readonly children: React.ReactNode }) {
  return <p className="px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</p>
}

/** The dialog a command asks for a name in: what it names, the name, and why the last one was refused. */
export function NameMode({ mode, onValue, onConfirm, onClose }: {
  readonly mode: Extract<Mode, { kind: 'name' }>
  readonly onValue: (value: string) => void
  readonly onConfirm: () => void
  readonly onClose: () => void
}) {
  const id = React.useId()
  const input = React.useRef<HTMLInputElement>(null)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent initialFocus={input} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{mode.request.title}</DialogTitle>
          <DialogDescription>{mode.request.meaning}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onConfirm()
          }}
        >
          <Input
            ref={input}
            id={id}
            aria-label={mode.request.title}
            autoComplete="off"
            spellCheck={false}
            placeholder={mode.request.placeholder}
            value={mode.value}
            onChange={(event) => onValue(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
        </form>
        <p className="text-xs text-muted-foreground">
          {mode.busy ? 'Writing…' : <><Kbd>Enter</Kbd> to confirm · <Kbd>Esc</Kbd> to cancel</>}
          {mode.error === null ? null : <span className="block pt-1 text-destructive wrap-anywhere">{mode.error}</span>}
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** The app's settings, over the view, which Escape closes as it closes every mode. */
export function SettingsMode({ onClose, children }: { readonly onClose: () => void; readonly children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings, in this browser</DialogTitle>
          <DialogDescription>How the app draws, never the work. Each says what it does.</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
