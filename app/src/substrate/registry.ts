import { Effect, Schema, SchemaIssue, SchemaTransformation } from 'effect'

/**
 * What a person can do, as the substrate knows it: commands, the keys and
 * clicks that run them, and the scope each acts at, which is the level the
 * focus reifies. No app's noun is named here: an app's scopes are its own
 * literal union, handed in when its registry is built, and its commands are
 * data decoded through the schema below, so a registry that breaks one of
 * its rules fails when it is built.
 */

/**
 * A key that runs a command: its name as the keyboard reports it, a letter in
 * lower case, a character such as `;` or `?`, or a named key such as
 * `Escape`, `Enter`, `ArrowDown` or `Space`, with Shift and Ctrl held or not.
 * A letter is the same key in either case, so Shift is what tells `j` from
 * `J`.
 */
export const KeySchema = Schema.Struct({
  key: Schema.NonEmptyString,
  shift: Schema.Boolean,
  ctrl: Schema.Boolean,
})
export type Key = typeof KeySchema.Type

/** How a key is written in a registry and shown in the key map: `j`, `Shift+j`, `Ctrl+k`, `Escape`. */
export const keyText = (key: Key) => `${key.ctrl ? 'Ctrl+' : ''}${key.shift ? 'Shift+' : ''}${key.key}`

const keyWritten = /^(?<ctrl>Ctrl\+)?(?<shift>Shift\+)?(?<name>.+)$/u

/**
 * A key as a registry writes it, `Shift+j`, decoded to what it names: a
 * letter is read in lower case, since the key map and the matching both go
 * by Shift rather than by the letter's case.
 */
export const KeyFromTextSchema = Schema.String.pipe(
  Schema.decodeTo(
    KeySchema,
    SchemaTransformation.transformEffect({
      decode: (text, options) => {
        const groups = keyWritten.exec(text)?.groups
        const name = groups?.['name']
        if (groups === undefined || name === undefined) {
          return Effect.fail(new SchemaIssue.InvalidValue({ message: `“${text}” names no key` }, text, options))
        }
        return Effect.succeed({
          key: /^\p{Letter}$/u.test(name) ? name.toLowerCase() : name,
          shift: groups['shift'] !== undefined,
          ctrl: groups['ctrl'] !== undefined,
        })
      },
      encode: (key) => Effect.succeed(keyText(key)),
    }),
  ),
)

/** A click that runs a command, named by what it lands on, such as the focused row or a step of the path line. */
export const ClickSchema = Schema.Struct({ on: Schema.NonEmptyString })

/**
 * What a command asks for before it acts: nothing, a name typed in, or one of
 * a list of choices, each asked for in the one input mode, the palette's.
 */
export const InputSchema = Schema.Literals(['none', 'name', 'choice'])

/**
 * Something a person can do: its id, its name, the scope it acts at, the keys
 * and clicks that run it, what running it does, and the input it takes. Every
 * action is a command, the key that opens the palette included.
 */
const commandFields = {
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  keys: Schema.Array(KeyFromTextSchema),
  clicks: Schema.Array(ClickSchema),
  summary: Schema.NonEmptyString,
  input: InputSchema,
}

export const CommandSchema = Schema.Struct({ ...commandFields, scope: Schema.NonEmptyString })
export type Command = typeof CommandSchema.Type

/**
 * Every rule a registry breaks, one sentence each: a repeated id, a key bound
 * twice in one scope, and a key of the root scope bound in any other, since a
 * root key is one every level keeps. One key in two other scopes is one verb
 * at two levels, and allowed.
 */
export function violations({ commands, root }: {
  readonly commands: ReadonlyArray<Pick<Command, 'id' | 'scope' | 'keys'>>
  readonly root: string
}): string[] {
  const found: string[] = []
  const ids = new Set<string>()
  const bound = new Map<string, Map<string, string>>()
  for (const command of commands) {
    if (ids.has(command.id)) found.push(`Command id '${command.id}' repeats`)
    ids.add(command.id)
    const inScope = bound.get(command.scope) ?? new Map<string, string>()
    bound.set(command.scope, inScope)
    for (const key of command.keys) {
      const text = keyText(key)
      const other = inScope.get(text)
      if (other !== undefined) found.push(`Key '${text}' runs both '${other}' and '${command.id}' in ${command.scope}`)
      inScope.set(text, command.id)
    }
  }
  const rootKeys = bound.get(root) ?? new Map<string, string>()
  for (const [scope, keys] of bound) {
    if (scope === root) continue
    for (const [text, id] of keys) {
      const rooted = rootKeys.get(text)
      if (rooted !== undefined) found.push(`Key '${text}' runs both '${rooted}' of ${root} and '${id}' of ${scope}`)
    }
  }
  return found
}

/**
 * A registry for an app's scopes, `root` the first of them: its commands as
 * a registry writes them, each scope one of the app's, checked against every
 * rule above when it is decoded, so a clash fails where the registry is
 * built.
 */
export const registrySchema = <Scope extends string>({ scope, root }: {
  readonly scope: Schema.Codec<Scope, Scope>
  readonly root: Scope
}) =>
  Schema.Array(Schema.Struct({ ...commandFields, scope })).check(
    Schema.makeFilter((commands) => {
      const found = violations({ commands, root })
      return found.length === 0 ? true : found.join('; ')
    }),
  )
