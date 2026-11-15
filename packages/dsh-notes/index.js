/**
 * dsh-notes — host half.
 *
 * The browser half owns the sticky-note wall; this half owns the one thing the
 * browser cannot own: a durable document on disk. Notes live in
 * `$DSH_HOME/dsh-notes/notes.json` and are served over an authenticated route
 * on the existing web server, so the same notes appear in Web and Desktop and
 * survive a cleared browser profile.
 *
 *   GET  /api/dsh-notes   → the saved list (used on panel open)
 *   POST /api/dsh-notes   → replace the list with `{ notes }` after validation
 *
 * The route sits behind the same fence as every other `/api` surface: the
 * Host/Origin check plus the browser-session cookie. The file is written with
 * an atomic rename and one previous copy is kept beside it as `notes.json.bak`.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-notes'

/** Largest accepted request body; the client caps one note well below this. */
const MAX_BODY_BYTES = 2 * 1024 * 1024
/** Largest accepted note text. */
const MAX_NOTE_CHARS = 20000
/** Largest accepted number of notes. */
const MAX_NOTES = 5000
/** The five paper colours the client can paint. */
const COLORS = new Set(['yellow', 'rose', 'sky', 'mint', 'lilac'])

/** The harness home directory, matching every other DSH component. */
export function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
}

/** Absolute path of the notes document. */
export function notesFile() {
  return path.join(dshHome(), 'dsh-notes', 'notes.json')
}

/**
 * Coerce one client note into the stored shape.
 * @param raw - untrusted value from the request body.
 * @param now - timestamp used for a missing or invalid date.
 * @returns A clean note, or null when the value cannot be a note.
 */
export function normalizeNote(raw, now = Date.now()) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text === '' || text.length > MAX_NOTE_CHARS) return null
  const id =
    typeof raw.id === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(raw.id)
      ? raw.id
      : randomUUID()
  const color = typeof raw.color === 'string' && COLORS.has(raw.color) ? raw.color : 'yellow'
  const createdAt = finiteTimestamp(raw.createdAt, now)
  // An update never predates the note it edits.
  const updatedAt = Math.max(finiteTimestamp(raw.updatedAt, createdAt), createdAt)
  return { id, text, color, createdAt, updatedAt }
}

/** Clamp a timestamp to a plausible millisecond date. */
function finiteTimestamp(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(parsed)) return fallback
  const now = Date.now()
  // Reject pre-2000 dates and dates further than a day into the future.
  if (parsed < 946684800000 || parsed > now + 86400000) return fallback
  return Math.round(parsed)
}

/**
 * Validate a whole `notes` array.
 * @param raw - untrusted value from the request body.
 * @returns `{ notes, rejected }`; later duplicate ids win.
 */
export function normalizeNotes(raw) {
  if (!Array.isArray(raw)) return { notes: [], rejected: 0 }
  const byId = new Map()
  let rejected = 0
  const now = Date.now()
  for (const value of raw.slice(0, MAX_NOTES)) {
    const note = normalizeNote(value, now)
    if (note === null) {
      rejected += 1
      continue
    }
    byId.set(note.id, note)
  }
  if (raw.length > MAX_NOTES) rejected += raw.length - MAX_NOTES
  return { notes: [...byId.values()], rejected }
}

/**
 * Read the document, falling back to its one previous copy.
 * @returns `{ notes, storage, savedAt, damaged }`.
 */
export async function readNotes() {
  const file = notesFile()
  const primary = await readDocument(file)
  if (primary !== null) {
    return {
      notes: primary.notes,
      storage: 'saved',
      savedAt: primary.savedAt,
      damaged: false,
    }
  }
  const backup = await readDocument(`${file}.bak`)
  if (backup !== null) {
    return {
      notes: backup.notes,
      storage: 'recovered',
      savedAt: backup.savedAt,
      damaged: true,
    }
  }
  return { notes: [], storage: 'empty', savedAt: null, damaged: false }
}

