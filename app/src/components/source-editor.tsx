import * as React from 'react'

import type { Stage, StageFile } from '../../contract'
import { Button } from './ui/button'
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
  const isDirectory = stage.layout === 'directory'
  const parts = stage.path.split('/')
  const name = parts.pop() ?? stage.path
  const parent = parts.join('/')

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
          <SheetDescription>{isDirectory ? 'Source directory' : 'Source file'}</SheetDescription>
          <SheetTitle className="font-mono">{name}</SheetTitle>
          <p className="break-all font-mono text-xs text-muted-foreground">{parent}</p>
          {isDirectory ? (
            <p className="text-sm text-muted-foreground">
              This stage is a directory of item files. The Markdown below is their rendered order; saving rewrites
              those files.
            </p>
          ) : null}
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
          <p className="text-sm text-muted-foreground">{dirty ? 'Unsaved changes' : 'Up to date'}</p>
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
