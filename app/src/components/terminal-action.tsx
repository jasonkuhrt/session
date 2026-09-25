import { SquareTerminal } from 'lucide-react'
import * as React from 'react'

import { DaemonApi } from '../lib/api'
import { Tip } from './tip'
import { Button } from './ui/button'

/** What the control does, said where it is drawn. */
const terminalMeaning =
  'Open a terminal here in cmux: the cmux workspace already in this worktree comes to the front, and otherwise a new one opens in it.'

/**
 * Whether this page can offer a terminal. The daemon runs cmux from its own
 * PATH and says whether cmux is there; it is read once, when the page loads.
 * Until that answer arrives, and if it never does, there is no control to
 * draw, and the page's own read is what says the daemon cannot be reached.
 */
export function useTerminalAvailable() {
  const [available, setAvailable] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const capabilities = await DaemonApi.capabilities(controller.signal)
        if (!controller.signal.aborted) setAvailable(capabilities.terminal)
      } catch {
        // Nothing to draw, and nothing to say twice.
      }
    }
    void load()
    return () => controller.abort()
  }, [])
  return available
}

/**
 * A terminal in one worktree, one click away. The daemon brings forward the
 * cmux workspace already there or opens one, and when cmux refuses, its own
 * line stays beside the control until the next click.
 */
export function TerminalAction({ path, name, size }: {
  path: string
  /** The worktree's name, so every control of this kind on a page says which worktree it opens. */
  name: string
  size: 'icon-sm' | 'icon-xs'
}) {
  const [pending, setPending] = React.useState(false)
  const [refusal, setRefusal] = React.useState<string | null>(null)
  const open = async () => {
    setPending(true)
    try {
      const result = await DaemonApi.terminal(path)
      setRefusal(result.ok ? null : result.line)
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : 'The terminal request failed')
    } finally {
      setPending(false)
    }
  }
  return (
    <span className="flex items-center gap-2">
      <Tip
        meaning={terminalMeaning}
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label={`Open a terminal in ${name} in cmux`}
            disabled={pending}
            onClick={() => void open()}
          />
        }
      >
        <SquareTerminal />
      </Tip>
      {refusal === null ? null : <span className="text-xs text-destructive wrap-anywhere">{refusal}</span>}
    </span>
  )
}
