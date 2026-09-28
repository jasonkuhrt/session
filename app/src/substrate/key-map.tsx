import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Kbd } from '../components/ui/kbd'
import { cn } from '../lib/utils'
import { Keys } from './modes'
import type { Seam } from './seam'

/**
 * The key map: every registered command, one line each, its name, what it
 * does, its keys as key caps, and its clicks, by scope, the scopes on the
 * focus path first, nearest first, the nearest marked current. Each scope is
 * headed by its name in small uppercase letters, with a rule between its
 * lines. A command that cannot run at the focus is dim. It lists the registry
 * as it is, so registering a command lists it.
 */
export function KeyMap({ seam, current, runnable, focusName, onClose }: {
  readonly seam: Seam
  /** The scopes on the focus path, nearest first. */
  readonly current: readonly string[]
  readonly runnable: ReadonlySet<string>
  readonly focusName: string
  readonly onClose: () => void
}) {
  const onPath = [...new Set(current)]
  const scopes = [...onPath, ...seam.scopes.filter((scope) => !onPath.includes(scope))]
    .filter((scope) => seam.registry.some((command) => command.scope === scope))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="top-[8vh] max-h-[84vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Keys at {focusName}</DialogTitle>
          <DialogDescription>Every command, by scope, the current one first. <Kbd>?</Kbd> or <Kbd>Esc</Kbd> closes.</DialogDescription>
        </DialogHeader>
        <div data-keymap-body="" className="min-h-0 overflow-y-auto px-4 pb-4">
          {scopes.map((scope, index) => (
            <section key={scope} aria-label={seam.scopeName(scope)}>
              <h3 className="pt-4 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {seam.scopeName(scope)}
                {index === 0 ? <span className="ml-2 font-normal text-primary normal-case">current</span> : null}
              </h3>
              <ul>
                {seam.registry.filter((command) => command.scope === scope).map((command) => (
                  <li
                    key={command.id}
                    className={cn(
                      'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 border-t py-1.5 text-sm sm:grid-cols-[13rem_minmax(0,1fr)_auto]',
                      // Its words are dim, not the rule above them, which every line has.
                      !runnable.has(command.id) && '*:opacity-35',
                    )}
                  >
                    <span className="text-foreground">{command.name}</span>
                    <span className="col-span-full row-start-2 text-xs text-muted-foreground sm:col-span-1 sm:row-start-auto">
                      {command.summary}
                      {command.clicks.length === 0 ? null : ` Click ${command.clicks.map((click) => click.on).join(' or ')}.`}
                    </span>
                    <span className="col-start-2 row-start-1 sm:col-start-3"><Keys keys={command.keys} /></span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
