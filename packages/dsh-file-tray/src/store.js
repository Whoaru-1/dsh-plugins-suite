/**
 * dsh-file-tray — the produced-files ledger.
 *
 * A module-level, per-Session record of every file the conversation wrote,
 * fed by the invisible turn-tail seat and read by the header tray. It is not a
 * store of the session model: it is a client-side accumulation whose lifetime
 * is the page.
 *
 * Ordering is by turn, then by first-seen order inside the turn: turns publish
 * in ascending order as the transcript materializes, and a late mount (an older
 * turn re-entering the window) inserts at its own position rather than at the
 * end. Reading is stable: `list` returns the same array instance until the
 * session actually changes, which is what `useSyncExternalStore` needs.
 */

/** One session's mutable ledger entry: records plus the path index. */
const sessions = new Map()

/** Change subscribers. */
const listeners = new Set()

/** Cached read snapshots per session, dropped when `revision` moves. */
const snapshots = new Map()

/** Bumped on every mutation, so the cached read snapshots can be invalidated. */
let revision = 0

/** Monotonic insertion token, so same-turn files keep their arrival order. */
let nextOrdinal = 1

/** The empty list every empty session shares. */
const EMPTY = Object.freeze([])

/**
 * One session's mutable ledger entry.
 * @param sessionId - the Session key.
 * @returns the existing or freshly created entry.
 */
function entryOf(sessionId) {
  let entry = sessions.get(sessionId)
  if (entry === undefined) {
    entry = { records: [], ordinals: new Map() }
    sessions.set(sessionId, entry)
  }
  return entry
}

/**
 * Total order over records: turn first, insertion token second.
 * @param a - one record.
 * @param b - another record.
 * @returns a negative, zero, or positive comparison result.
 */
function compareRecords(a, b) {
  if (a.turn !== b.turn) return a.turn - b.turn
  if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

/** Notify every subscriber; a throwing listener never blocks the others. */
function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener()
    } catch {
      // A broken surface must not break the ledger.
    }
  }
}

/**
 * Subscribe to ledger changes.
 * @param listener - called after every mutation.
 * @returns the unsubscribe function.
 */
export function subscribe(listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Record the files one closing turn produced.
 *
 * A path already in the ledger keeps its original position: a file written in
 * turn 2 and edited in turn 5 stays listed under turn 2. This is intentionally
 * the same de-duplication the built-in produced-files row applies per turn.
 * @param sessionId - the Session the turn belongs to.
 * @param turnNumber - the turn's ordinal, used for ordering.
 * @param seq - the closing assistant sequence, for latest-record bookkeeping.
 * @param paths - produced paths, oldest first.
 * @returns the number of paths newly added.
 */
export function recordProduced(sessionId, turnNumber, seq, paths) {
  if (typeof sessionId !== 'string' || sessionId === '') return 0
  if (!Array.isArray(paths) || paths.length === 0) return 0
  const entry = entryOf(sessionId)
  const turn = Number.isFinite(turnNumber) ? turnNumber : Number.MAX_SAFE_INTEGER
  const at = typeof seq === 'number' && Number.isFinite(seq) ? seq : 0
  const added = []
  for (const path of paths) {
    if (typeof path !== 'string' || path === '') continue
    if (entry.ordinals.has(path)) continue
    const ordinal = nextOrdinal
    nextOrdinal += 1
    entry.ordinals.set(path, ordinal)
    added.push({ path, turn, seq: at, at, ordinal })
  }
  if (added.length === 0) return 0
  entry.records.push(...added)
  entry.records.sort(compareRecords)
  revision += 1
  emit()
  return added.length
}

/**
 * The current ledger of one session, oldest turn first.
 * @param sessionId - the Session key.
 * @returns a stable array; the same instance until the ledger changes.
 */
export function list(sessionId) {
  const cached = snapshots.get(sessionId)
  if (cached !== undefined && cached.revision === revision) return cached.value
  const entry = sessions.get(sessionId)
  const value = entry === undefined || entry.records.length === 0 ? EMPTY : entry.records.slice()
  snapshots.set(sessionId, { revision, value })
  return value
}

/**
 * Forget one session's ledger; the tray's "clear" gesture.
 * @param sessionId - the Session key.
 * @returns `true` when anything was removed.
 */
export function clear(sessionId) {
  const entry = sessions.get(sessionId)
  if (entry === undefined || entry.records.length === 0) return false
  sessions.delete(sessionId)
  revision += 1
  emit()
  return true
}

/**
 * Test-only view of the internal state, so the offline harness can reset it.
 * @internal
 */
export const __internals = {
  sessions,
  snapshots,
  listeners,
  reset() {
    sessions.clear()
    snapshots.clear()
    listeners.clear()
    nextOrdinal = 1
    revision += 1
  },
}
