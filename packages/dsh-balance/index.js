/**
 * dsh-balance — host half.
 *
 * The browser must never see the provider API key, so this half owns the only
 * outbound call: it reads the DeepSeek key the harness already stores for the
 * `deepseek-official` provider and serves a small normalized snapshot over an
 * authenticated route on the existing web server.
 *
 *   GET /api/balance          → cached snapshot (stale-while-revalidate)
 *   GET /api/balance?force=1  → refresh regardless of the cache age
 *
 * The route sits behind the same fence as every other `/api` surface: the
 * Host/Origin check plus the browser-session cookie
 * (`ctx.connection.requestRejection`). The key is read per request from
 * `$DSH_HOME/.credentials.yaml` so rotating it needs no restart, and it is
 * never echoed in any response.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-balance'

/** Balance snapshots are cached this long; the browser may also force a refresh. */
const CACHE_TTL_MS = 5 * 60 * 1000
/** A failed lookup is cached briefly so a broken key cannot hammer the provider. */
const ERROR_TTL_MS = 30 * 1000
const REQUEST_TIMEOUT_MS = 15 * 1000
const MAX_HISTORY = 720

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** The harness home directory, matching every other DSH component. */
function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
}

/**
 * Read one credential from the harness credential store.
 *
 * The file is a small YAML document whose `refs` mapping holds literal
 * `${ENV_NAME}: ${VALUE}` entries. Only `refs` is parsed, and only the single
 * requested name, so a value may contain any character that YAML itself does
 * not terminate.
 * @param refName - Environment-style credential name, e.g. `DEEPSEEK_API_KEY`.
 * @returns The credential string, or undefined when it is absent.
 */
function readCredential(refName) {
  let text
  try {
    text = readFileSync(path.join(dshHome(), '.credentials.yaml'), 'utf8')
  } catch {
    return undefined
  }
  const lines = text.split(/\r?\n/)
  let inRefs = false
  let refsIndent = -1
  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    const body = line.trim()
    if (!inRefs) {
      if (/^refs\s*:/.test(body)) {
        inRefs = true
        refsIndent = indent
      }
      continue
    }
    // A non-indented line ends the `refs` block.
    if (indent <= refsIndent) return undefined
    const match = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(body)
    if (match === null || match[1] !== refName) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    return value === '' ? undefined : value
  }
  return undefined
}

/** One normalized balance figure. */
function parseAmount(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Ask the provider for the current balance.
 * @param apiKey - Bearer credential.
 * @returns The normalized payload, including `balanceInfos` rows.
 */
async function fetchBalance(apiKey) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(BALANCE_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      // The provider answers 401 with a JSON error body; surface it readably.
      let detail = text.slice(0, 300)
      try {
        const parsed = JSON.parse(text)
        detail = parsed?.error?.message ?? parsed?.message ?? detail
      } catch {
        // Non-JSON body: keep the raw slice.
      }
      throw new Error(`HTTP ${response.status}: ${detail}`)
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error('balance endpoint returned a non-JSON body')
    }
    const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
    return {
      isAvailable: payload?.is_available === true,
      balanceInfos: infos.map((info) => ({
        currency: String(info?.currency ?? ''),
        totalBalance: parseAmount(info?.total_balance),
        grantedBalance: parseAmount(info?.granted_balance),
        toppedUpBalance: parseAmount(info?.topped_up_balance),
      })),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Compose one cache entry from a live lookup, recording the history point. */
async function loadSnapshot(apiKey, history) {
  const now = Date.now()
  try {
    const data = await fetchBalance(apiKey)
    const primary = data.balanceInfos[0]
    if (primary !== undefined && primary.totalBalance !== null) {
      history.push({ at: now, currency: primary.currency, total: primary.totalBalance })
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
    }
    // Flat envelope: the client reads `isAvailable` / `balanceInfos` at the top
    // level, exactly like the error branch's `error`, so the payload must not be
    // nested under a `data` key.
    return { ok: true, at: now, ...data, history: history.slice() }
  } catch (error) {
    return {
      ok: false,
      at: now,
      error: String(error?.message ?? error),
      history: history.slice(),
    }
  }
}

/**
 * Mount the balance route.
 * @param ctx - host context; `webServer` and `connection` are required services.
 */
export function apply(ctx) {
  /** Latest settled lookup. `null` until the first request. */
  let cache = null
  /** In-flight lookup, so concurrent requests share one provider call. */
  const history = []

  const readKey = () =>
    process.env.DEEPSEEK_API_KEY?.trim() || readCredential('DEEPSEEK_API_KEY')

  /** Resolve a snapshot, refreshing when stale. `force` bypasses the TTL. */
  async function snapshot(force) {
    const ttl = cache !== null && cache.ok === false ? ERROR_TTL_MS : CACHE_TTL_MS
    const fresh = cache !== null && Date.now() - cache.at < ttl
    if (fresh && force !== true) return cache
    if (inflight !== null) return inflight
    const apiKey = readKey()
    if (apiKey === undefined) {
      cache = {
        ok: false,
        at: Date.now(),
        error: 'no DEEPSEEK_API_KEY in the harness credential store',
        history: history.slice(),
      }
      return cache
    }
    inflight = loadSnapshot(apiKey, history)
      .then((next) => {
        cache = next
        return next
      })
      .finally(() => {
        inflight = null
      })
    // A stale entry still beats an empty panel: serve it while refreshing.
    if (fresh && force === true) return cache
    return inflight
  }
  let inflight = null

  const respond = (res, status, body) => {
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(text),
    })
    res.end(text)
  }

  ctx.inject(['webServer', 'connection'], (routeCtx) => {
    routeCtx.effect(() => {
      const dispose = routeCtx.webServer.register({
        kind: 'exact',
        path: '/api/balance',
        handler: async (req, res) => {
          const rejection = routeCtx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            respond(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          let force = false
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            force = url.searchParams.get('force') === '1'
          } catch {
            // A malformed URL simply is not a forced refresh.
          }
          try {
            const result = await snapshot(force)
            respond(res, 200, result)
          } catch (error) {
            respond(res, 200, {
              ok: false,
              at: Date.now(),
              error: String(error?.message ?? error),
              history: history.slice(),
            })
          }
        },
      })
      return dispose
    }, 'dsh-balance: /api/balance')
  })
}
