import type { PhrasingContent, Root, Table, TableCell, TableRow, Text } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

/*
 * A document's ubiquitous language: the terms its `Term | Meaning` tables
 * define, and the references to them in its prose. A reference is written
 * `@Term`, or `@Two Words@` when the term holds spaces; the closing `@` is
 * allowed on any term, and what follows it at once stays prose, so `@Model@s`
 * reads "Models" with the term marked. Only text that names a term of the
 * same document exactly is a reference: a `@word` that names none stays as it
 * is written, and a document without such a table reads as it always has.
 */

/** A term a document defines: its meaning, the id its row is given, and where that row starts. */
type Definition = {
  /** The Meaning cell's own Markdown, as the document writes it between the cell's pipes. */
  readonly meaning: string
  /** The id of the term's row, which a reference's card links to. */
  readonly id: string
  /** Where the term's row starts in the document, which says which part of the document holds it. */
  readonly at: number
}

/** The terms one document defines, by term, and the pattern a reference to one of them matches. */
export type Glossary = {
  readonly terms: ReadonlyMap<string, Definition>
  readonly reference: RegExp | null
}

const noTerms: Glossary = { terms: new Map(), reference: null }

const parser = unified().use(remarkParse).use(remarkGfm)

/** Text on one line, as a reader sees it: every run of white space one space. */
const oneLine = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** The words of some Markdown as a reader reads them, inline code's included without its backticks. */
const wordsOf = (nodes: readonly PhrasingContent[]): string =>
  nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'inlineCode') return node.value
      return 'children' in node ? wordsOf(node.children) : ''
    })
    .join('')

/** A cell's words on one line, which for a Term cell is its term. */
const cellText = (cell: TableCell) => oneLine(wordsOf(cell.children))

/** Whether a table defines terms: its head reads exactly `Term | Meaning`. */
const definesTerms = (table: Table) => {
  const [term, meaning, ...rest] = table.children[0]?.children ?? []
  return term !== undefined && meaning !== undefined && rest.length === 0 && cellText(term) === 'Term' && cellText(meaning) === 'Meaning'
}

/** One row of a table that defines terms: the row, its term, its Term cell, and its Meaning cell when it has one. */
type TermRow = { readonly row: TableRow; readonly term: string; readonly cell: TableCell; readonly meaning: TableCell | undefined }

/** The rows of every table in a tree that defines terms, in the order the document holds them. */
const termRows = (tree: Root): TermRow[] => {
  const rows: TermRow[] = []
  visit(tree, 'table', (table) => {
    if (!definesTerms(table)) return
    for (const row of table.children.slice(1)) {
      const [cell, meaning] = row.children
      if (cell !== undefined) rows.push({ row, term: cellText(cell), cell, meaning })
    }
  })
  return rows
}

/** A cell's own Markdown, as the document writes it between the cell's pipes; empty for a cell with nothing in it. */
const sourceOf = (document: string, cell: TableCell | undefined) => {
  const start = cell?.children.at(0)?.position?.start.offset
  const end = cell?.children.at(-1)?.position?.end.offset
  return start === undefined || end === undefined ? '' : document.slice(start, end)
}

/**
 * The id a term's row is given: `term-`, then the term in lower case with each
 * run of anything but letters and digits as one hyphen, and a number after
 * it when an earlier term already took it, so every row's id is its own.
 */
const idOf = (term: string, taken: ReadonlySet<string>) => {
  const base = `term-${term.toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, '-').replaceAll(/^-+|-+$/gu, '')}`
  let id = base
  for (let count = 2; taken.has(id); count += 1) id = `${base}-${count}`
  return id
}

/** A letter, a digit or an underscore: what may not come right before a reference's `@`, nor right after an open one. */
const wordCharacter = String.raw`[\p{L}\p{N}_]`

/** Text as a pattern that matches it and nothing else. */
const escapeRegExp = (text: string) => text.replaceAll(/[\\^$.*+?()[\]{}|/]/gu, '\\$&')

