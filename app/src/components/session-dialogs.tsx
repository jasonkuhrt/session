import { CheckCircle2, Layers3, Sparkles } from 'lucide-react'
import * as React from 'react'

import type { Item, Stage, StageFile } from '../../contract'
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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './ui/sheet'
import { Textarea } from './ui/textarea'
import { Markdown } from './markdown'

export function SourceEditor({
  stage,
  revision,
  conflict,
  open,
  pending,
  onOpenChange,
  onUseLatest,
  onSave,
}: {
  stage: StageFile
  revision: string
  conflict: { revision: string; markdown: string } | null
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onUseLatest: (revision: string) => void
  onSave: (stage: Stage, markdown: string, revision: string) => Promise<boolean>
}) {
  const [markdown, setMarkdown] = React.useState(stage.markdown)
  const dirty = markdown !== stage.markdown
  const parts = stage.file.split('/')
  const fileName = parts.pop() ?? stage.file
  const directory = parts.join('/')

  return (
    <Sheet
      open={open}
      onOpenChange={(next, details) => {
        if (!next && dirty && details.reason === 'escape-key') {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
    >
      <SheetContent className="w-[72rem] max-w-[72rem] sm:max-w-[72rem]">
        <SheetHeader className="border-b pr-16">
          <SheetDescription>Source file</SheetDescription>
          <SheetTitle className="font-mono">{fileName}</SheetTitle>
          <p className="break-all font-mono text-xs text-muted-foreground">{directory}</p>
        </SheetHeader>

        <div className="grid min-h-0 flex-1 grid-cols-2">
          <div className="flex min-h-0 flex-col border-r">
            <Label className="border-b px-4 py-3">Markdown</Label>
            <Textarea
              className="min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-sm focus-visible:ring-0"
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="min-h-0 overflow-y-auto">
            <div className="sticky top-0 z-10 border-b bg-popover px-4 py-3 text-sm font-medium text-muted-foreground">
              {conflict ? 'Latest source on disk' : 'Preview'}
            </div>
            {conflict ? (
              <div className="space-y-4 p-5">
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  The source changed after this draft opened. Review the current disk version, then use its revision
                  before saving your draft.
                </p>
                <pre
                  className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 font-mono text-sm"
                >
                  {conflict.markdown}
                </pre>
                <Button onClick={() => onUseLatest(conflict.revision)}>Use latest revision</Button>
              </div>
            ) : (
              <div className="p-6">
                <Markdown>{markdown || '_This file is empty._'}</Markdown>
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t">
          <p className="text-sm text-muted-foreground">{dirty ? 'Unsaved changes' : 'File is up to date'}</p>
          <div className="flex gap-2">
            <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
            <Button
              disabled={!dirty || pending || conflict !== null}
              onClick={() => void onSave(stage.stage, markdown, revision).then((ok) => ok && onOpenChange(false))}
            >
              {pending ? 'Saving…' : 'Save source'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

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
  onStart,
}: {
  open: boolean
  pending: boolean
  count: number
  onOpenChange: (open: boolean) => void
  onStart: (name: string) => void
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
          <DialogTitle>Start a focused batch</DialogTitle>
          <DialogDescription>
            {count} selected {count === 1 ? 'item' : 'items'} will move into Execute together.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) onStart(name.trim())
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
              {pending ? 'Starting…' : 'Start batch'}
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
