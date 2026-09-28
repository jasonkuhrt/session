import * as React from 'react'

/**
 * Which sections and entries are folded to their headings, for the whole
 * document, whichever page is drawn: a page's section is folded when it was
 * toggled away from how it starts, and an item's Evidence starts folded, the
 * long tail under its argument. Nothing is kept beyond the document.
 */
type Folds = {
  /** Whether a section is folded, by its page and where it is on it, starting folded or not. */
  readonly folded: (key: string, startsFolded: boolean) => boolean
  readonly toggle: (key: string) => void
}

const FoldsContext = React.createContext<Folds | null>(null)

export function FoldsRoot({ children }: { readonly children: React.ReactNode }) {
  const [toggled, setToggled] = React.useState<ReadonlySet<string>>(() => new Set())
  const folds = React.useMemo<Folds>(() => ({
    folded: (key, startsFolded) => toggled.has(key) !== startsFolded,
    toggle: (key) =>
      setToggled((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
  }), [toggled])
  return <FoldsContext value={folds}>{children}</FoldsContext>
}

export function useFolds(): Folds {
  const folds = React.use(FoldsContext)
  if (folds === null) throw new Error('A page folds its sections inside the folds’ root.')
  return folds
}
