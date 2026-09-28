import * as React from 'react'

import { useKeys } from './bind'
import { steps, substrateIds } from './commands'
import { DetailLine } from './detail-line'
import { KeyMap } from './key-map'
import type { Mode, PaletteEntry } from './modes'
import { entriesOf, NameMode, Palette, SettingsMode } from './modes'
import type { Drawn } from './motion'
import { into, outOf, ownWhen, peerOf, settled } from './motion'
import type { Direction } from './moves'
import { leafOf, pathKey, recall, remember } from './path'
import { PathLine } from './path-line'
import type { Key } from './registry'
import { keptByPage, linkAt, resolveClick, resolveKey, runnableAt, targetsOf } from './resolve'
import { useRoot } from './root'
import type { Path, Seam, Target } from './seam'
import { ApiContext, SurfaceContext } from './surface-context'
import { useAddressedFocus, useStableApi, useViewClicks } from './surface-hooks'

/**
 * A view's surface: the path line at the top, the view between, and the
 * detail line at the bottom, with the palette, the key map and the name
 * dialog over them, and every key the registry names bound while it is
 * drawn. The focus is the one thing it moves: the seam says where it is, as
 * the address and the reads have it, and a move within the view writes it
 * back into the address in place of the current entry, while a move to
 * another view pushes one, so the browser's back is the jumplist.
 */

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`

const scrollKeyMap = (by: 1 | -1) => document.querySelector('[data-keymap-body]')?.scrollBy({ top: by * 80 })

/** What a failed command or choice says, in its own words when it has some. */
const failed = (fallback: string) => (error: unknown) => (error instanceof Error ? error.message : fallback)

export function Surface({ seam, children }: { readonly seam: Seam; readonly children: React.ReactNode }) {
  const { memory, marks, setMarks, flashed, flash, hinted, heard } = useRoot()
  const drawn = React.useRef(new Map<string, Drawn>())
  const [mode, setMode] = React.useState<Mode | null>(null)
  const { focus, write, waiting } = useAddressedFocus(seam)
  const focusKey = pathKey(focus)
  const view = seam.viewOf(focus)

  const place = (path: Path, options: { readonly replace: boolean }) => {
    const target = seam.normalize(path)
    remember({ memory, path: target })
    flash(null)
    return write(target, options)
  }
  const setFocus = (path: Path) => void place(path, { replace: false })

  // The focus is remembered wherever it lands, a view's first focus included,
  // and a focus the view does not draw, once it has drawn what it read, is
  // put in the address where the view draws it.
  React.useEffect(() => {
    remember({ memory, path: seam.focus })
    if (!seam.ready || waiting()) return
    const settledAt = settled({ seam, memory, drawn: drawn.current, focus: seam.focus })
    if (settledAt === null) return
    const next = seam.normalize(settledAt)
    remember({ memory, path: next })
    void seam.go(next, { replace: true })
  })

  const moveTo = (answer: Path | string) => (typeof answer === 'string' ? flash(answer) : setFocus(answer))
  const move = (direction: Direction) => moveTo(peerOf({ drawn: drawn.current, focusKey, direction }))
  // Asked only from a key or a command, never while the surface draws, since
  // a move's answer reads the geometry the view has drawn.
  const canOwn = (id: string) => ownWhen({ seam, memory, drawn, focus, moded: mode !== null })(id)
  const runnable = () => runnableAt({ seam, focus, own: canOwn })

  const toggleMark = () => {
    const markable = seam.markable(focus)
    if (markable !== true) {
      flash(markable)
      return
    }
    const id = leafOf(focus)
    setMarks((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const moveHighlight = (by: 1 | -1) =>
    setMode((current) => (current?.kind === 'palette' || current?.kind === 'choose' ? { ...current, highlight: current.highlight + by } : current))

  /** The child last focused under a node, from the focus memory alone. */
  const recallOf = React.useCallback((parent: Path, kids: readonly string[]) => recall({ memory, parent, children: kids }), [memory])

  const api = useStableApi({
    focus,
    setFocus,
    relocate: (path) => place(path, { replace: true }),
    flash,
    marks,
    clearMarks: () => setMarks(() => new Set()),
    unmark: (ids) => {
      const leaving = new Set(ids)
      setMarks((current) => new Set([...current].filter((id) => !leaving.has(id))))
    },
    askName: (request) => setMode({ kind: 'name', request, value: request.value, error: null, busy: false }),
    choose: ({ prompt, choices }) => setMode({ kind: 'choose', prompt, choices, query: '', highlight: 0 }),
    openSettings: () => setMode({ kind: 'settings' }),
    recall: recallOf,
  })

  const entries = (): readonly PaletteEntry[] =>
    mode?.kind === 'palette' || mode?.kind === 'choose'
      ? entriesOf({ mode, seam })
      : []

  const takeEntry = (entry: PaletteEntry | undefined) => {
    if (entry === undefined) return
    setMode(null)
    if (entry.kind === 'command') runCommand(entry.id, entry.target)
    else if (entry.kind === 'go') setFocus(entry.path)
    else void Promise.resolve(entry.choice.run()).catch((error: unknown) => flash(failed('The choice failed')(error)))
  }

  const confirmName = async () => {
    if (mode?.kind !== 'name' || mode.busy) return
    const name = mode.value.trim()
    if (name === '') {
      setMode({ ...mode, error: 'A name is needed.' })
      return
    }
    setMode({ ...mode, busy: true, error: null })
    const refused = await mode.request.confirm(name)
    setMode((current) => (current?.kind === 'name' ? (refused === null ? null : { ...current, busy: false, error: refused }) : current))
  }

  const leave = () => {
    if (mode !== null) {
      setMode(null)
      return
    }
    if (marks.size === 0) return
    const count = marks.size
    setMarks(() => new Set())
    flash(`Cleared ${plural(count, 'mark')}`)
  }

  const vertical = (by: 1 | -1) => {
    if (mode === null) move(by === 1 ? 'down' : 'up')
    else if (mode.kind === 'keymap') scrollKeyMap(by)
    else moveHighlight(by)
  }

  const substrateRuns: Readonly<Record<string, () => void>> = {
    [substrateIds.palette]: () => setMode({ kind: 'palette', gotoOnly: false, query: '', highlight: 0, runnable: runnable() }),
    [substrateIds.keyMap]: () => {
      const bright = new Set(runnable().map((entry) => entry.id))
      setMode((current) => (current?.kind === 'keymap' ? null : { kind: 'keymap', runnable: bright }))
    },
    [substrateIds.leave]: leave,
    [substrateIds.left]: () => move('left'),
    [substrateIds.right]: () => move('right'),
    [substrateIds.down]: () => vertical(1),
    [substrateIds.up]: () => vertical(-1),
    [substrateIds.in]: () => moveTo(into({ seam, memory, focus })),
    [substrateIds.out]: () => moveTo(outOf({ seam, focus })),
    [substrateIds.mark]: toggleMark,
    [substrateIds.focus]: () => null,
    [substrateIds.goTo]: () => setMode({ kind: 'palette', gotoOnly: true, query: '', highlight: 0, runnable: [] }),
    [substrateIds.next]: () => moveHighlight(1),
    [substrateIds.previous]: () => moveHighlight(-1),
    [substrateIds.choose]: () => {
      const listed = entries()
      const highlight = mode?.kind === 'palette' || mode?.kind === 'choose' ? mode.highlight : 0
      takeEntry(listed[((highlight % listed.length) + listed.length) % listed.length])
    },
    [substrateIds.confirm]: () => void confirmName(),
  }

  function runCommand(id: string, target: Target) {
    const own = substrateRuns[id]
    if (own !== undefined) {
      own()
      return
    }
    const runner = seam.runners[id]
    if (runner !== undefined) void Promise.resolve(runner.run(target, api)).catch((error: unknown) => flash(failed('The command failed')(error)))
  }

  /** Runs what a key resolves to, or says why it cannot; answers whether it did either. */
  const act = (key: Key, repeat: boolean) => {
    const hit = resolveKey({ seam, key, focus, mode, own: canOwn })
    if (hit === null) return false
    if (repeat && !steps.has(hit.command.id)) return true
    if (hit.refused === null) runCommand(hit.command.id, hit.target)
    else flash(hit.refused)
    return true
  }

  useKeys({
    keys: seam.registry.flatMap((command) => command.keys),
    press: (key, event) => {
      heard()
      if (seam.held || keptByPage({ event, mode })) return false
      return act(key, event.repeat)
    },
  })

  /**
   * A click on a node puts the focus on it and runs its own Enter at once,
   * saying why when that cannot run; a node that binds none, or that holds
   * other nodes and was clicked on its own space, only takes the focus.
   */
  const clicked = (path: Path, node: Drawn) => {
    setFocus(path)
    if (node.holds) return
    const hit = resolveClick({ seam, path, own: ownWhen({ seam, memory, drawn, focus: path, moded: false }) })
    if (hit === null) return
    if (hit.refused === null) runCommand(hit.command.id, hit.target)
    else flash(hit.refused)
  }
  const main = React.useRef<HTMLElement>(null)
  useViewClicks({ view: main, drawn, held: seam.held, clicked })

  const linkOf = React.useCallback((path: Path) => linkAt({ seam, path, recall: recallOf }), [seam, recallOf])
  /**
   * Where a step of the path line's link goes: where a click on it moves the
   * focus, its node, and from All the child last focused there, as a move
   * within this view when this view draws it.
   */
  const stepLink = (index: number) => {
    const inside = index > 0 ? focus.slice(0, index + 1) : into({ seam, memory, focus: [seam.root] })
    const step = seam.normalize(typeof inside === 'string' ? [seam.root] : inside)
    return seam.link(step, { replace: seam.viewOf(step) === view })
  }

  const register = React.useCallback((key: string, node: Drawn | null) => {
    if (node === null) drawn.current.delete(key)
    else drawn.current.set(key, node)
  }, [])
  const { scopeOf, Link } = seam
  const context = React.useMemo(() => ({ focusKey, marks, scopeOf, register, linkOf, Link }), [focusKey, marks, scopeOf, register, linkOf, Link])

  const modeWord = mode === null ? null : { palette: 'palette', choose: 'choose', name: 'name', keymap: 'keys', settings: 'settings' }[mode.kind]
  const modes = [...(marks.size > 0 ? [`${marks.size} marked`] : []), ...(modeWord === null ? [] : [modeWord])]
  const targets = targetsOf({ seam, path: focus })

  return (
    <ApiContext value={api}>
      <SurfaceContext value={context}>
        <div className="flex min-h-dvh flex-col bg-background text-foreground">
          <PathLine
            seam={seam}
            focus={focus}
            view={view}
            marks={marks}
            linkOf={stepLink}
            onStep={(index) => {
              if (index > 0) setFocus(focus.slice(0, index + 1))
              else moveTo(into({ seam, memory, focus: [seam.root] }))
            }}
          />
          <main ref={main} className="min-w-0 flex-1 px-4 pt-5 pb-16">{children}</main>
          <DetailLine facts={seam.facts(focus)} flashed={flashed ?? (hinted ? 'Press ? for every key, ; for the palette.' : null)} modes={modes} tip={seam.tip} />
        </div>
        {mode?.kind === 'palette' || mode?.kind === 'choose'
          ? (
            <Palette
              mode={mode}
              entries={entries()}
              onQuery={(query) => setMode({ ...mode, query, highlight: 0 })}
              onTake={takeEntry}
              onHighlight={(highlight) => setMode({ ...mode, highlight })}
              onClose={() => setMode(null)}
            />
          )
          : null}
        {mode?.kind === 'keymap'
          ? (
            <KeyMap
              seam={seam}
              current={targets.map((target) => target.scope)}
              runnable={mode.runnable}
              focusName={seam.targetName(targets[0] ?? { scope: seam.scopes[0] ?? '', id: seam.root, path: [seam.root] })}
              onClose={() => setMode(null)}
            />
          )
          : null}
        {mode?.kind === 'name'
          ? <NameMode mode={mode} onValue={(value) => setMode({ ...mode, value, error: null })} onConfirm={() => void confirmName()} onClose={() => setMode(null)} />
          : null}
        {mode?.kind === 'settings' ? <SettingsMode onClose={() => setMode(null)}>{seam.settings}</SettingsMode> : null}
      </SurfaceContext>
    </ApiContext>
  )
}
