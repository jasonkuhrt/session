import type { ArchiveRecord, Item } from '../../contract'
import { SessionApi } from './api'

/**
 * What a state word in an archived record's name says about how the item
 * left. `done` is finished work; every other word is the stage
 * `session archive` filed it from, which sets an item aside without finishing
 * it. The archive page says it beside each record, and an archived item's own
 * page says it beside the item.
 */
export const archiveStateMeaning = (state: string) => {
  switch (state) {
    case 'done': {
      return 'done: it was finished, filed with session done, the board’s Complete work, or a commit’s Session-Done trailer.'
    }
    case 'triage': {
      return 'triage: it was filed from Triage with session archive, a candidate that was rejected.'
    }
    case 'design': {
      return 'design: it was filed from Design with session archive, while its design questions were still open.'
    }
    case 'batch': {
      return 'batch: it was filed from Batch with session archive, settled work that never ran.'
    }
    case 'queue': {
      return 'queue: it was filed from Queue with session archive, before its batch started.'
    }
    case 'execute': {
      return 'execute: it was filed from Execute with session archive, a started item that was abandoned.'
    }
    default: {
      return `${state}: the state the record’s file name gives.`
    }
  }
}

/** An item filed under `archive/`: its record as the listing reads its name, and the item as its text holds it. */
export type ArchivedItem = { readonly record: ArchiveRecord; readonly item: Item }

/**
 * An item's record under `archive/`, read as the item it was, or null when the
 * archive holds none. When it holds several, the one read is the one filed on
 * the latest day, as the day in each name gives it; names carry no time, so
 * two filed on the same day are told apart only by name. A record's text is
 * the item's file as it was filed, with the note of a commit that closed it at
 * the end, so its first line is the item's heading; a record edited by hand
 * past that is shown whole, under the title its name gives.
 */
export async function readArchivedItem({ board, id, signal }: {
  /** The board's prefix, whose session's archive is read. */
  readonly board: string
  readonly id: string
  readonly signal?: AbortSignal | undefined
}): Promise<ArchivedItem | null> {
  const { records } = await SessionApi.archive(board, signal)
  // The listing is newest day first, then by name.
  const record = records.find((candidate) => candidate.id === id)
  if (record === undefined) return null
  const text = (await SessionApi.file(board, record.path, signal)).replaceAll('\r\n', '\n')
  const heading = `## ${id} — `
  const [first = '', ...rest] = text.split('\n')
  const titled = first.startsWith(heading)
  return {
    record,
    item: {
      id,
      title: titled ? first.slice(heading.length).trim() : record.title ?? id,
      body: (titled ? rest.join('\n') : text).trim(),
      summary: '',
      group: null,
      path: record.path,
    },
  }
}
