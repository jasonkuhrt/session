import type { Parent, Root, RootContent } from 'mdast'

/**
 * A block the reader draws as the element its data names, holding its
 * children as they are: how the Evidence panel, its summary and its body are
 * carried in the tree.
 */
interface Block extends Parent {
  type: 'block'
}

declare module 'mdast' {
  interface RootContentMap {
    block: Block
  }
}

/** Whether a node is the heading an item's Evidence starts under: `### Evidence`, in any case. */
const opensEvidence = (node: RootContent) => {
  if (node.type !== 'heading' || node.depth !== 3) return false
  const [words, ...rest] = node.children
  return rest.length === 0 && words?.type === 'text' && words.value.trim().toLowerCase() === 'evidence'
}

/**
 * The remark plugin that collapses an item's Evidence, the long tail under its
 * `### Evidence` heading, into a panel that opens on its summary. The heading
 * is found as a heading of the document, never as a line, so one inside a
 * fence is code, and the panel stays in the one tree, so a reference, a
 * definition or a footnote resolves across it. A heading with nothing after it
 * is dropped, and the footnotes stay at the document's foot, after the panel.
 */
export function remarkEvidence() {
  return (tree: Root) => {
    const at = tree.children.findIndex(opensEvidence)
    if (at === -1) return
    const evidence = tree.children.slice(at + 1)
    const panel: Block = {
      type: 'block',
      data: { hName: 'details', hProperties: { className: ['evidence-panel'] } },
      children: [
        { type: 'block', data: { hName: 'summary' }, children: [{ type: 'text', value: 'Evidence' }] },
        { type: 'block', data: { hName: 'div', hProperties: { className: ['pt-4'] } }, children: evidence },
      ],
    }
    tree.children.splice(at, tree.children.length - at, ...(evidence.length === 0 ? [] : [panel]))
  }
}