/** Parse one document file; null for a missing or unreadable file. */
async function readDocument(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(text)
    if (!Array.isArray(payload?.notes)) return null
    const { notes, rejected } = normalizeNotes(payload.notes)
    // A file whose whole list is unusable is damaged, not an empty notebook:
    // fall through to the backup instead of presenting (and later saving) zero.
    if (notes.length === 0 && rejected > 0) return null
    return {
      notes,
      savedAt: Number.isFinite(payload?.savedAt) ? payload.savedAt : null,
    }
  } catch {
    return null
  }
}

/**
 * Replace the document atomically, keeping the previous file as `.bak`.
 * @param notes - already normalized notes.
 * @returns The save timestamp.
 */
export async function writeNotes(notes) {
  const file = notesFile()
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const savedAt = Date.now()
  const body = `${JSON.stringify({ version: 1, savedAt, notes }, null, 2)}\n`
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600 })
  try {
    await copyFile(file, `${file}.bak`)
  } catch {
    // The first save has no previous document to keep.
  }
  await rename(temporary, file)
  return savedAt
}

/** Serialize writes so two overlapping saves cannot interleave. */
let writeChain = Promise.resolve()

/** Queue a write behind every earlier one, even if that one failed. */
function enqueueWrite(notes) {
  const next = writeChain.then(
    () => writeNotes(notes),
    () => writeNotes(notes),
  )
  writeChain = next.catch(() => {})
  return next
}

/** Send one JSON response. */
function respond(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** Read a request body as UTF-8, rejecting one above the byte cap. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`)
        error.code = 'too-large'
        reject(error)
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

/** Record that the running server mounted this row, for install diagnostics. */
function writeBootProof() {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    writeFileSync(
      path.join(home, 'dsh-notes.boot.json'),
      `${JSON.stringify(
        {
          plugin: name,
          pid: process.pid,
          mountedAt: new Date().toISOString(),
          node: process.version,
          route: '/api/dsh-notes',
          document: notesFile(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  } catch {
    // A missing proof only costs a diagnostic, never the plugin.
  }
}

/**
 * Mount the notes route.
 * @param ctx - host context; `webServer` and `connection` are required services.
 */
export function apply(ctx) {
  writeBootProof()
  ctx.inject(['webServer', 'connection'], (routeCtx) => {
    routeCtx.effect(() => {
      const dispose = routeCtx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-notes',
        handler: async (req, res) => {
          const rejection = routeCtx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }

          if (req.method === 'GET' || req.method === 'HEAD') {
            try {
              const snapshot = await readNotes()
              respond(res, 200, { ok: true, ...snapshot })
            } catch (error) {
              respond(res, 200, {
                ok: false,
                error: String(error?.message ?? error),
              })
            }
            return
          }

          if (req.method !== 'POST') {
            respond(res, 405, { ok: false, error: 'method not allowed' })
            return
          }

          let payload
          try {
            payload = JSON.parse(await readBody(req))
          } catch (error) {
            const status = error?.code === 'too-large' ? 413 : 400
            respond(res, status, {
              ok: false,
              error: status === 413 ? '便签内容过大' : '请求内容不是有效的 JSON',
            })
            return
          }

          if (!Array.isArray(payload?.notes)) {
            respond(res, 400, { ok: false, error: '请求缺少 notes 数组' })
            return
          }
          const { notes, rejected } = normalizeNotes(payload.notes)
          if (rejected > 0 && notes.length === 0) {
            respond(res, 400, { ok: false, error: '没有可保存的便签' })
            return
          }
          try {
            const savedAt = await enqueueWrite(notes)
            respond(res, 200, { ok: true, savedAt, notes, rejected })
          } catch (error) {
            respond(res, 500, {
              ok: false,
              error: String(error?.message ?? error),
            })
          }
        },
      })
      return dispose
    }, 'dsh-notes: /api/dsh-notes')
  })
}
