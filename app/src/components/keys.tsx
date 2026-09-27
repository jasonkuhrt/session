import { useHotkeyRegistrations, useHotkeys, type HotkeyRegistrationView, type UseHotkeyDefinition } from '@tanstack/react-hotkeys'
import { Keyboard } from 'lucide-react'
import * as React from 'react'

import { keyLabel, keyOrder, keys, type KeyName, type KeyScope } from '../lib/keys'
import { canStep, type Step, stepped } from '../lib/selection'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Kbd, KbdGroup } from './ui/kbd'

/**
 * A page's keys: the scope they register in, the page's own element, inside
 * which the keyboard is on the page, and whether a drag holds them.
 */
type Page = {
  readonly scope: Exclude<KeyScope, 'dialog'>
  readonly root: React.RefObject<HTMLDivElement | null>
  readonly held: boolean
}

const PageContext = React.createContext<Page | null>(null)

/**
 * One binding: the name of what it does, which gives its keys, the sentence
 * the legend shows for it, and the doing, which answers whether it acted.
 */
export type Binding = {
  readonly name: KeyName
  readonly sentence: string
  readonly act: (event: KeyboardEvent) => boolean
}

/**
 * Whether a key was pressed on the page rather than in something drawn over
 * it: with nothing focused, or with the focus inside the page's element. A
 * dialog, a menu or a list open over the page is drawn outside that element,
 * so the page's keys leave whatever holds the focus there to its own keys.
 */
const onPage = (event: KeyboardEvent, root: HTMLElement | null) => {
  const { target } = event
  return target === document.body || target === document.documentElement ||
    (root !== null && target instanceof Node && root.contains(target))
}

/**
 * The keys that take one step and may be held down to take several. Every
 * other key acts on the first keydown of a press and ignores the repeats a
 * held key sends, which the event itself says, so a card that moves and draws
 * its keys again under a held bracket does not move twice.
 */
const steps: ReadonlySet<KeyName> = new Set(['next', 'previous', 'left', 'right', 'previousSection', 'nextSection'])

/** Whether a keydown is a held key's repeat, which only a step acts on. */
const repeatOf = (event: KeyboardEvent, name: KeyName) => event.repeat && !steps.has(name)

/**
 * How every binding meets the keyboard: never while a field has the focus,
 * and taking a key from the browser only when it acts, so a key that does
 * nothing does what it always did. A key two components offer at once is the
 * one offered last: when the selection moves, the card it reaches registers
 * its keys in the same commit as the card it left gives them up, in whichever
 * order the page draws the two.
 */
const keyOptions = { ignoreInputs: true, preventDefault: false, stopPropagation: false, conflictBehavior: 'replace' } as const

/**
 * Registers bindings in the page's scope for as long as the component that
 * offers them draws and passes them, which is how a binding the page cannot
 * offer stays out of the registry and the legend. A binding acts only while
 * the keyboard is on the page and no drag holds it. Outside a page that
 * answers to keys it registers nothing.
 */
export function useBindings(bindings: ReadonlyArray<Binding>) {
  const page = React.use(PageContext)
  const definitions: UseHotkeyDefinition[] = page === null ? [] : bindings.flatMap((binding) =>
    keys[binding.name].map((hotkey) => ({
      hotkey,
      callback: (event: KeyboardEvent) => {
        if (repeatOf(event, binding.name) || !onPage(event, page.root.current)) return
        if (binding.act(event)) event.preventDefault()
      },
      options: {
        enabled: !page.held,
        meta: { name: binding.name, description: binding.sentence, scope: page.scope },
      },
    }))
  )
  useHotkeys(definitions, keyOptions)
}

/**
 * Brings the selection into view once the page has drawn it where it now
 * stands. Only a key calls it, a step or a bracket's move once it has landed,
 * so a read that moves cards around never scrolls the page under the reader.
 */
