/**
 * dsh-vocab-preview — client half.
 *
 * One turn-tail seat with no visible surface. When a closing turn has produced
 * or presented an HTML file that looks like a 剧有词 (series-vocab) learning
 * page, the seat opens it in the right-side document preview through the
 * `openFile` prop the turn-tail slot already hands every seat.
 *
 * The official preview plugin owns the rendering: it registers an `html`/`htm`
 * renderer that mounts the bytes in a sandboxed `allow-scripts` iframe, so the
 * page's study / recall / cloze / retry behaviour runs as authored. This plugin
 * only decides *when* to show it.
 *
 * Auto-open is deliberately scoped to production, never to reload: a key that
 * was already opened in this browser tab stays closed, so reloading while doing
 * unrelated work cannot resurrect an old study page.
 */
import { useEffect } from 'react'
import { OPEN_DEBOUNCE_MS, collectCandidates, isVocabPage, turnKey } from './match.js'

export const name = 'dsh-vocab-preview'

/** Services this client half depends on. */
export const inject = ['slots']

/** Per-tab record of keys already auto-opened, so a reload stays quiet. */
const STORAGE_PREFIX = 'dsh-vocab-preview:opened:'

/* ------------------------------------------------- once-only, debounced open */

/** Keys opened in this page load; the tab-wide store outlives a reload. */
const openedKeys = new Set()
/** Pending debounce, so the newest candidate wins a render burst. */
let pendingTimer = null

/** sessionStorage if the host exposes it; undefined when denied or absent. */
function tabStore() {
  try {
    const store = globalThis.sessionStorage
    return store === undefined || store === null ? undefined : store
  } catch {
    return undefined
  }
}

/** Whether this tab already auto-opened the key in an earlier page load. */
function wasOpenedHere(key) {
  const store = tabStore()
  if (store === undefined) return false
  try {
    return store.getItem(STORAGE_PREFIX + key) === '1'
  } catch {
    return false
  }
}

/** Record the key for this page load and every later reload of this tab. */
function rememberOpened(key) {
  openedKeys.add(key)
  const store = tabStore()
  if (store === undefined) return
  try {
    store.setItem(STORAGE_PREFIX + key, '1')
  } catch {
    // A denied or full store costs at most a repeat open after a reload.
  }
}

/**
 * Request one auto-open, at most once per key and never twice in a burst.
 *
 * The key is claimed before the debounce fires: when several turn tails mount
 * together (loading a session with prior decks) the newest candidate cancels
 * the older timer, so the preview settles on the latest page.
 * @param key - turn-scoped identity of the candidate.
 * @param path - the page to open.
 * @param openFile - the slot's file opener.
 */
function requestOpen(key, path, openFile) {
  if (openedKeys.has(key)) return
  if (wasOpenedHere(key)) {
    openedKeys.add(key)
    return
  }
  rememberOpened(key)
  if (pendingTimer !== null) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    try {
      openFile(path)
    } catch {
      // The preview owns its own failure surface; never break the chat view.
    }
  }, OPEN_DEBOUNCE_MS)
}

/* -------------------------------------------------------------- turn seat */

/**
 * Invisible turn-tail seat: opens the turn's newest 剧有词 page once.
 * @param props - turn-tail slot props (`turn`, `seq`, `openFile`).
 * @returns `null`; this seat contributes no DOM.
 */
export function VocabAutoPreview(props) {
  const turn = props?.turn
  const seq = props?.seq
  const openFile = props?.openFile
  const candidates = collectCandidates(turn, seq)
  const newest = candidates.length === 0 ? undefined : candidates[candidates.length - 1]
  const key = newest === undefined ? '' : `${turnKey(turn, seq)}::${newest}`

  useEffect(() => {
    if (key === '' || typeof openFile !== 'function') return
    requestOpen(key, newest, openFile)
  }, [key, newest, openFile])

  return null
}

/* ------------------------------------------------------------ plugin face */

/**
 * Register the turn-tail auto-preview seat.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        id: 'dsh-vocab-preview',
        order: 40,
      },
      VocabAutoPreview,
    ),
  )
}

/** Offline harness surface; the loader reads only `name`, `inject`, `apply`. */
export const __test = { isVocabPage, collectCandidates, turnKey, OPEN_DEBOUNCE_MS }
