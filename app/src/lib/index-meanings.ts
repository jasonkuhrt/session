import type { WorktreeSummary } from '../../contract'
import type { SectionHead } from './dashboard'

/**
 * What the index's heads and cards say they are, in their tips, since the
 * page has no heading to say any of it once. A project is a repository, or a
 * folder outside Git, which is a project of its own, so where a worktree
 * stands, and where it goes back to, is said for each, and whether it was
 * placed by hand, which is what keeps it where it stands.
 */

/** The order the cards in a section stand in. */
const cardOrder = 'The cards with a live agent come first, then the newest activity.'

/** The order the sections stand in, said by every head and by the heading of the epics across projects. */
const sectionOrder =
  'The repositories placed by hand stand first, in the order they were placed in. The rest, folders outside Git and the epics across projects among them, follow alike: one with a live agent first, then the newest activity, and one with nothing live and nothing in five days dim and last. A repository counts every worktree of it, wherever it is drawn.'

/** Why a head that is no main worktree's row cannot be dragged into place. */
const unplaced = 'It has no session of its own to keep a place in, so it stands after the repositories placed by hand.'

/** What a worktree is on the index: a worktree of a repository, or a folder outside Git. */
const whatOf = (row: WorktreeSummary) => (row.repository === null ? 'A folder outside Git' : 'A worktree')

/** Where a worktree stands when it is in no epic, and goes back to when it leaves one. */
const homeOf = (row: WorktreeSummary) => (row.repository === null ? 'under its own head' : 'under its repository')

/** Where the `+` that starts an epic of it alone appears. */
const plusOf = (row: WorktreeSummary) =>
  row.repository === null ? 'the + that appears under its own head' : 'the + that appears after its repository’s cards'

/** What a worktree in no epic is, and where it can be dropped, said by the mark before its name. */
export const looseMeaning = (row: WorktreeSummary) =>
  `${whatOf(row)} in no epic, on this page while it has a session, ${homeOf(row)}. ${cardOrder} Drag it onto an epic to join it, onto another worktree in no epic to make an epic of the two, or onto ${plusOf(row)} to start an epic of its own.`

/** Whether a worktree in an epic was placed there by hand, which keeps it where it stands in the epic's card. */
const placedIn = ({ row, epic }: { readonly row: WorktreeSummary; readonly epic: string }) =>
  row.rank === null
    ? `It is not placed by hand, so it stands after the worktrees of “${epic}” that are, by what is happening in it.`
    : `It was placed by hand, so it keeps its place in “${epic}” whatever happens in it.`

/** The same for a worktree in an epic, which can also be placed within it, or dropped out of it, back where it stands in no epic. */
export const epicRowMeaning = ({ row, epic }: { readonly row: WorktreeSummary; readonly epic: string }) =>
  `${whatOf(row)} in “${epic}”, on this page while it has a session. ${placedIn({ row, epic })} Drag it up or down within “${epic}” to place it there, onto another epic to join that one, onto a worktree in no epic to make an epic of the two, onto ${plusOf(row)} to start an epic of its own, or onto the space between the cards to leave “${epic}” for a card of its own ${homeOf(row)}.`

export const epicMeaning = (name: string) =>
  `An epic: the worktrees whose sessions name “${name}”, those placed by hand first, then the busiest. ${cardOrder} Drag this heading onto another epic to merge the two.`

export const worktreeCountMeaning = 'How many worktrees are in this epic.'

export const quietCardMeaning = 'Nothing is live here and nothing has happened in five days, so this card is dim, and last.'

/** What the house before a main worktree says, whether or not it has a session. */
export const mainMeaning =
  'The main worktree of its repository: its Git directory is the repository’s own, which the linked worktrees share, and Git will not move, lock or remove it, so it stands at the head of the repository’s cards and is never in an epic.'

/** What the mark before a head's name says: what heads the section, what stands below it, how it is placed and how the sections are ordered. */
export const trackedHeadMeaning = (row: WorktreeSummary) =>
  `A main worktree, on this page while it has a session, at the head of its repository: below it stand the repository’s epics and its worktrees in no epic. ${
    row.repository?.bare === true
      ? `Its Git directory is kept apart from it, at ${row.repository.path}, which Git lists in its place and names the repository by. `
      : ''
  }${
    row.rank === null
      ? 'Its repository is not placed by hand, so it stands after the ones that are.'
      : 'Its repository was placed by hand, so it keeps its place in the stack whatever happens in it.'
  } Drag this head above or below another project to place its repository there. ${sectionOrder}`

export const untrackedHeadMeaning =
  `A main worktree with no session, at the head of its repository all the same, so that its worktrees have a home: below it stand the repository’s epics and its worktrees in no epic. ${unplaced} ${sectionOrder}`

export const notTrackedMeaning =
  'This main worktree has no session, so the daemon does not track it and it has no board. A session command run in it, such as session init, gives it one and puts it on this page.'

export const bareHeadMeaning =
  `The repository’s Git directory, which Git lists first where a main worktree would be: the repository is bare, or keeps its Git directory apart from its main worktree, as a submodule or a separate Git directory does. It is no worktree and holds no session, so it heads the repository by name alone: below it stand the repository’s epics and its worktrees in no epic. A main worktree kept apart this way heads the repository here instead once the daemon tracks it, which running session open in it does. ${unplaced} ${sectionOrder}`

/** What the page says of a row Git could not answer for, which has no section to stand in: where it is, and Git's line. */
export const unresolvedNotice = (row: WorktreeSummary) =>
  `Git did not answer for ${row.path}, so it has no place on this page until the next session open asks again: ${row.conflict ?? 'Git gave no reason.'}`

export const folderHeadMeaning =
  `A folder outside Git, which belongs to no repository and so is a project of its own: its card stands below this head, unless it is in an epic across projects. It has no main worktree to keep the project’s place, so it stands after the repositories placed by hand. ${sectionOrder}`

export const acrossMeaning =
  `Epics whose worktrees belong to more than one project, each a repository or a folder outside Git, drawn once here rather than under any one of them. A worktree that leaves one goes back to its own. ${sectionOrder}`

/** Why a head is dim, in the words that are true of what it heads, and whether it is last or keeps the place it was given. */
export const quietHeadMeaning = ({ head, ranked }: { readonly head: SectionHead; readonly ranked: boolean }) => {
  if (head.kind === 'folder') return 'Nothing is live in this folder and it has done nothing in five days, so it is dim, and last.'
  return ranked
    ? 'No worktree of this repository has a live agent or has done anything in five days, so it is dim; it was placed by hand, so it keeps its place.'
    : 'No worktree of this repository has a live agent or has done anything in five days, so it is dim, and last.'
}

export const quietAcrossMeaning =
  'No worktree in these epics has a live agent or has done anything in five days, so they are dim, and last.'
