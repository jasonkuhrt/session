import * as React from 'react'

import type { FocusResult } from '../../contract'
import type { Action } from '../lib/agents'
import { actionKey } from '../lib/agents'
import { openOnceOnClick } from '../lib/open-once'
import { ActionIcon } from './agent-marks'
import { useCopy } from './copyable'
import { Tip } from './tip'
import { Button } from './ui/button'

/**
 * One session's actions, as the board's strip renders them: the shared list as
 * icon buttons closing the row, right after what it says about the session,
 * each named for what it does and carrying the sentence that says so as its
 * tip. The index renders the same list as a menu, with the names written out,
 * so the two surfaces can never offer different things or call them different
 * names.
 */

/** A value someone is going to paste somewhere else; the icon reports what happened to the copy. */
function CopyAction({ action }: { action: Extract<Action, { kind: 'copy' }> }) {
  const [state, copy] = useCopy()
  return (
    <Tip
      meaning={action.meaning}
      render={
        <Button
          variant="outline"
          size="icon-xs"
          aria-label={`${action.label}: ${action.value}`}
          onClick={() => void copy(action.value)}
        />
      }
    >
      <ActionIcon action={action} copy={state} />
    </Tip>
  )
}

/** Asking the daemon to bring a terminal forward; a refusal belongs to the row. */
function FocusAction({ action, name, onFocus, onFailure }: {
  action: Extract<Action, { kind: 'focus' }>
  name: string
  onFocus: (pid: number) => Promise<FocusResult>
  onFailure: (reason: string | null) => void
}) {
  const [pending, setPending] = React.useState(false)
  return (
    <Tip
      meaning={action.meaning}
      render={
        <Button
          variant="outline"
          size="icon-xs"
          aria-label={`${action.label}: ${name}`}
          disabled={pending}
          onClick={() => {
            void (async () => {
              setPending(true)
              try {
                const result = await onFocus(action.pid)
                onFailure(result.ok ? null : result.reason)
              } finally {
                setPending(false)
              }
            })()
          }}
        />
      }
    >
      <ActionIcon action={action} />
    </Tip>
  )
}

/** The app this thread already lives in, handed the thread once. */
function LinkAction({ action, name }: {
  action: Extract<Action, { kind: 'link' }>
  name: string
}) {
  return (
    <Tip
      meaning={action.meaning}
      render={
        <Button
          variant="outline"
          size="icon-xs"
          nativeButton={false}
          render={
            <a
              aria-label={`${action.label}: ${name}`}
              href={action.href}
              onClick={openOnceOnClick(action.href)}
            />
          }
        />
      }
    >
      <ActionIcon action={action} />
    </Tip>
  )
}

export function Actions({ actions, name, onFocus, onFailure }: {
  actions: readonly Action[]
  name: string
  onFocus: (pid: number) => Promise<FocusResult>
  onFailure: (reason: string | null) => void
}) {
  return (
    <>
      {actions.map((action) =>
        action.kind === 'copy'
          ? <CopyAction key={actionKey(action)} action={action} />
          : action.kind === 'link'
          ? <LinkAction key={actionKey(action)} action={action} name={name} />
          : (
            <FocusAction
              key={actionKey(action)}
              action={action}
              name={name}
              onFocus={onFocus}
              onFailure={onFailure}
            />
          )
      )}
    </>
  )
}
