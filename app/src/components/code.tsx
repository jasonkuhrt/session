import * as React from 'react'
import { highlight, tokenStyle } from '../lib/highlight'

/**
 * Code as the Markdown wrote it, but for a fenced block in a language the
 * board has a grammar for: that is drawn token by token, in Tokyo Night's own
 * colours. A fence names its language in a `language-` class on its code,
 * which sits in a `pre`; inline code has no such class, so it is never drawn
 * this way. Every render of the page reads its Markdown again, so the tokens
 * are found once for a block's text and language, not once per render.
 */
export function Code({ className, children, ...props }: React.ComponentProps<'code'>) {
  const language = /(?:^|\s)language-(\S+)/u.exec(className ?? '')?.[1] ?? null
  const lines = React.useMemo(() => (typeof children === 'string' ? highlight(children, language) : null), [children, language])
  if (lines === null) return <code className={className} {...props}>{children}</code>
  // The line breaks stay the text's own, so the block reads and copies as it was written.
  const drawn: React.ReactNode[] = []
  for (const [at, line] of lines.entries()) {
    for (const token of line) drawn.push(<span key={token.offset} style={tokenStyle(token)}>{token.content}</span>)
    if (at < lines.length - 1) drawn.push('\n')
  }
  return <code className={className} {...props}>{drawn}</code>
}
