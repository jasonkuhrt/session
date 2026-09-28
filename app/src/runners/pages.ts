import type { Runner, Target } from '../substrate/seam'
import type { RunnerContext } from './shared'
import { copy, nodeAt } from './shared'

/** What a page's entries do: Enter on a section or an entry, and a copy of its file or the page's. */
export function pageRunners(context: RunnerContext): Record<string, Runner> {
  const { input } = context
  /** The page an entry's Enter opens, from where the entry is; null for one whose Enter stays on the page. */
  const opened = (target: Target) => {
    const node = nodeAt({ target, kind: 'section' })
    return node === null ? null : input.page?.opens?.(node.at, target.path) ?? null
  }
  return {
    'section.enter': {
      when: () => (input.page === null ? 'Nothing here opens or folds' : true),
      to: opened,
      run: async (target, surface) => {
        const node = nodeAt({ target, kind: 'section' })
        if (node === null) return
        const page = opened(target)
        if (page === null) await input.page?.enter?.(node.at, surface)
        else surface.setFocus(page)
      },
    },
    'section.copyPath': {
      when: (target) => {
        const node = nodeAt({ target, kind: 'section' })
        return node !== null && input.page?.pathOf(node.at) !== null && input.page?.pathOf(node.at) !== undefined ? true : 'A section is part of its file: copy the file’s path'
      },
      run: async (target, surface) => {
        const node = nodeAt({ target, kind: 'section' })
        const path = node === null ? null : input.page?.pathOf(node.at) ?? null
        if (path !== null) await copy({ text: path, surface, what: 'the path' })
      },
    },
    'record.copyPath': {
      when: () => (input.page?.path === null || input.page?.path === undefined ? 'The page’s place has not been read' : true),
      run: async (_target, surface) => {
        const path = input.page?.path
        if (path !== null && path !== undefined) await copy({ text: path, surface, what: 'the path' })
      },
    },
  }
}
