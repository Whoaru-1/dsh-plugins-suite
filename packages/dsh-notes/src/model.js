/**
 * dsh-notes — pure note model.
 *
 * Dates, grouping, colour names, and id generation live here so the React
 * surface can stay about rendering and the harness can test the rules without
 * a DOM.
 */

/** The five paper colours, in swatch order. */
export const COLORS = [
  { id: 'yellow', zh: '鹅黄', en: 'Butter' },
  { id: 'rose', zh: '浅粉', en: 'Rose' },
  { id: 'sky', zh: '天蓝', en: 'Sky' },
  { id: 'mint', zh: '薄荷', en: 'Mint' },
  { id: 'lilac', zh: '丁香', en: 'Lilac' },
]

/** Longest note the composer accepts; the host accepts more from other clients. */
export const MAX_TEXT = 5000

/** Longest note the reader keeps when it normalizes stored data. */
const MAX_STORED_TEXT = 20000

/** One local calendar day, as `YYYY-MM-DD`. */
export function dayKey(timestamp) {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** A stable-enough id for a note created in this browser. */
export function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // A non-secure context keeps the fallback below.
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Build one new note from composer input. */
export function createNote({ text, color }, now = Date.now()) {
  const clean = typeof text === 'string' ? text.trim() : ''
  return {
    id: newId(),
    text: clean,
    color: isColor(color) ? color : 'yellow',
    createdAt: now,
    updatedAt: now,
  }
}

/** Whether a value names one of the paper colours. */
export function isColor(value) {
  return COLORS.some((entry) => entry.id === value)
}

/** Clamp a timestamp to a plausible millisecond date. */
function timestamp(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < 946684800000 || parsed > Date.now() + 86400000) return fallback
  return Math.round(parsed)
}

/** Validate one note read back from the cache. */
export function normalizeCachedNote(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text === '') return null
  const createdAt = timestamp(raw.createdAt, Date.now())
  return {
    id:
      typeof raw.id === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(raw.id)
        ? raw.id
        : newId(),
    text: text.slice(0, MAX_STORED_TEXT),
    color: isColor(raw.color) ? raw.color : 'yellow',
    createdAt,
    updatedAt: Math.max(timestamp(raw.updatedAt, createdAt), createdAt),
  }
}

/** Validate a whole cached note list, dropping duplicates by id. */
export function normalizeCachedNotes(raw) {
  if (!Array.isArray(raw)) return []
  const byId = new Map()
  for (const value of raw) {
    const note = normalizeCachedNote(value)
    if (note !== null) byId.set(note.id, note)
  }
  return [...byId.values()]
}

/** Newest first, with a stable fallback for equal timestamps. */
export function sortNotes(notes) {
  return notes.slice().sort((left, right) => {
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
    return right.id.localeCompare(left.id)
  })
}

/**
 * Group notes by the local day they were written.
 * @param notes - notes in any order.
 * @param t - copy resolver for the day labels.
 * @param locale - BCP-47 locale used for the short date.
 * @param now - reference time, injectable for tests.
 * @returns Groups newest day first, notes newest first inside each group.
 */
export function groupNotes(notes, t, locale = 'zh-CN', now = Date.now()) {
  const groups = new Map()
  for (const note of sortNotes(normalizeCachedNotes(notes))) {
    const key = dayKey(note.createdAt)
    let group = groups.get(key)
    if (group === undefined) {
      group = { key, label: dayLabel(note.createdAt, t, locale, now), notes: [] }
      groups.set(key, group)
    }
    group.notes.push(note)
  }
  return [...groups.values()]
}

/** A human label for a note's day: 今天 · 11月4日, 昨天 · …, or 11月2日 周日. */
export function dayLabel(timestamp, t, locale = 'zh-CN', now = Date.now()) {
  const date = new Date(timestamp)
  const reference = new Date(now)
  const start = (value) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((start(reference) - start(date)) / 86400000)
  const sameYear = date.getFullYear() === reference.getFullYear()
  const dateText = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
  if (days === 0) return `${t('dayToday')} · ${dateText}`
  if (days === 1) return `${t('dayYesterday')} · ${dateText}`
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  return `${dateText} ${weekday}`
}

/** Short clock time for a note footer. */
export function formatTime(timestamp, locale = 'zh-CN') {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestamp))
  } catch {
    return ''
  }
}

/** Count notes written today, for the heading's quiet subtitle. */
export function countToday(notes, now = Date.now()) {
  const today = dayKey(now)
  return notes.filter((note) => dayKey(note.createdAt) === today).length
}
