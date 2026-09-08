import * as React from 'react'

import { cn } from '../../lib/utils'

function Card({ className, ...props }: React.ComponentProps<'article'>) {
  return (
    <article
      className={cn(
        'rounded-2xl border border-white/[0.1] bg-[#171719]/95 shadow-[0_16px_50px_rgba(0,0,0,0.18)]',
        className,
      )}
      {...props}
    />
  )
}

export { Card }
