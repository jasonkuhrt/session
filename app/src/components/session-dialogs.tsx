import { CheckCircle2, Group, Layers3 } from 'lucide-react'
import * as React from 'react'

import type { Item, Stage } from '../../contract'
import { useLastPresent } from '../lib/overlay'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

/**
 * What the name dialog is naming: selected items of one lane as a group, or
 * Batch items as a batch for Queue, either the selection or the items of one
 * group there, in which case the group's name is where the name starts.
 */
export type NameRequest =
  | { readonly kind: 'group'; readonly stage: Stage; readonly ids: readonly string[] }
  | { readonly kind: 'batch'; readonly ids: readonly string[]; readonly group: string | null }

const startingName = (request: NameRequest | null) => (request?.kind === 'batch' ? request.group ?? '' : '')

function copyOf(request: NameRequest) {
  const count = request.ids.length
  const selected = `${count} selected ${count === 1 ? 'item' : 'items'}`
  if (request.kind === 'group') {
    const lane = request.stage
    return {
      title: 'Gather a group',
      description: `${selected} in ${lane} will be gathered under one name. A name ${lane} already has adds them to that group.`,
      label: 'Group name',
      placeholder: 'What do these items have in common?',
      submit: 'Group items',
      submitting: 'Grouping…',
    }
  }
  return {
    title: 'Queue a focused batch',
    description: request.group === null
      ? `${selected} will wait in Queue as one named batch.`
      : `The items of the group “${request.group}” will wait in Queue as one named batch, and the group goes with them.`,
    label: 'Batch name',
    placeholder: 'What outcome unites this work?',
    submit: 'Queue batch',
    submitting: 'Queuing…',
  }
}

/**
 * The one dialog that names something: a group gathered from a lane's
 * selection, and a batch composed for Queue from the Batch selection or from
 * one group in Batch. Every name the board asks for is asked for here, so a
 * group and a batch are named the same way.
 */
export function NameDialog({
  request,
  pending,
  onClose,
  onName,
}: {
  request: NameRequest | null
  pending: boolean
  onClose: () => void
  onName: (name: string) => void
}) {
  // The board clears the request as the dialog closes; the copy still has to
  // say what it was naming on the way out.
  const shown = useLastPresent(request)
  const [name, setName] = React.useState(() => startingName(request))
  // Each request starts from its own name: a group's batch from the group's
  // name, a selection from nothing.
  const [named, setNamed] = React.useState(request)
  if (request !== null && request !== named) {
    setNamed(request)
    setName(startingName(request))
  }
  const nameId = React.useId()
  const copy = shown === null ? null : copyOf(shown)

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          {shown?.kind === 'group'
            ? <Group className="size-4 text-muted-foreground" />
            : <Layers3 className="size-4 text-muted-foreground" />}
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) onName(name.trim())
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={nameId}>{copy?.label}</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy?.placeholder}
              required
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!name.trim() || (shown?.ids.length ?? 0) === 0 || pending}>
              {pending ? copy?.submitting : copy?.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CompleteDialog({
  item,
  pending,
  onOpenChange,
  onComplete,
}: {
  item: Item | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}) {
  // The board clears the item as the dialog closes; the sentence below still
  // has to name it on the way out.
  const shown = useLastPresent(item)

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <CheckCircle2 className="size-4 text-muted-foreground" />
          <DialogTitle>Complete this work?</DialogTitle>
          <DialogDescription>
            <span className="text-foreground">{shown?.title}</span> will leave Execute and be filed under{' '}
            <code className="font-mono">archive/</code> as done.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep working</DialogClose>
          <Button onClick={onComplete} disabled={pending}>
            {pending ? 'Completing…' : 'Complete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
