import type { WorktreeSummary } from '../../contract'
import type { SectionHead } from './dashboard'

/**
 * What the index's heads and cards say they are, in their tips, since the
 * page has no heading to say any of it once. A project is a repository, or a
 * folder outside Git, which is a project of its own, so where a worktree
 * stands, and where it goes back to, is said for each.
 */

/** The order the cards in a section stand in. */
const cardOrder = 'The cards with a live agent come first, then the newest activity.'

/** The order the sections stand in, said by every head and by the heading of the epics across projects. */
const sectionOrder =
  'Repositories, folders outside Git and the epics across projects are ordered alike: one with a live agent first, then the newest activity, and one with nothing live and nothing in five days dim and last. A repository counts every worktree of it, wherever it is drawn.'

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

/** The same for a worktree in an epic, which can also be dropped out of it, back where it stands in no epic. */
export const epicRowMeaning = ({ row, epic }: { readonly row: WorktreeSummary; readonly epic: string }) =>
  `${whatOf(row)} in “${epic}”, on this page while it has a session. Drag it onto another epic to join that one, onto a worktree in no epic to make an epic of the two, onto ${plusOf(row)} to start an epic of its own, or onto the space between the cards to leave “${epic}” for a card of its own ${homeOf(row)}.`

export const epicMeaning = (name: string) =>
  `An epic: the worktrees whose sessions name “${name}”, the busiest first. ${cardOrder} Drag this heading onto another epic to merge the two.`

export const worktreeCountMeaning = 'How many worktrees are in this epic.'

export const quietCardMeaning = 'Nothing is live here and nothing has happened in five days, so this card is dim, and last.'

/** What the house before a main worktree says, whether or not it has a session. */
export const mainMeaning =
  'The main worktree of its repository: Git keeps the repository here and lists it first, so it stands at the head of the repository’s cards and is never in an epic.'

/** What the mark before a head's name says: what heads the section, what stands below it, and how the sections are ordered. */
export const trackedHeadMeaning =
  `A main worktree, on this page while it has a session, at the head of its repository: below it stand the repository’s epics and its worktrees in no epic. ${sectionOrder}`

export const untrackedHeadMeaning =
  `A main worktree with no session, at the head of its repository all the same, so that its worktrees have a home: below it stand the repository’s epics and its worktrees in no epic. ${sectionOrder}`

export const notTrackedMeaning =
  'This main worktree has no session, so the daemon does not track it and it has no board. A session command run in it, such as session init, gives it one and puts it on this page.'

export const bareHeadMeaning =
  `The repository’s Git directory, which Git lists first where a main worktree would be: the repository is bare, or keeps its Git directory apart from its main worktree, as a submodule or a separate Git directory does. It is no worktree and holds no session, so it heads the repository by name alone: below it stand the repository’s epics and its worktrees in no epic. ${sectionOrder}`

export const folderHeadMeaning =
  `A folder outside Git, which belongs to no repository and so is a project of its own: its card stands below this head, unless it is in an epic across projects. ${sectionOrder}`

export const acrossMeaning =
  `Epics whose worktrees belong to more than one project, each a repository or a folder outside Git, drawn once here rather than under any one of them. A worktree that leaves one goes back to its own. ${sectionOrder}`

/** Why a head is dim, in the words that are true of what it heads. */
export const quietHeadMeaning = (head: SectionHead) =>
  head.kind === 'folder'
    ? 'Nothing is live in this folder and it has done nothing in five days, so it is dim, and last.'
    : 'No worktree of this repository has a live agent or has done anything in five days, so it is dim, and last.'

export const quietAcrossMeaning =
  'No worktree in these epics has a live agent or has done anything in five days, so they are dim, and last.'
