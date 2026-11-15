/**
 * dsh-spss — the browser side of the HTTP contract.
 *
 * Every call goes to the host half's own routes under `/api/dsh-spss`, sits
 * behind the harness request fence, and answers JSON of the shape
 * `{ ok: boolean, ... }`. Nothing else here is assumed: a 404, an HTML error
 * page, a timeout, or an `ok:false` body all become one `ApiError` carrying a
 * message that can be shown to a person.
 */

/** Prefix shared by every route of the plugin. */
export const API_BASE = '/api/dsh-spss'

/** Longest a small request may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 20000
/**
 * The analysis run shells out to Python on a real dataset and the host caps it
 * at 300s; the browser waits longer than that so the host's own timeout, which
 * carries a real error message, is the one that wins.
 */
const RUN_TIMEOUT_MS = 330000

/** One failed call, with enough detail for an honest message. */
export class ApiError extends Error {
  /**
   * @param message - human-readable summary.
   * @param options - `{ status, code, body }`; status is 0 for a network failure.
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = typeof options.status === 'number' ? options.status : 0
    this.code = options.code ?? 'unknown'
    this.body = options.body ?? null
    /** True when the caller should offer a typed path instead. */
    this.unsupported = options.unsupported === true
    /** True when the person closed the native dialog; not an error to show. */
    this.cancelled = options.cancelled === true
  }
}

/**
 * Turn any thrown value into a short message.
 * @param error - whatever was thrown.
 * @param t - copy resolver, used for the fallback wording.
 */
export function describeError(error, t) {
  if (error === null || error === undefined) return t('error.title')
  if (error && typeof error === 'object') {
    if (error.code === 'network') return t('error.network')
    if (error.code === 'timeout') return t('error.network')
    const message = typeof error.message === 'string' ? error.message.trim() : ''
    if (message !== '') return message
  }
  const text = String(error)
  return text === '' || text === '[object Object]' ? t('error.title') : text
}

/**
 * One JSON call to the plugin's routes.
 *
 * A 2xx response is parsed as JSON; a body that is not JSON is reported as
 * such rather than swallowed. A non-2xx response is only parsed for its
 * `error` message, then thrown. `ok:false` in a 200 body is *not* thrown here —
 * the host reports crashes and unsupported capabilities that way and some
 * callers want to read the detail — it is returned to the caller.
 *
 * @param route - path below the prefix, e.g. `/status`.
 * @param options - `{ method, body, timeoutMs }`.
 * @returns The parsed body.
 */
export async function request(route, options = {}) {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller?.abort()
  }, timeoutMs)

  let response
  try {
    response = await fetch(`${API_BASE}${route}`, {
      method,
      signal: controller ? controller.signal : undefined,
      headers:
        options.body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    })
  } catch (error) {
    clearTimeout(timer)
    if (timedOut || error?.name === 'AbortError') {
      throw new ApiError('request timed out', { code: 'timeout' })
    }
    throw new ApiError('network request failed', { code: 'network' })
  }

  let text = ''
  try {
    text = await response.text()
  } catch {
    text = ''
  } finally {
    clearTimeout(timer)
  }

  let body = null
  let parsed = false
  if (text !== '') {
    try {
      body = JSON.parse(text)
      parsed = true
    } catch {
      parsed = false
    }
  }

  if (!response.ok) {
    const message =
      parsed && body && typeof body.error === 'string' && body.error !== ''
        ? body.error
        : `HTTP ${response.status}`
    throw new ApiError(message, {
      status: response.status,
      code: parsed ? 'http' : 'bad-json',
      body,
      unsupported: parsed && body?.unsupported === true,
      cancelled: parsed && body?.cancelled === true,
    })
  }

  if (!parsed) {
    throw new ApiError('response was not JSON', {
      status: response.status,
      code: 'bad-json',
      body: text === '' ? null : text.slice(0, 400),
    })
  }
  if (body === null || typeof body !== 'object') {
    throw new ApiError('response was not a JSON object', {
      status: response.status,
      code: 'bad-json',
      body,
    })
  }
  // The host reports an unsupported native picker and a closed dialog as
  // `ok:false` + 200; surface those flags on the error object the caller builds.
  return body
}

/** `ok:false` bodies are turned into thrown errors by callers that need that. */
export function assertOk(body, fallbackMessage) {
  if (body && body.ok === false) {
    throw new ApiError(
      typeof body.error === 'string' && body.error !== '' ? body.error : fallbackMessage,
      {
        status: 200,
        code: body.unsupported === true ? 'unsupported' : 'not-ok',
        body,
        unsupported: body.unsupported === true,
        cancelled: body.cancelled === true,
      },
    )
  }
  return body
}

/** `GET /status` — python probe, engine path, default output folder. */
export function fetchStatus() {
  return request('/status')
}

/**
 * `POST /pick` — the native open/save dialog on the host machine.
 * @param kind - 'open' | 'save'.
 * @param title - dialog title.
 * @param defaultName - suggested file name for a save dialog.
 * @returns `{ ok, path }`, or `{ ok:false, cancelled }`, or `{ ok:false, unsupported }`.
 */
export function pickPath({ kind, title, defaultName, filters }) {
  return request('/pick', {
    method: 'POST',
    body: { kind, title, defaultName, filters },
    // The dialog waits for a person; give it the same generous budget the host
    // uses before killing the chooser.
    timeoutMs: 190000,
  })
}

/** `POST /pick-dir` — the native folder chooser on the host machine. */
export function pickDirectory({ title } = {}) {
  return request('/pick-dir', {
    method: 'POST',
    body: { title },
    timeoutMs: 190000,
  })
}

/**
 * `POST /run` — run the statistics engine.
 * @param payload - `{ inputPath, variables, analyses, exports, outDir, outBaseName }`.
 */
export function runAnalysis(payload) {
  return request('/run', { method: 'POST', body: payload, timeoutMs: RUN_TIMEOUT_MS })
}

/** `POST /read-data` — variables and a preview of the first rows. */
export function readData({ path, sheet, csvOptions }) {
  return request('/read-data', {
    method: 'POST',
    body: { path, sheet, csvOptions },
    timeoutMs: 60000,
  })
}

/** `POST /open-path` — reveal a file or folder in Finder / Explorer. */
export function openPath(path) {
  return request('/open-path', { method: 'POST', body: { path } })
}

/** `GET /outputs` — files already in the default output folder. */
export function fetchOutputs() {
  return request('/outputs')
}
