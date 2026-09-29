# The board

What the board draws, its keys and commands, and the pages beside it. The
board is a viewer over the files with workflow actions; `SKILL.md` says when
to open it and what it never does.

The board is keyboard first and draws only the path and the work: a path line
naming where the one focus is, the lanes or the index's outline of projects,
epics and worktrees, and a detail line holding the focused node's facts, the
branch's pull request among them, carrying only what gh answered, as Linear
issue… lists the Linear issues it names only as linear answered. A worktree's
marks, a dot per live agent, a `!` for a source that could not answer or a file
that breaks a rule, and its pull request's number, go wherever the worktree is
drawn. Every action is a command the palette, `;`, lists and the key map, `?`,
names: a worktree's terminal, `t`, brings forward its cmux workspace or opens
one, its editor, `e`, brings forward the Zed window on it or opens a new one,
and `e` on an item opens the item's file there at its first line; Agents…, the
Pull request, Linear issue…, Rules, Ledger, Context and Archive commands reach
the rest. Each opens its target once, bringing back the tab, the workspace or
the window already open rather than opening another, and a command that cannot
run says why in the detail line. An epic's board and a project's draw each
worktree's name with its marks at its row's left edge, and every worktree
command runs from its row.

The pages sit beside the board, under its address `/w/<key>/`, where the key
names the worktree; they are read-only views of the files and follow them as the
board does, and the Ledger, Context, Archive and Rules commands open them. The
ledger page, `/w/<key>/ledger`, shows the entries newest first. The context
page, `/w/<key>/context`, shows `context/` as a tree. The archive page,
`/w/<key>/archive`, lists the archive's records newest first, for a person
looking back rather than as context for an agent. The file page,
`/w/<key>/file/<path>`, renders one Markdown file of the session at the item
page's reading width. A Markdown file opens there from the context page, a
record from the archive page, and a linked Markdown file from an item, so each
has an address to send the user to. No page carries unread state or asks for
anything.
