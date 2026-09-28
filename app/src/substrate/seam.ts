import type { LinkOptions } from '@tanstack/react-router'
import type * as React from 'react'

import type { Command } from './registry'

/**
 * The seam: everything the substrate asks of the app, and nothing else. The
 * substrate holds no noun of the app's; it knows a tree of nodes by the ids
 * the app gives them, and asks the app what each one is, what is inside it,
 * what it stands for, which view draws it, how its step of the path line and
 * its facts read, what can be done to it, and what the palette can go to.
 */

/** Where a node is: the ids of the nodes from the root down to it. */
export type Path = readonly string[]

/** A node a command can act on: the scope it is at, its id, and the path to it. */
export type Target = { readonly scope: string; readonly id: string; readonly path: Path }

/** A step of the path line: what it says, what it means, whether it is a name the files use, and the marks it carries. */
type Crumb = {
  readonly text: string
  readonly meaning: string
  readonly literal?: boolean
  /** What can need you now about the node, drawn in its step when the view does not draw the node itself. */
  readonly marks?: React.ReactNode
}

/** One fact about the focused node, for the detail line: what it says and the sentence behind it. */
export type Fact = { readonly key: string; readonly text: React.ReactNode; readonly meaning: string }

/** Somewhere the palette can go: what it is called, what it is, the id it goes by, and where it is. */
export type GoTo = { readonly name: string; readonly on: string; readonly id?: string | undefined; readonly path: Path }

/** One of the choices a command asks for, and what taking it does. */
export type Choice = {
  readonly key: string
  readonly name: string
  readonly on: string
  readonly run: () => void | Promise<unknown>
}

/** A name a command asks for: what it names, where the name starts, and what taking it does, answering why not when it cannot. */
export type NameRequest = {
  readonly title: string
  readonly meaning: string
  readonly value: string
  readonly placeholder: string
  readonly confirm: (name: string) => Promise<string | null>
}

/** What a command can do through the substrate as it runs. */
export type SurfaceApi = {
  readonly focus: Path
  readonly setFocus: (path: Path) => void
  /**
   * Moves the focus to another view in place of the current history entry,
   * settling once the address holds it: for a view whose own address is about
   * to name nothing, as an epic's board is when the epic is renamed there.
   */
  readonly relocate: (path: Path) => Promise<void>
  /** Says what just happened, or why nothing did, in the detail line. */
  readonly flash: (text: string) => void
  readonly marks: ReadonlySet<string>
  readonly clearMarks: () => void
  readonly unmark: (ids: readonly string[]) => void
  readonly askName: (request: NameRequest) => void
  readonly choose: (request: { readonly prompt: string; readonly choices: readonly Choice[] }) => void
  readonly openSettings: () => void
  /** The child last focused under a node that is still among its children, else the first. */
  readonly recall: (parent: Path, children: readonly string[]) => string | null
}

/**
 * What a command does, as the app answers it: whether it can act on a target,
 * true or the reason it cannot in the app's words, and doing it.
 */
export type Runner = {
  /** Whether it can act on a target with the focus where it is: true, or why not. */
  readonly when?: ((target: Target, focus: Path) => true | string) | undefined
  readonly run: (target: Target, surface: SurfaceApi) => void | Promise<void>
  /**
   * Where running it takes the focus, for a command that opens another page:
   * a node whose own Enter it is is drawn as a link to that page, so the
   * browser can open it in a tab of its own. Null when, on this target, it
   * stays on the page; absent for a command that never leaves it.
   */
  readonly to?: ((target: Target, surface: SurfaceApi) => Path | null) | undefined
}

/** The app, as the substrate reads it. */
export type Seam = {
  /** The root node's id. */
  readonly root: string
  /** The levels, root first, then the modes' scopes. */
  readonly scopes: readonly string[]
  readonly scopeName: (scope: string) => string
  readonly registry: readonly Command[]
  readonly runners: Readonly<Record<string, Runner>>
  /** Where the focus is, as the address and what has been read say. */
  readonly focus: Path
  /** Whether the view has drawn what it read, so a focus it does not draw can be settled. */
  readonly ready: boolean
  /** Whether a drag holds the keys. */
  readonly held: boolean
  readonly scopeOf: (id: string) => string
  /** The children `i` goes into. */
  readonly kids: (path: Path) => readonly string[]
  /** What a node stands for besides itself, nearest first: a heading that is also a thing. */
  readonly standsFor: (path: Path) => readonly Path[]
  /** A path as the view that draws it names it, a node folded into its parent's row. */
  readonly normalize: (path: Path) => Path
  /** Which view draws a path: two paths with one key are one view. */
  readonly viewOf: (path: Path) => string
  /**
   * Puts a path in the address: a history entry of its own, or in place of
   * the current one, settling once the address holds it. Two writes in one
   * tick can land as one, so a write that must stand in its own entry before
   * the next waits for this.
   */
  readonly go: (path: Path, options: { readonly replace: boolean }) => Promise<void>
  /**
   * Where a path is drawn, as the router's options for a link there, which
   * the substrate draws with the router's `Link`: a click with a modifier, or
   * with any button but the first, leaves its address to the browser. Null
   * for a path that has no address, as `go` goes nowhere for it.
   */
  readonly link: (path: Path) => LinkOptions | null
  readonly crumb: (path: Path, index: number, drawn: boolean) => Crumb
  readonly facts: (path: Path) => readonly Fact[]
  /** What a command acts on, as the palette names it beside the command. */
  readonly targetName: (target: Target) => string
  /** The palette's second half: everything there is to go to. */
  readonly goTo: () => readonly GoTo[]
  /** Whether Space can mark a node, or why not. */
  readonly markable: (path: Path) => true | string
  /** What the detail line says when `i` finds nothing inside. */
  readonly noInside: (path: Path) => string
  /** What it says when `n` is pressed at the root. */
  readonly noOut: (path: Path) => string
  /** The settings the app draws, when the settings command opens them. */
  readonly settings: React.ReactNode
  /** A word's sentence as its tip, or nothing when the app shows no tips. */
  readonly tip: (meaning: string) => string | undefined
}
