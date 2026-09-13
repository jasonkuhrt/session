/**
 * The daemon serves the index at `/` and each board at `/w/<key>/`, where the
 * key is a worktree name and may hold more than one segment. One bundle serves
 * both, so requests, Markdown links and the event stream hang off this prefix,
 * and `index.html` references its assets relatively.
 */
const pathname = window.location.pathname

export const basePath = pathname.startsWith('/w/') ? pathname.replace(/\/+$/u, '') : ''

export const isBoard = basePath !== ''
