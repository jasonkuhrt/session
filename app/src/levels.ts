import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from 'effect'

import { StageSchema } from '../contract'
import { modeScopes } from './substrate/commands'

/**
 * Session's levels, root first, each a scope: every project, a project, an
 * epic, a worktree, a stage, a group, an item, a section of a page, and a
 * record, the page of a ledger, `context/`, the archive or a file. The
 * substrate's two mode scopes close the list.
 */
export const levels = ['all', 'project', 'epic', 'worktree', 'stage', 'group', 'item', 'section', 'record'] as const

export const ScopeSchema = Schema.Literals([...levels, ...modeScopes])
export type Scope = typeof ScopeSchema.Type

/** What each scope is called in the key map. */
export const scopeNames: Record<Scope, string> = {
  all: 'All',
  project: 'Project',
  epic: 'Epic',
  worktree: 'Worktree',
  stage: 'Stage',
  group: 'Group',
  item: 'Item',
  section: 'Section',
  record: 'Page',
  palette: 'Palette (mode)',
  dialog: 'Name (mode)',
}

/** The pages a worktree, an epic or a project is read on beside its board. */
export const RecordPageSchema = Schema.Literals(['ledger', 'context', 'archive', 'file'])
export type RecordPage = typeof RecordPageSchema.Type

/**
 * A node of session's tree, as its id names it. A project goes by the path
 * the index heads its section with, or `across` for the epics across
 * projects; an epic by its name; a worktree on the index by its path, since
 * two rows can share a key while one is not served. On a board a worktree's
 * part of a lane, its groups and its items go by the key it is served under,
 * which a board's rows never share. A section goes by where it is on its
 * page, and a record by its page and, for a file, the file's path under the
 * session.
 */
export const NodeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('all') }),
  Schema.Struct({ kind: Schema.Literal('project'), key: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('epic'), name: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('worktree'), path: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('stage'), stage: StageSchema }),
  Schema.Struct({ kind: Schema.Literal('part'), key: Schema.NonEmptyString, stage: StageSchema }),
  Schema.Struct({ kind: Schema.Literal('group'), key: Schema.NonEmptyString, stage: StageSchema, name: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('item'), key: Schema.NonEmptyString, id: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('section'), at: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('record'), page: RecordPageSchema, path: Schema.String }),
])
export type Node = typeof NodeSchema.Type

/** The fields each kind writes into its id, in order. */
const fieldsOf = {
  all: [],
  project: ['key'],
  epic: ['name'],
  worktree: ['path'],
  stage: ['stage'],
  part: ['key', 'stage'],
  group: ['key', 'stage', 'name'],
  item: ['key', 'id'],
  section: ['at'],
  record: ['page', 'path'],
} as const satisfies Record<Node['kind'], readonly string[]>

const isKind = (kind: string): kind is Node['kind'] => Object.hasOwn(fieldsOf, kind)

/** A field as an id writes it: a colon and a percent sign written as escapes, so a colon only ever separates. */
const escapeField = (field: string) => field.replaceAll('%', '%25').replaceAll(':', '%3A')

/** A field as an id wrote it, or null when its escapes are not ones an id writes. */
const unescapeField = (field: string): string | null => {
  try {
    return decodeURIComponent(field)
  } catch {
    return null
  }
}

const decodeNode = Schema.decodeUnknownOption(NodeSchema)

/** A node as its id writes it, `item:session:SES-32`: its kind, then its fields, each escaped. */
const formatNode = (node: Node): string => {
  const record: Readonly<Record<string, string>> = node
  return [node.kind, ...fieldsOf[node.kind].map((field) => escapeField(record[field] ?? ''))].join(':')
}

/**
 * A node's id, as the tree and the address carry it, decoded to the node it
 * names: an id that names no node is refused where it is read.
 */
export const NodeIdSchema = Schema.String.pipe(
  Schema.decodeTo(
    NodeSchema,
    SchemaTransformation.transformEffect({
      decode: (id, options) => {
        const [kind = '', ...values] = id.split(':')
        const refused = Effect.fail(new SchemaIssue.InvalidValue({ message: `“${id}” names no node` }, id, options))
        if (!isKind(kind)) return refused
        const names = fieldsOf[kind]
        if (values.length !== names.length) return refused
        const unescaped = values.map((value) => unescapeField(value))
        if (unescaped.some((value) => value === null)) return refused
        const fields = Object.fromEntries(names.map((name, index) => [name, unescaped[index]]))
        return Option.match(decodeNode({ kind, ...fields }), {
          onNone: () => refused,
          onSome: (node) => Effect.succeed(node),
        })
      },
      encode: (node) => Effect.succeed(formatNode(node)),
    }),
  ),
)

const encodeId = Schema.encodeSync(NodeIdSchema)

/** A node's id. */
export const idOf = (node: Node) => encodeId(node)

const readNode = Schema.decodeUnknownOption(NodeIdSchema)

/** The node an id names, or null for an id that names none. */
export const nodeOf = (id: string): Node | null => Option.getOrNull(readNode(id))

/** The root's id. */
export const rootId = idOf({ kind: 'all' })

/** The scope a node's id is at. */
export const scopeOfId = (id: string): Scope => {
  const node = nodeOf(id)
  if (node === null) return 'all'
  if (node.kind === 'part') return 'worktree'
  return node.kind
}
