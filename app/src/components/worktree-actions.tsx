import { type LucideIcon, SquareCode, SquareTerminal } from 'lucide-react'
import * as React from 'react'

import type { DaemonCapabilities, OpenResult } from '../../contract'
import { DaemonApi } from '../lib/api'
import { Tip } from './tip'
import { Button } from './ui/button'

/** What each control does, said where it is drawn. */
const terminalMeaning =
  'Open a terminal here in cmux: the cmux workspace already in this worktree comes to the front, and otherwise a new one opens in it.'
const zedMeaning =
  'Open this worktree in Zed: the Zed window already on it comes to the front, and otherwise a new window opens on it. A window on another folder is left as it is.'

const noCapabilities: DaemonCapabilities = { terminal: false, zed: false }

/**
 * What this page can offer a worktree: a terminal, when the daemon can run
 * cmux, and Zed, when it can run zed. The daemon runs both from its own PATH
 * and says whether each is there; it is read once, when the page loads. Until
 * that answer arrives, and if it never does, there is no control to draw, and
 * the page's own read is what says the daemon cannot be reached.
 */
export function useCapabilities() {
  const [capabilities, setCapabilities] = React.useState(noCapabilities)
  React.useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const answer = await DaemonApi.capabilities(controller.signal)
        if (!controller.signal.aborted) setCapabilities({ terminal: answer.terminal, zed: answer.zed })
      } catch {
        // Nothing to draw, and nothing to say twice.
      }
    }
    void load()
    return () => controller.abort()
  }, [])
  return capabilities
}

type ActionProps = {
  path: string
  /** The worktree's name, so every control of this kind on a page says which worktree it opens. */
  name: string
  size: 'icon-sm' | 'icon-xs'
}

/** A terminal in one worktree, one click away, through cmux. */
export function TerminalAction(props: ActionProps) {
  return (
    <OpenAction
      {...props}
      icon={SquareTerminal}
      meaning={terminalMeaning}
      label={`Open a terminal in ${props.name} in cmux`}
      failed="The terminal request failed"
      open={DaemonApi.terminal}
    />
  )
}

/** One worktree in Zed, one click away, in the window already on it or a new one. */
export function ZedAction(props: ActionProps) {
  return (
    <OpenAction
      {...props}
      icon={SquareCode}
      meaning={zedMeaning}
      label={`Open ${props.name} in Zed`}
      failed="The Zed request failed"
      open={DaemonApi.zed}
    />
  )
}

/**
 * A worktree opened in a tool by the daemon. When the tool refuses, its own
 * line stays beside the control until the next click.
 */
function OpenAction({ path, size, icon: Icon, meaning, label, failed, open }: ActionProps & {
  icon: LucideIcon
  meaning: string
  label: string
  /** What to say when the daemon itself could not be asked. */
  failed: string
  open: (path: string) => Promise<OpenResult>
}) {
  const [pending, setPending] = React.useState(false)
  const [refusal, setRefusal] = React.useState<string | null>(null)
  const run = async () => {
    setPending(true)
    try {
      const result = await open(path)
      setRefusal(result.ok ? null : result.line)
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : failed)
    } finally {
      setPending(false)
    }
  }
  return (
    <span className="flex items-center gap-2">
      <Tip
        meaning={meaning}
        render={<Button variant="ghost" size={size} aria-label={label} disabled={pending} onClick={() => void run()} />}
      >
        <Icon />
      </Tip>
      {refusal === null ? null : <span className="text-xs text-destructive wrap-anywhere">{refusal}</span>}
    </span>
  )
}