/**
 * Terms as alternatives of a pattern, each matching itself with a space
 * matching any run of white space, as a reference that wraps a line has, and
 * the longest first, so a term is never read as a shorter one it starts with.
 */
const escapeRegExpAlternatives = (terms: readonly string[]) =>
  terms
    .toSorted((one, other) => other.length - one.length)
    .map((term) => escapeRegExp(term).replaceAll(' ', String.raw`\s+`))
    .join('|')

/**
 * What a reference to one of the terms matches: an `@` that no letter or
 * digit touches, then a term closed by `@`, or a term without spaces that no
 * letter or digit follows. The first group is a closed reference's term and
 * the second an open one's.
 */
const referenceTo = (terms: readonly string[]) => {
  const single = terms.filter((term) => !term.includes(' '))
  const open = single.length === 0 ? '' : String.raw`|(${escapeRegExpAlternatives(single)})(?!${wordCharacter})`
  return new RegExp(String.raw`(?<!${wordCharacter})@(?:(${escapeRegExpAlternatives(terms)})@${open})`, 'gu')
}

/**
 * The terms a document defines: each Term cell of a table whose head is
 * `Term | Meaning`, its backticks stripped, with the Meaning cell's own
 * Markdown, taken from the document by the cell's place in it. A term defined
 * twice keeps its first row. `Description` heads no glossary, and only a
 * document that says `Meaning` is read for one.
 */
export const glossaryOf = (document: string): Glossary => {
  if (!document.includes('Meaning')) return noTerms
  const terms = new Map<string, Definition>()
  const ids = new Set<string>()
  for (const { row, term, meaning } of termRows(parser.parse(document))) {
    const at = row.position?.start.offset
    if (term === '' || terms.has(term) || at === undefined) continue
    const id = idOf(term, ids)
    ids.add(id)
    terms.set(term, { meaning: sourceOf(document, meaning), id, at })
  }
  return terms.size === 0 ? noTerms : { terms, reference: referenceTo([...terms.keys()]) }
}

/** A reference, as the reader draws it: its words as written, without its `@` marks, naming its term. */
const referenceMark = (words: string): Text => ({
  type: 'text',
  value: words,
  data: { hName: 'span', hProperties: { className: ['term'], dataTerm: oneLine(words) } },
})

/** A Term cell's term, drawn as the term it defines: the defining instance, which HTML calls `dfn`. */
const definitionMark = (term: string): Text => ({
  type: 'text',
  value: term,
  data: { hName: 'dfn', hProperties: { className: ['term'] } },
})

/**
 * The remark plugin that draws a document's terms. It marks each reference
 * with the term it names, draws each Term cell as its term, and gives each
 * term's row its id. The glossary is the whole document's, from `glossaryOf`,
 * and the tree may be only the part of the document whose text starts at
 * `offset`, as what an item holds after its Evidence heading is: a row is
 * given its term's id when it is the row the glossary names, found where it
 * starts in the document. A reference inside a link stays as it is written,
 * since the link is what the reader acts on there.
 */
export function remarkTerms({ glossary, offset }: { readonly glossary: Glossary; readonly offset: number }) {
  return (tree: Root) => {
    const { terms, reference } = glossary
    if (reference === null) return
    const rows = termRows(tree).filter(({ term }) => terms.has(term))
    for (const { row, term } of rows) {
      const definition = terms.get(term)
      const at = row.position?.start.offset
      if (definition === undefined || at === undefined || offset + at !== definition.at) continue
      row.data = { ...row.data, hProperties: { ...row.data?.hProperties, id: definition.id } }
    }
    findAndReplace(
      tree,
      [reference, (_reference: string, closed?: string, open?: string) => referenceMark(closed ?? open ?? '')],
      { ignore: ['link', 'linkReference'] },
    )
    // Last, so whatever the marks above made of a Term cell's own words gives way to its term.
    for (const { cell, term } of rows) cell.children = [definitionMark(term)]
  }
}
