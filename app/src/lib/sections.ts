import type { Heading, Parent, PhrasingContent, Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/**
 * A page's sections: every heading of a document at its top level, `#` to
 * `###`, and what follows it up to the next, which is where a record's
 * sections begin and end as the stage rules read them. Each is a node the
 * focus can be on, known by where it is among them, and the reader draws each
 * heading as that node, with its body folded under it or not.
 */

/** A section as the tree names it: where it is among the page's sections, its heading's words, and the Markdown under it. */
export type Section = { readonly at: string; readonly heading: string; readonly body: string }

/** A block the reader draws as the element its data names, holding its children as they are. */
interface Block extends Parent {
  type: 'block'
}

declare module 'mdast' {
  interface RootContentMap {
    block: Block
  }
}

/** Whether a node opens a section: a heading one to three levels deep, as a section's end is read. */
const opensSection = (node: RootContent): node is Heading => node.type === 'heading' && node.depth <= 3

/** The words of a heading as a reader reads them. */
const wordsOf = (nodes: readonly PhrasingContent[]): string =>
  nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'inlineCode') return node.value
      return 'children' in node ? wordsOf(node.children) : ''
    })
    .join('')

const parser = unified().use(remarkParse).use(remarkGfm)

/** The sections of a document, as the reader draws them, in order. */
export const sectionsOf = (markdown: string): readonly Section[] => {
  const headings = parser.parse(markdown).children.filter(opensSection)
  return headings.map((heading, index) => ({
    at: String(index),
    heading: wordsOf(heading.children).replaceAll(/\s+/gu, ' ').trim(),
    body: markdown.slice(heading.position?.end.offset ?? markdown.length, headings[index + 1]?.position?.start.offset ?? markdown.length).trim(),
  }))
}

/** How much a section holds, in a few words: its tasks checked, the one word None, or its lines. */
export const extentOf = (section: Section) => {
  if (section.body === 'None') return 'None'
  const tasks = section.body.split(/\r?\n/u).filter((line) => /^\s*[-*] \[[ xX]\]/u.test(line))
  if (tasks.length > 0) return `${tasks.filter((line) => /\[[xX]\]/u.test(line)).length} of ${tasks.length} checked`
  const lines = section.body.split(/\r?\n/u).filter((line) => line.trim() !== '').length
  return lines === 1 ? '1 line' : `${lines} lines`
}

/** A section's heading words as it is named when it is an item's Evidence: `Evidence`, in any case. */
export const isEvidence = (section: Section) => section.heading.toLowerCase() === 'evidence'

/**
 * The remark plugin that gathers each section into a block of its own: the
 * heading, then its body in a block that folds, each marked with where the
 * section is, so the reader draws the heading as a node and leaves the body
 * out while it is folded. The document stays one tree, so a reference, a
 * definition or a footnote resolves across its sections.
 */
export function remarkSections() {
  return (tree: Root) => {
    const children: RootContent[] = []
    let open: { readonly body: RootContent[] } | null = null
    let at = 0
    for (const node of tree.children) {
      if (!opensSection(node)) {
        if (open === null) children.push(node)
        else open.body.push(node)
        continue
      }
      const body: RootContent[] = []
      open = { body }
      children.push({
        type: 'block',
        data: { hName: 'section', hProperties: { dataSectionAt: String(at) } },
        children: [node, { type: 'block', data: { hName: 'div', hProperties: { dataSectionBody: '' } }, children: body }],
      })
      at += 1
    }
    tree.children = children
  }
}