export function useReveal() {
  const page = React.use(PageContext)
  return React.useCallback(() => {
    requestAnimationFrame(() => {
      page?.root.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }, [page])
}

/** Each step of the selection as a page offers it: the name of its keys, and what it does in the page's words. */
export type StepKeys = Readonly<Record<Step, { readonly name: KeyName; readonly sentence: string }>>

const allSteps: ReadonlyArray<Step> = ['next', 'previous', 'left', 'right']

/** Takes the keyboard back from a control that holds it, so the keys that follow act on the selection. */
const releaseFocus = () => {
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused !== document.body) focused.blur()
}

/**
 * The steps of a page's selection over its columns, each registered while
 * it has somewhere to go. A step that moves the selection takes the keyboard
 * from any control that had it, so the next Enter opens the selection rather
 * than pressing that control, and brings the selection into view; a step with
 * nowhere further to go does nothing, and an arrow then scrolls the page as
 * it always did.
 */
export function SelectionKeys({ columns, selected, onSelect, steps: offered }: {
  columns: ReadonlyArray<ReadonlyArray<string>>
  selected: string | null
  onSelect: (id: string) => void
  steps: StepKeys
}) {
  const reveal = useReveal()
  useBindings(allSteps.filter((step) => canStep({ columns, step })).map((step) => ({
    name: offered[step].name,
    sentence: offered[step].sentence,
    act: () => {
      const reached = stepped({ columns, selected, step })
      if (reached === null || reached === selected) return false
      releaseFocus()
      onSelect(reached)
      reveal()
      return true
    },
  })))
  return null
}

/** What Escape does in every dialog the board draws. */
const closeSentence = 'Close this dialog.'

/**
 * A dialog's keys while it is open: Escape closes it. The stock dialog closes
 * on Escape by itself; the registration is what puts the key in the registry,
 * so it is shown, and it closes the dialog the same way.
 */
export function useDialogKeys({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const definitions: UseHotkeyDefinition[] = open
    ? keys.close.map((hotkey) => ({
      hotkey,
      callback: (event: KeyboardEvent) => {
        if (!repeatOf(event, 'close')) onClose()
      },
      options: { meta: { name: 'close', description: closeSentence, scope: 'dialog' } },
    }))
    : []
  useHotkeys(definitions, keyOptions)
}

/** What `?` does on every page that answers to keys. */
const legendSentence = 'Show the keys this page answers to.'

/**
 * A page that answers to keys: its element, the scope its bindings register
 * in, and the legend `?` opens over it. While `held`, as while a card is
 * dragged, none of its keys acts.
 */
export function KeyPage({ scope, held, className, children }: {
  scope: Page['scope']
  held: boolean
  className?: string
  children: React.ReactNode
}) {
  const root = React.useRef<HTMLDivElement>(null)
  const page = React.useMemo(() => ({ scope, root, held }), [scope, held])
  const [open, setOpen] = React.useState(false)
  return (
    <PageContext value={page}>
      <div ref={root} className={className}>{children}</div>
      <LegendKey onOpen={() => setOpen(true)} />
      <KeyLegend scope={scope} open={open} onOpenChange={setOpen} />
    </PageContext>
  )
}

/** `?`, in the page's scope. */
function LegendKey({ onOpen }: { onOpen: () => void }) {
  useBindings([{
    name: 'legend',
    sentence: legendSentence,
    act: () => {
      onOpen()
      return true
    },
  }])
  return null
}

/** One row of the legend: a binding's keys, as they are drawn, and its sentence. */
type LegendRow = { readonly name: KeyName; readonly sentence: string; readonly keys: readonly string[] }

const isKeyName = (name: string | undefined): name is KeyName => keyOrder.some((known) => known === name)

/**
 * The legend's rows for a page's scope, read from the registry: the page's
 * bindings and the open dialog's, one row per binding with every key that
 * presses it, in the order the keys are named.
 */
function rowsOf(registrations: ReadonlyArray<HotkeyRegistrationView>, scope: Page['scope']): readonly LegendRow[] {
  const rows = new Map<KeyName, LegendRow>()
  for (const { hotkey, options } of registrations) {
    const meta = options.meta
    if (meta === undefined || (meta.scope !== scope && meta.scope !== 'dialog') || !isKeyName(meta.name)) continue
    const known = rows.get(meta.name)
    const label = keyLabel(hotkey)
    rows.set(meta.name, {
      name: meta.name,
      sentence: known?.sentence ?? meta.description ?? '',
      keys: known === undefined ? [label] : [...known.keys, label],
    })
  }
  return keyOrder.flatMap((name) => rows.get(name) ?? [])
}

const sameRows = (left: readonly LegendRow[], right: readonly LegendRow[]) =>
  JSON.stringify(left) === JSON.stringify(right)

/**
 * The legend: every key the page answers to right now, with the sentence of
 * what it does, generated from the registry for the page's scope and the
 * dialog's own. It is the stock dialog, so Escape closes it as it closes any.
 */
function KeyLegend({ scope, open, onOpenChange }: {
  scope: Page['scope']
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  useDialogKeys({ open, onClose: () => onOpenChange(false) })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <Keyboard className="size-4 text-muted-foreground" />
          <DialogTitle>{scope === 'board' ? 'Keys on this board' : 'Keys on the index'}</DialogTitle>
          <DialogDescription>What each key does here. None of them acts while you type in a field.</DialogDescription>
        </DialogHeader>
        <LegendRows scope={scope} open={open} />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The rows, as the registry has them while the legend is open. Closing it
 * takes its own Escape out of the registry, so the rows it closes with are
 * the ones it showed.
 */
function LegendRows({ scope, open }: { scope: Page['scope']; open: boolean }) {
  const { hotkeys } = useHotkeyRegistrations()
  const live = rowsOf(hotkeys, scope)
  const [shown, setShown] = React.useState(live)
  if (open && !sameRows(shown, live)) setShown(live)
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5">
      {shown.map((row) => (
        <React.Fragment key={row.name}>
          <dt>
            <KbdGroup>
              {row.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
            </KbdGroup>
          </dt>
          <dd className="text-pretty">{row.sentence}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}
