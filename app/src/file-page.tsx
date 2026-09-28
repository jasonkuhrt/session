import { queryOptions } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'

import { encodeWorktreeKey } from '../contract'
import type { Sections } from './components/markdown'
import { Markdown } from './components/markdown'
import { PageLoading, PageSurface, useFocusUpTo } from './components/page'
import { useTip } from './components/tip'
import { ApiError, problemOf, readPlace, SessionApi } from './lib/api'
import { absoluteHref, isMarkdownPath, rawFileHref, useBoardName, useBoardPath } from './lib/base'
import { useFolds } from './lib/folds'
import { useFollowed } from './lib/follow'
import { openOnceOnClick } from './lib/open-once'
import { extentOf, isEvidence, sectionsOf } from './lib/sections'
import { idOf } from './levels'
import { Node } from './substrate/node'
import type { Entry } from './tree-types'

/** A file as the files route answered: its text, or the daemon's sentence for why there is none. */
type FileText = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'refused'; readonly sentence: string }

/**
 * The file's text. A file that is not there, or that the daemon will not
 * serve, is a fact about the file, so its sentence is what the page shows; a
 * daemon that cannot be reached fails the read, and the page keeps what it
 * last showed.
 */
async function readText(board: string, path: string, signal: AbortSignal): Promise<FileText> {
  try {
    return { kind: 'text', text: await SessionApi.file(board, path, signal) }
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
 * file under `context/`, an archived record, `RULES.md`, or any other file a
 * link in the session names. It is read at the item page's width with the
 * same reader, each section's heading a node whose Enter folds it, Evidence
 * folded to start with, and it follows the file as it changes on disk.
 */
export function FilePage({ path }: { path: string }) {
  const { focus: leaf } = useSearch({ strict: false })
  const board = useBoardPath()
  const worktree = useBoardName()
  const key = encodeWorktreeKey(worktree)
  const folds = useFolds()
  const markdown = isMarkdownPath(path)
  // Only a Markdown file is read here; any other file is offered as it is on disk.
  const { value, error } = useFollowed({
    board,
    read: queryOptions({
      queryKey: [board, 'file', path],
      queryFn: ({ signal }) =>
        Promise.all([readPlace({ board, signal }), markdown ? readText(board, path, signal) : Promise.resolve(null)]),
    }),
  })
  const [place, text] = value ?? [null, null]
  const name = path.split('/').at(-1) ?? path
  const shown = text?.kind === 'text' ? withFrontmatterShown(text.text) : ''
  const sections = sectionsOf(shown)
  const foldKey = `file:${key}:${path}`
  const startsFolded = (at: string) => sections.some((section) => section.at === at && isEvidence(section))
  const directory = place?.kind === 'read' ? place.directory : null
  const recordId = idOf({ kind: 'record', page: 'file', path })
  const entries: Entry[] = sections.map((section) => ({
    at: section.at,
    heading: section.heading,
    facts: [{ key: 'extent', text: extentOf(section), meaning: 'How much the section holds.' }],
  }))
  return (
    <PageSurface
      place={{ kind: 'file', key, path }}
      leaf={leaf}
      title={name}
      sessions={new Map()}
      archived={null}
      entries={new Map([[recordId, entries]])}
      write={null}
      pending={false}
      rules={null}
      page={{
        enter: (at) => folds.toggle(`${foldKey}/${at}`),
        pathOf: () => null,
        path: directory === null ? null : `${directory}/${path}`,
      }}
      ready={value !== null || error !== null}
      problem={error ?? problemOf(place)}
    >
      {place === null ? (error === null ? <PageLoading /> : null) : (
        <FileBody path={path} name={name} markdown={markdown} text={text} shown={shown} foldKey={foldKey} startsFolded={startsFolded} />
      )}
    </PageSurface>
  )
}

/**
 * The file as this page can show it, under its name, the record node: a
 * Markdown file rendered in sections, the daemon's sentence for one it will
 * not serve, and for any other file the way to see it as it is.
 */
function FileBody({ path, name, markdown, text, shown, foldKey, startsFolded }: {
  path: string
  name: string
  markdown: boolean
  text: FileText | null
  shown: string
  foldKey: string
  startsFolded: (at: string) => boolean
}) {
  const record = useFocusUpTo('record')
  const tip = useTip()
  const heading = <span className="font-mono" title={tip(`The file ${path}, rendered from the session as it is on disk.`)}>{name}</span>
  return (
    <article>
      {record === null
        ? <h1 className="mb-6 text-xl font-medium">{heading}</h1>
        : <Node path={record} as="h2" className="-mx-2.5 mb-6 px-2.5 py-1 text-xl font-medium">{heading}</Node>}
      <div className="border-t pt-8">
        {markdown ? <MarkdownFile text={text} shown={shown} sections={record === null ? null : { base: record, foldKey, startsFolded }} /> : <NotMarkdown path={path} />}
      </div>
    </article>
  )
}

/** A Markdown file as the files route answered: rendered in sections, or the daemon's sentence for why it will not serve it. */
function MarkdownFile({ text, shown, sections }: { text: FileText | null; shown: string; sections: Sections | null }) {
  if (text === null) return null
  if (text.kind === 'refused') return <p className="text-sm text-muted-foreground">{text.sentence}</p>
  return <Markdown page sections={sections}>{shown}</Markdown>
}

/** What the page says of a file it does not render, and the way to see the file as it is. */
function NotMarkdown({ path }: { path: string }) {
  const tip = useTip()
  const href = rawFileHref({ board: useBoardPath(), path })
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
