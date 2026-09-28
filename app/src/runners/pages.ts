import type { Runner } from '../substrate/seam'
import type { RunnerContext } from './shared'
import { copy, nodeAt } from './shared'

/** What a page's entries do: Enter on a section or an entry, and a copy of its file or the page's. */
export function pageRunners(context: RunnerContext): Record<string, Runner> {
  const { input } = context
  return {
    'section.enter': {
      when: () => (input.page === null ? 'Nothing here opens or folds' : true),
      run: async (target, surface) => {
        const node = nodeAt({ target, kind: 'section' })
        if (node !== null) await input.page?.enter(node.at, surface)
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
