import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-[state=closed]:animate-[fade-out_150ms_ease-in] data-[state=open]:animate-[fade-in_180ms_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[88dvh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-white/10 bg-[#121214] p-6 text-zinc-100 shadow-[0_32px_100px_rgba(0,0,0,0.7)] outline-none sm:p-8',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex size-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-white/70">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm data-[state=closed]:animate-[fade-out_150ms_ease-in] data-[state=open]:animate-[fade-in_180ms_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-white/10 bg-[#111113] text-zinc-100 shadow-[-32px_0_100px_rgba(0,0,0,0.5)] outline-none data-[state=closed]:animate-[sheet-out_180ms_ease-in] data-[state=open]:animate-[sheet-in_240ms_cubic-bezier(.22,1,.36,1)]',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-5 top-5 inline-flex size-10 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-black/10 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-white/70">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('pr-10 text-2xl font-semibold tracking-[-0.025em] text-white', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('mt-2 text-sm text-zinc-500', className)} {...props} />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  SheetContent,
  DialogTitle,
  DialogDescription,
}
