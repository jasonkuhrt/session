import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:
          'bg-white text-zinc-950 shadow-[0_8px_24px_rgba(255,255,255,0.08)] hover:-translate-y-px hover:bg-zinc-100',
        outline:
          'border border-white/10 bg-white/[0.035] text-zinc-200 hover:border-white/20 hover:bg-white/[0.07]',
        ghost: 'text-zinc-400 hover:bg-white/[0.06] hover:text-white',
        danger: 'border border-red-400/20 bg-red-400/10 text-red-200 hover:bg-red-400/15',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 rounded-lg px-3 text-[13px]',
        icon: 'size-9 rounded-xl',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { Button, buttonVariants }
