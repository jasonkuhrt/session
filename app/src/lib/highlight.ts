import bash from '@shikijs/langs/bash'
import json from '@shikijs/langs/json'
import tsx from '@shikijs/langs/tsx'
import typescript from '@shikijs/langs/typescript'
import tokyoNight from '@shikijs/themes/tokyo-night'
import type { CSSProperties } from 'react'
import { createHighlighterCoreSync, getTokenStyleObject, type HighlighterCore, type ThemedToken } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/*
 * Code the board colours: a fenced block in TypeScript, TSX, JSON or shell is
 * drawn in Tokyo Night's own colours, the theme the board itself is drawn in.
 * Shiki cuts a block into tokens with the language's TextMate grammar, and the
 * theme gives every token its colour and its font style, so no colour is
 * chosen here and none is added to the stylesheet.
 *
 * Only the pieces this needs are imported: the four grammars, the theme, and
 * the regex engine that runs in JavaScript and needs no WebAssembly. Never
 * `shiki` itself or one of its bundles, which carry every grammar there is.
 */

/** The grammars the board holds: TypeScript, TSX, JSON and shell, each as the registrations its module exports. */
const grammars = [typescript, tsx, json, bash]

/**
 * The names a fence may give for a grammar held here: each grammar's own name
 * and the aliases it declares, which are the names the highlighter answers to
 * once it is built. They are read from the grammars, not from the highlighter,
 * so a block in any other language is known to be plain without building it.
 */
const answered: ReadonlySet<string> = new Set(grammars.flat().flatMap(({ name, aliases }) => [name].concat(aliases ?? [])))

/** The one theme the highlighter holds, by the name its registration gives it. */
const theme = 'tokyo-night'

/**
 * A line of this many characters or more is left uncoloured. Tokenizing takes
 * longer than a line grows: a line of TypeScript takes about a tenth of a
 * second at four thousand characters and over a second at sixteen thousand,
 * so one minified line must not stall the page. The bound is a length and not
 * the tokenizer's own limit of half a second a line, which is passed as none:
 * it counts the time a grammar takes to compile its patterns on the first
 * lines it reads, which JavaScriptCore spends over half a second on for the
 * first line of TypeScript, so those lines come back cut short and the same
 * block is coloured differently on another engine or a slower machine.
 */
const longestLine = 4000

let highlighter: HighlighterCore | undefined

/**
 * The highlighter, built by the first block that asks for it and kept for the
 * page's life, so a page with no such block never builds it. Nothing here
 * reads a browser global, since the build's prerender loads this module where
 * there is none.
 */
const held = () => {
  highlighter ??= createHighlighterCoreSync({ themes: [tokyoNight], langs: grammars, engine: createJavaScriptRegexEngine() })
  return highlighter
}

/**
 * The lines of a block's code as tokens, when a grammar held here answers to
 * the language its fence names, and null for any other language and for none.
 * A fence names its language in any case, as GitHub reads it, and the grammars
 * know only their lower-case names.
 */
export const highlight = (code: string, lang: string | null): ThemedToken[][] | null => {
  const name = lang?.toLowerCase()
  if (name === undefined || !answered.has(name)) return null
  return held().codeToTokensBase(code, { lang: name, theme, tokenizeTimeLimit: 0, tokenizeMaxLineLength: longestLine })
}

/**
 * The style one token is drawn in: the theme's colour for it, and its font
 * style when the theme sets one, such as the italics Tokyo Night gives a
 * comment. A token's own background is never drawn, since a block keeps the
 * board's band for its ground.
 */
export const tokenStyle = (token: ThemedToken): CSSProperties => {
  const style = getTokenStyleObject(token)
  return {
    color: style['color'],
    fontStyle: style['font-style'],
    fontWeight: style['font-weight'],
    textDecoration: style['text-decoration'],
  }
}
