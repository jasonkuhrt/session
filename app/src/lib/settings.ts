import { Cause, Effect, Exit, Option, Schema } from 'effect'
import * as KeyValueStore from 'effect/unstable/persistence/KeyValueStore'
import * as React from 'react'

/**
 * The board's own settings: how this browser draws the board, never the work.
 * The files stay the only record of the work, and nothing here reaches the
 * daemon. They are kept in this browser's localStorage, so they survive a
 * reload, hold on every page served from this address, and follow a change
 * made in another tab.
 *
 * The schema is what a setting is. A setting missing from what is stored reads
 * as its default, so adding one needs nothing else, and a stored key that no
 * setting has any more is dropped by the next change.
 */
export const SettingsSchema = Schema.Struct({
  /**
   * Whether a word or a control says what it means, on hover and on focus. Off
   * by default: every sentence is still there to turn on, and none of them
   * comes up under a pointer that is only passing.
   */
  tips: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
})

export type Settings = typeof SettingsSchema.Type

/** The settings as this page has them, and why the last read or write of them failed, when one did. */
export type SettingsState = { readonly settings: Settings; readonly problem: string | null }

/** Where the settings are kept: one key of this address's localStorage, holding the JSON the schema writes. */
const storageKey = 'session.settings'

const defaults: Settings = Schema.decodeSync(SettingsSchema)({})

const store = KeyValueStore.KeyValueStore.pipe(
  Effect.map((values) => KeyValueStore.toSchemaStore(values, SettingsSchema)),
  Effect.provide(KeyValueStore.layerStorage(() => localStorage)),
)

/** Why a read or a write failed, in one line, whatever it failed with: a browser can refuse storage outright. */
const reasonOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

/** The stored settings; what cannot be read leaves the defaults standing, and says so. */
const read = (): SettingsState =>
  Exit.match(Effect.runSyncExit(Effect.flatMap(store, (stored) => stored.get(storageKey))), {
    onSuccess: (stored) => ({ settings: Option.getOrElse(stored, () => defaults), problem: null }),
    onFailure: (cause) => ({
      settings: defaults,
      problem: `The saved settings could not be read, so the defaults stand: ${reasonOf(cause)}`,
    }),
  })

/** Keeps the settings; a refusal is the sentence to show, since the change still holds on this page. */
const write = (settings: Settings): string | null =>
  Exit.match(Effect.runSyncExit(Effect.flatMap(store, (stored) => stored.set(storageKey, settings))), {
    onSuccess: () => null,
    onFailure: (cause) => `The change could not be saved, so it lasts until this page reloads: ${reasonOf(cause)}`,
  })

/**
 * The settings as this page has them, read from storage when they are first
 * asked for. Nothing is read when the module loads: the build's prerender
 * loads it where there is no browser.
 */
let current: SettingsState | null = null
const listeners = new Set<() => void>()

const snapshot = () => {
  current ??= read()
  return current
}

const publish = (next: SettingsState) => {
  current = next
  for (const listener of listeners) listener()
}

// Another tab's change arrives as a storage event, and so does storage being
// cleared, which names no key.
const onStorage = (event: StorageEvent) => {
  if (event.key === storageKey || event.key === null) publish(read())
}

let listening = false

/**
 * The first subscriber starts listening for other tabs, for as long as the
 * page lives, and reads the settings again, since a tab may have changed them
 * between the first draw and this. Listening starts here rather than when the
 * module loads, which the build's prerender does where there is no window.
 */
const subscribe = (listener: () => void) => {
  if (!listening) {
    listening = true
    window.addEventListener('storage', onStorage)
    current = read()
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The settings as this page has them, kept current with every tab of this address. */
export const useSettings = (): SettingsState => React.useSyncExternalStore(subscribe, snapshot)

/** Change settings, on this page and in every other page of this address. */
export const changeSettings = (change: Partial<Settings>) => {
  const settings = { ...snapshot().settings, ...change }
  publish({ settings, problem: write(settings) })
}
