/**
 * dsh-notes — browser store.
 *
 * One module-level store holds the note list for the whole panel. The host file
 * is the source of truth; `localStorage` is an immediate cache so the wall is
 * visible before the first request settles, and a fallback when the host route
 * cannot be reached.
 *
 * Writes are coalesced: a burst of edits sends one list, and a mutation made
 * while a save is in flight is sent as the next batch, never dropped.
 */
import {
  createNote as buildNote,
  normalizeCachedNotes,
  sortNotes,
} from './model.js'

const CACHE_KEY = 'dsh-notes.cache.v1'
const SAVE_DELAY_MS = 220
const REQUEST_TIMEOUT_MS = 12000

const listeners = new Set()

let state = {
  phase: 'idle',
  hydrated: false,
  notes: [],
  persistence: 'host',
  save: 'idle',
  error: null,
  notice: null,
  lastSavedAt: null,
}

let started = false
let pending = null
let saveTimer = null
let saving = false

/** The current immutable snapshot. */
export function getState() {
  return state
}

/** Subscribe one React component; the first subscriber starts the load. */
export function subscribe(listener) {
  listeners.add(listener)
  if (!started) {
    started = true
    void bootstrap()
  }
  return () => {
    listeners.delete(listener)
  }
}

/** Replace the snapshot and notify every subscriber. */
function setState(patch) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

/** Read the browser cache, tolerating a cleared or disabled storage. */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    return normalizeCachedNotes(Array.isArray(parsed) ? parsed : parsed?.notes)
  } catch {
    return []
  }
}

/** Write the browser cache; a quota error must not break the panel. */
function writeCache(notes) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(notes))
  } catch {
    // The host file remains the durable copy.
  }
}

/** One authenticated JSON request to the notes route. */
async function request(method, payload) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch('/api/dsh-notes', {
      method,
      signal: controller.signal,
      headers:
        payload === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const text = await response.text()
    let body = null
    try {
      body = text === '' ? null : JSON.parse(text)
    } catch {
      body = null
    }
    if (!response.ok) {
      throw new Error(body?.error ?? `HTTP ${response.status}`)
    }
    if (body === null) throw new Error('便签服务返回了空响应')
    return body
  } finally {
    clearTimeout(timer)
  }
}

/** Load the host list, falling back to the cache. */
async function bootstrap() {
  const cached = readCache()
  if (cached.length > 0) {
    setState({ phase: 'ready', notes: cached, persistence: 'local' })
  }
  try {
    const body = await request('GET')
    if (!body.ok) throw new Error(body.error ?? '无法读取便签')
    const notes = normalizeCachedNotes(body.notes)
    if (notes.length === 0 && cached.length > 0 && body.storage === 'empty') {
      // A browser-only draft predates the host file; adopt it instead of
      // silently replacing it with an empty document.
      setState({
        phase: 'ready',
        hydrated: true,
        notes: sortNotes(cached),
        persistence: 'host',
        notice: null,
      })
      scheduleSave(cached)
      return
    }
    setState({
      phase: 'ready',
      hydrated: true,
      notes: sortNotes(notes),
      persistence: 'host',
      error: null,
      notice: body.damaged === true ? 'recovered' : null,
    })
    writeCache(notes)
  } catch (error) {
    setState({
      phase: 'ready',
      hydrated: true,
      notes: sortNotes(cached),
      persistence: 'local',
      error: errorMessage(error),
    })
  }
}

/** Send the latest list after a short quiet period. */
function scheduleSave(notes) {
  pending = notes
  setState({ save: 'saving' })
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flush()
  }, SAVE_DELAY_MS)
}

/** Drain every pending batch, newest snapshot last. */
async function flush() {
  if (saving) return
  saving = true
  try {
    while (pending !== null) {
      const batch = pending
      pending = null
      try {
        const body = await request('POST', { notes: batch })
        if (!body.ok) throw new Error(body.error ?? '保存失败')
        if (pending === null) {
          setState({
            save: 'saved',
            persistence: 'host',
            error: null,
            lastSavedAt: typeof body.savedAt === 'number' ? body.savedAt : Date.now(),
          })
        }
      } catch (error) {
        setState({
          save: 'error',
          persistence: 'local',
          error: errorMessage(error),
        })
        break
      }
    }
  } finally {
    saving = false
    if (pending !== null && state.save !== 'error') void flush()
  }
}

/** Commit a new list to the cache and queue the host save. */
function commit(notes) {
  const sorted = sortNotes(notes)
  writeCache(sorted)
  setState({ notes: sorted, save: 'saving' })
  scheduleSave(sorted)
}

/** Create a note and put it at the top of the wall. */
export function addNote(input) {
  const note = buildNote(input)
  commit([note, ...state.notes])
  return note
}

/** Change one note, keeping the day it was first written. */
export function editNote(id, patch) {
  const now = Date.now()
  commit(
    state.notes.map((note) =>
      note.id === id
        ? { ...note, ...patch, id: note.id, createdAt: note.createdAt, updatedAt: now }
        : note,
    ),
  )
}

/** Remove one note. */
export function removeNote(id) {
  commit(state.notes.filter((note) => note.id !== id))
}

/** Put a removed note back at its old position, for the undo toast. */
export function restoreNote(note, index) {
  if (state.notes.some((entry) => entry.id === note.id)) return
  const next = state.notes.slice()
  next.splice(Math.max(0, Math.min(index, next.length)), 0, note)
  commit(next)
}

/** Retry the last failed save with the current list. */
export function retrySave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  pending = state.notes
  setState({ save: 'saving', error: null })
  void flush()
}

/** Hide the recovered-file notice. */
export function dismissNotice() {
  setState({ notice: null })
}

/** Normalize an unknown thrown value into a short message. */
function errorMessage(error) {
  if (error?.name === 'AbortError') return '保存超时，请重试'
  return String(error?.message ?? error)
}

/** Offline harness surface. */
export const __test = {
  CACHE_KEY,
  getState,
  scheduleSave,
  setState,
  flush,
  reset() {
    started = false
    state = {
      phase: 'idle',
      hydrated: false,
      notes: [],
      persistence: 'host',
      save: 'idle',
      error: null,
      notice: null,
      lastSavedAt: null,
    }
    pending = null
    saveTimer = null
    saving = false
    listeners.clear()
  },
}
