/**
 * dsh-vocab-preview — pure candidate detection.
 *
 * No React, no cordis, no host imports: this module is the whole decision about
 * *which* produced file is a 剧有词 learning page, so the offline harness can
 * exercise it directly under plain Node.
 */

/** A learning page is HTML… */
const HTML_EXTENSION = /\.html?$/i
/** …whose path names the deck: 剧有词, its English slug, or its default folder. */
const VOCAB_HINT = /vocab|剧有词/i

/**
 * Whether a produced path is a 剧有词 learning page.
 * @param path - absolute or workspace-relative file path.
 * @returns `true` when the file is an HTML page whose path names the deck.
 */
export function isVocabPage(path) {
  return typeof path === 'string' && HTML_EXTENSION.test(path) && VOCAB_HINT.test(path)
}

/**
 * Read the turn's `deliverables` projection state.
 * @param turn - turn model carried by the turn-tail slot props.
 * @returns the projection state, or `undefined` when this turn has none.
 */
export function readDeliverables(turn) {
  const data = turn?.data
  if (data === undefined || data === null || typeof data.get !== 'function') return undefined
  const value = data.get('deliverables')
  return value === undefined || value === null ? undefined : value
}

/**
 * Collect this closing turn's 剧有词 pages, oldest first.
 *
 * Mirrors the official deliverables window: a produced path counts up to and
 * including the closing seq, while a presented declaration counts strictly
 * before it.
 * @param turn - turn model carried by the turn-tail slot props.
 * @param seq - closing assistant sequence, when known.
 * @returns matching paths, first-seen order, deduplicated.
 */
export function collectCandidates(turn, seq) {
  const data = readDeliverables(turn)
  if (data === undefined) return []
  const limit = typeof seq === 'number' ? seq : Number.POSITIVE_INFINITY
  const seen = new Set()
  const out = []
  const consider = (path, at, strict) => {
    if (typeof path !== 'string' || path === '') return
    if (typeof at === 'number') {
      if (at > limit) return
      if (strict && at >= limit) return
    }
    if (!isVocabPage(path)) return
    if (seen.has(path)) return
    seen.add(path)
    out.push(path)
  }
  for (const item of Array.isArray(data.produced) ? data.produced : []) {
    consider(item?.path, item?.seq, false)
  }
  for (const item of Array.isArray(data.presented) ? data.presented : []) {
    consider(item?.path, item?.seq, true)
  }
  return out
}

/**
 * Stable identity for one turn, used to key the once-only record.
 * @param turn - turn model carried by the turn-tail slot props.
 * @param seq - closing assistant sequence, when known.
 * @returns a key unique within the session view.
 */
export function turnKey(turn, seq) {
  if (typeof seq === 'number') return `seq:${seq}`
  const id = turn?.id ?? turn?.turn ?? turn?.index
  return id === undefined || id === null ? 'turn' : `turn:${String(id)}`
}

/** How long a newer candidate may supersede an older one before we open. */
export const OPEN_DEBOUNCE_MS = 250
