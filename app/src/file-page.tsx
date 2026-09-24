import * as React from 'react'

import type { Crumb } from './components/board-page'
import { BoardPageFrame, PageLoading } from './components/board-page'
import { Copyable } from './components/copyable'
import { Markdown } from './components/markdown'
import { useTip } from './components/tip'
import { ApiError, problemOf, readPlace, SessionApi, worktreeOf } from './lib/api'
import { absoluteHref, isMarkdownPath, listingHref, rawFileHref } from './lib/base'
import { useFollowed } from './lib/follow'
import { listingMeta } from './lib/listings'
import { openOnceOnClick } from './lib/open-once'

/**
 * The page's trail is the file's path. The first step, when it is one of the
 * listings, goes to that listing's page; the directories between are names,
 * and the file is where you are.
 */
function crumbsOf(path: string): readonly Crumb[] {
  const segments = path.split('/')
  return segments.map((segment, position): Crumb => {
    const through = segments.slice(0, position + 1).join('/')
    if (position === segments.length - 1) {
      return { label: segment, meaning: `The file ${path}, rendered from the session as it is on disk.`, literal: true }
    }
    if (position === 0 && (segment === 'ledger' || segment === 'context' || segment === 'archive')) {
      return { label: segment, meaning: listingMeta[segment].meaning, href: listingHref(segment), literal: true }
    }
    return { label: segment, meaning: `The directory ${through}/ under the session.`, literal: true }
  })
}

/** A file as the files route answered: its text, or the daemon's sentence for why there is none. */
type FileText = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'refused'; readonly sentence: string }

/**
 * The file's text. A file that is not there, or that the daemon will not
 * serve, is a fact about the file, so its sentence is what the page shows; a
 * daemon that cannot be reached fails the read, and the page keeps what it
 * last showed.
 */
async function readText(path: string, signal: AbortSignal): Promise<FileText> {
  try {
    return { kind: 'text', text: await SessionApi.file(path, signal) }
  } catch (error) {
    if (error instanceof ApiError) return { kind: 'refused', sentence: error.message }
    throw error
  }
}

/**
 * A file's text split from the frontmatter it opens with, if any. The
 * frontmatter is a record of keys rather than prose, so it is shown as it is
 * written, in a block of its own, instead of being read as Markdown, which
 * would turn its closing line into a heading.
 */
function withFrontmatterShown(text: string) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(text)
  if (match === null) return text
  const frontmatter = match[1]!
  // A fence longer than any run of backticks inside is one nothing can close early.
  const longest = Math.max(0, ...[...frontmatter.matchAll(/`+/gu)].map(([run]) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}yaml\n${frontmatter}\n${fence}\n\n${text.slice(match[0].length)}`
}

/**
 * One Markdown file of the session, on a page of its own: a ledger entry, a
 * file under `context/`, an archived record, or any other file a link in the
 * session names. It is read at the item page's width with the same reader,
 * Evidence collapsed, and it follows the file as it changes on disk. The trail
 * is the file's path, and the line under it copies where the file is.
 */
export function FilePage({ path }: { path: string }) {
  const markdown = isMarkdownPath(path)
  // Only a Markdown file is read here; any other file is offered as it is on disk.
  const read = React.useCallback(
    (signal: AbortSignal) => Promise.all([readPlace(signal), markdown ? readText(path, signal) : Promise.resolve(null)]),
    [markdown, path],
  )
  const { value, error } = useFollowed(read)
  const [place, text] = value ?? [null, null]
  const name = path.split('/').at(-1) ?? path
  return (
    <BoardPageFrame
      title={name}
      worktree={worktreeOf(place)}
      boardMeaning="The board of the session this file belongs to."
      crumbs={crumbsOf(path)}
      problem={error ?? problemOf(place)}
    >
      {place === null ? (error === null ? <PageLoading /> : null) : (
        <article>
          {place.kind === 'read'
            ? (
              <p className="mb-8 font-mono text-xs text-muted-foreground">
                <Copyable value={`${place.directory}/${path}`} label={`the file ${place.directory}/${path}`}>
                  <span className="break-all">{`${place.directory}/${path}`}</span>
                </Copyable>
              </p>
            )
            : null}
          <div className="border-t pt-8">
            <FileContent path={path} markdown={markdown} text={text} />
          </div>
        </article>
      )}
    </BoardPageFrame>
  )
}

/**
 * The file as this page can show it: a Markdown file rendered, the daemon's
 * sentence for one it will not serve, and for any other file the way to see
 * it as it is.
 */
function FileContent({ path, markdown, text }: { path: string; markdown: boolean; text: FileText | null }) {
  if (!markdown) return <NotMarkdown path={path} />
  if (text === null) return null
  if (text.kind === 'refused') return <p className="text-sm text-muted-foreground">{text.sentence}</p>
  return <Markdown collapseEvidence>{withFrontmatterShown(text.text)}</Markdown>
}

/** What the page says of a file it does not render, and the way to see the file as it is. */
function NotMarkdown({ path }: { path: string }) {
  const tip = useTip()
  const href = rawFileHref(path)
  const absolute = absoluteHref(href)
  return (
    <p className="text-sm text-muted-foreground">
      {path} is not a Markdown file, so this page does not render it.{' '}
      <a
        className="underline underline-offset-4"
        href={href}
        rel="noreferrer"
        target="_blank"
        title={tip(`Open ${path} as it is on disk, in a tab of its own; a second click brings that tab back.`)}
        onClick={absolute === null ? undefined : openOnceOnClick(absolute)}
      >
        Open it as it is on disk
      </a>
    </p>
  )
}
