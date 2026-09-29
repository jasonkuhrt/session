import * as React from 'react'
import { highlight, tokenStyle } from '../lib/highlight'

/**
 * A block's code drawn as spans of its tokens, or null when the block is not
 * one to colour. Shiki takes the text apart at each `\n` or `\r\n` and gives
 * the lines without them, so each break is put back as the text's own, and a
 * block reads and copies as it was written.
 */
const drawnCode = ({ text, language }: { readonly text: string; readonly language: string | null }) => {
  const lines = highlight({ code: text, lang: language })
  if (lines === null) return null
  const breaks = text.match(/\r?\n/gu) ?? []
  const drawn: React.ReactNode[] = []
  for (const [at, line] of lines.entries()) {
    for (const token of line) drawn.push(<span key={token.offset} style={tokenStyle(token)}>{token.content}</span>)
    const lineBreak = breaks[at]
    if (lineBreak !== undefined) drawn.push(lineBreak)
  }
  return drawn
}

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
  const drawn = React.useMemo(() => (typeof children === 'string' ? drawnCode({ text: children, language }) : null), [children, language])
  return <code className={className} {...props}>{drawn ?? children}</code>
}
