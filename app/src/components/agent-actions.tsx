import * as React from 'react'

import type { FocusResult } from '../../contract'
import type { Action } from '../lib/agents'
import { actionKey } from '../lib/agents'
import { openOnceOnClick } from '../lib/open-once'
import { ActionIcon } from './agent-marks'
import { copyLabel, useCopy } from './copyable'
import { Tip } from './tip'
import { Button } from './ui/button'

/**
 * One session's actions, as the board's strip renders them: the shared list as
 * buttons, each carrying the sentence that says what it does. The index
 * renders the same list as a menu, so the two surfaces can never offer
 * different things or call them different names.
 */

/** A value someone is going to paste somewhere else. */
function CopyAction({ action }: { action: Extract<Action, { kind: 'copy' }> }) {
  const [state, copy] = useCopy()
  return (
    <Tip
      meaning={action.meaning}
      render={
        <Button
          variant="outline"
          size="xs"
          aria-label={`${action.label}: ${action.value}`}
          onClick={() => void copy(action.value)}
        />
      }
    >
      <ActionIcon action={action} copied={state === 'copied'} />
      {copyLabel({ label: action.label, state })}
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
          size="xs"
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
      <ActionIcon action={action} copied={false} /> {action.label}
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
          size="xs"
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
      <ActionIcon action={action} copied={false} /> {action.label}
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
