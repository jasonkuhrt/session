import { CheckCircle2, Layers3 } from 'lucide-react'
import * as React from 'react'

import type { Item } from '../../contract'
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

export function BatchDialog({
  open,
  pending,
  count,
  onOpenChange,
  onQueue,
}: {
  open: boolean
  pending: boolean
  count: number
  onOpenChange: (open: boolean) => void
  onQueue: (name: string) => void
}) {
  const [name, setName] = React.useState('')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setName('')
      }}
    >
      <DialogContent>
        <DialogHeader>
          <Layers3 className="size-4 text-muted-foreground" />
          <DialogTitle>Queue a focused batch</DialogTitle>
          <DialogDescription>
            {count} selected {count === 1 ? 'item' : 'items'} will wait in Queue as one named batch.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) onQueue(name.trim())
          }}
        >
          <div className="space-y-2">
            <Label>Batch name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="What outcome unites this work?"
              required
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!name.trim() || count === 0 || pending}>
              {pending ? 'Queuing…' : 'Queue batch'}
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
  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <CheckCircle2 className="size-4 text-muted-foreground" />
          <DialogTitle>Complete this work?</DialogTitle>
          <DialogDescription>
            <span className="text-foreground">{item?.title}</span> will leave Execute and be filed under{' '}
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
