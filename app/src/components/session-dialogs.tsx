import { CheckCircle2, Layers3, Sparkles } from 'lucide-react'
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
import { Textarea } from './ui/textarea'

export function AddCandidateDialog({
  open,
  pending,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (title: string, body: string) => Promise<boolean>
}) {
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')

  const reset = () => {
    setTitle('')
    setBody('')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <Sparkles className="size-4 text-muted-foreground" />
          <DialogTitle>Add a candidate</DialogTitle>
          <DialogDescription>Capture it in Triage. Shape and move it when the idea earns attention.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!title.trim()) return
            const added = await onAdd(title.trim(), body.trim())
            if (!added) return
            reset()
            onOpenChange(false)
          }}
        >
          <Field label="Title">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A concise working title"
              required
            />
          </Field>
          <Field label="Detail" optional>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Markdown: context, questions, constraints…"
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!title.trim() || pending}>
              {pending ? 'Adding…' : 'Add to Triage'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
          <Field label="Batch name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="What outcome unites this work?"
              required
            />
          </Field>
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
            <span className="text-foreground">{item?.title}</span> will leave Execute and be recorded by the source
            workflow.
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

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {optional ? <span className="text-xs text-muted-foreground">Optional</span> : null}
      </div>
      {children}
    </div>
  )
}
