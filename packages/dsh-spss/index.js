/**
 * dsh-spss — host half.
 *
 * The browser half (`./client.js`) owns the SPSS-style analysis panel; this
 * half owns the two things a browser cannot do: **choose paths on this
 * computer** and **run the analysis engine on this machine**.
 *
 * Routes (all under `/api/dsh-spss`, all behind the same Host/Origin +
 * session-cookie fence as every other `/api` surface):
 *
 *   GET  /api/dsh-spss/status      interpreter, engine, optional packages, dirs
 *   POST /api/dsh-spss/pick        native OPEN / SAVE dialog → { ok, path }
 *   POST /api/dsh-spss/pick-dir    native FOLDER dialog     → { ok, path }
 *   POST /api/dsh-spss/run         run engine/analyze.py, return its result
 *   POST /api/dsh-spss/open-path   reveal a file/folder in Finder / Explorer
 *   POST /api/dsh-spss/read-data   dataset preview (variables + first rows)
 *   GET  /api/dsh-spss/outputs     recent result files in the outputs dir
 *
 * Tools: `spss_analyze` and `spss_list_outputs`, sharing the exact same
 * operations the routes use.
 *
 * Security model: request paths are untrusted. They are validated (absolute,
 * no NUL byte, bounded length) and then handed to `execFile`/`spawn` as
 * **argv elements**. No request value is ever concatenated into a shell command
 * anywhere in this plugin — see `engine-bridge.js`, which owns every child
 * process and always kills with SIGKILL after a timeout.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MAX_BODY_BYTES,
  PICK_TIMEOUT_MS,
  defaultOutputsDir,
  enginePath,
  expandHome,
  listOutputs,
  normalizeFilters,
  pickNativePath,
  readDataPreview,
  resolveOutputsDir,
  resolvePython,
  resetPythonCache,
  revealPath,
  runEngine,
  safePath,
  sanitizeFileName,
  probeModules,
} from './engine-bridge.js'

// TEMPORARY DIAGNOSTIC — proves whether the host ever imported this module.
try {
  writeFileSync(
    path.join(process.env.DSH_HOME || path.join(process.env.HOME, '.dsh'), 'dsh-spss.import.json'),
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, node: process.version, cwd: process.cwd() }, null, 2),
  )
} catch {}

export const name = 'dsh-spss'

/** This bundle's own directory, so the engine resolves when installed from a path. */
export const bundleDir = path.dirname(fileURLToPath(import.meta.url))

/** The single prefix every route of this plugin lives under. */
export const MOUNT_PATH = '/api/dsh-spss'

/** Config defaults; also what a row with no `config` block gets. */
const DEFAULTS = Object.freeze({
  pythonPath: '',
  timeoutMs: 300_000,
  outputsDir: '',
  allowNativePicker: true,
})

/** Largest accepted filter table / analysis count, to bound one request. */
const MAX_ANALYSES = 60
const MAX_VARIABLES = 400

/*
 * No `Config` export on purpose.
 *
 * The Loader treats an exported `Config` as a Schemastery schema and calls
 * `.validate()` on it during activation. This plugin's schema is a plain object
 * and this profile cannot resolve `@deepseek-ai/schemastery` from the bundle
 * directory, so exporting one makes activation fail with
 * "Cannot read properties of undefined (reading 'validate')".
 *
 * `readConfig()` below is the single source of truth instead: it accepts the
 * row's `config` map as-is, applies the same defaults documented in
 * `cordis.patch.yml`, and tolerates a missing or malformed block.
 */

/**
 * Normalise the plugin config, tolerating a missing or malformed block.
 * @param {unknown} raw - `config` as the loader supplied it
 * @returns {{ pythonPath: string, timeoutMs: number, outputsDir: string, allowNativePicker: boolean }}
 */
export function readConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const pythonPath = typeof source.pythonPath === 'string' ? source.pythonPath.trim() : DEFAULTS.pythonPath
  const timeoutRaw = Number(source.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 1_000 ? Math.min(timeoutRaw, 3_600_000) : DEFAULTS.timeoutMs
  const outputsDir = typeof source.outputsDir === 'string' ? source.outputsDir.trim() : DEFAULTS.outputsDir
  const allowNativePicker = typeof source.allowNativePicker === 'boolean' ? source.allowNativePicker : DEFAULTS.allowNativePicker
  return { pythonPath, timeoutMs, outputsDir, allowNativePicker }
}

/**
 * A short, filesystem-safe base name for a result set.
 * @param {unknown} value - untrusted `outBaseName`
 * @returns {string} a base name without an extension, never empty
 */
export function resultBaseName(value) {
  const cleaned = sanitizeFileName(typeof value === 'string' ? value : '')
  if (cleaned === '') return `spss-${new Date().toISOString().replace(/[:.]/g, '-')}`
  // A submitted base name keeps its own dots but loses any extension the
  // engine would otherwise double up on (`outBaseName: 'a.csv'` → `a`).
  return cleaned.replace(/\.(csv|xlsx|docx|png|json|sav)$/i, '') || cleaned
}

/**
 * Normalise the caller's `analyses` list into the engine's shape.
 *
 * Each entry is `{ type, variables, groupBy }`; an unknown or empty `type` is
 * dropped rather than passed through, so the engine never receives a request
 * shape it did not advertise.
 *
 * @param {unknown} raw - untrusted request value
 * @returns {{ ok: boolean, analyses: object[], error?: string }}
 */
export function normalizeAnalyses(raw) {
  if (!Array.isArray(raw)) return { ok: false, analyses: [], error: '`analyses` must be an array' }
  if (raw.length > MAX_ANALYSES) return { ok: false, analyses: [], error: `at most ${MAX_ANALYSES} analyses per run` }
  const analyses = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const type = typeof entry.type === 'string' ? entry.type.trim() : ''
    if (type === '') continue
    const variables = normalizeVariableList(entry.variables)
    const groupBy = entry.groupBy === undefined || entry.groupBy === null || entry.groupBy === ''
      ? undefined
      : (typeof entry.groupBy === 'string' ? entry.groupBy.trim() : String(entry.groupBy)).slice(0, 200)
    const analysis = { type: type.slice(0, 80), variables }
    if (groupBy !== undefined && groupBy !== '') analysis.groupBy = groupBy
    for (const key of ['options', 'test', 'correlation', 'method']) {
      if (entry[key] !== undefined && entry[key] !== null && typeof entry[key] !== 'function') analysis[key] = entry[key]
    }
    analyses.push(analysis)
  }
  if (analyses.length === 0) return { ok: false, analyses: [], error: 'no usable analysis was given (each needs a `type`)' }
  return { ok: true, analyses }
}

/** Normalise a variable list to trimmed, bounded strings. */
function normalizeVariableList(raw) {
  if (!Array.isArray(raw)) return []
  return [...new Set(
    raw
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value !== '')
      .slice(0, MAX_VARIABLES),
  )]
}

/** Normalise the requested export formats. */
export function normalizeExports(raw) {
  const allowed = new Set(['csv', 'xlsx', 'docx', 'png', 'json', 'sav'])
  if (!Array.isArray(raw)) return [...allowed].filter((ext) => ext !== 'sav')
  const wanted = raw
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim().toLowerCase().replace(/^\./, ''))
    .filter((value) => allowed.has(value))
  return [...new Set(wanted.length === 0 ? ['csv', 'xlsx', 'json'] : wanted)]
}

/**
 * One analysis run, shared by the `/run` route and the `spss_analyze` tool.
 *
 * @param {object} params
 * @param {{ pythonPath: string, timeoutMs: number, outputsDir: string }} params.config - resolved config
 * @param {unknown} params.body - untrusted request/tool arguments
 * @returns {Promise<object>} the engine result, or `{ ok:false, error }`
 */
export async function performRun({ config, body }) {
  const source = body !== null && typeof body === 'object' ? body : {}
  const inputPath = safePath(source.inputPath ?? source.path)
  if (inputPath === null) return { ok: false, error: '`inputPath` must be a non-empty absolute path without NUL bytes' }

  const analysesCheck = normalizeAnalyses(source.analyses)
  if (!analysesCheck.ok) return { ok: false, error: analysesCheck.error }

  const outDir = safePath(source.outDir) ?? config.outputsDir
  const outBaseName = resultBaseName(source.outBaseName)

  const python = await resolvePython(config.pythonPath)
  if (!python.ok) {
    return {
      ok: false,
      error: 'no Python 3 interpreter was found; set `pythonPath` in the dsh-spss config or DSH_SPSS_PYTHON',
      tried: python.tried,
    }
  }

  // The engine receives only paths the Host already validated, plus the
  // normalised analysis list. It runs in its own temp cwd (engine-bridge).
  const payload = {
    ...source,
    inputPath,
    outDir,
    outBaseName,
    analyses: analysesCheck.analyses,
    exports: normalizeExports(source.exports),
    pythonPath: python.executable === '' ? python.path : python.executable,
  }
  return runEngine({
    pythonPath: python.path,
    engine: enginePath(bundleDir),
    payload,
    timeoutMs: config.timeoutMs,
  })
}

/**
 * List recent result files, shared by the `/outputs` route and the
 * `spss_list_outputs` tool.
 * @param {{ config: { outputsDir: string }, dir?: unknown, limit?: unknown }} params
 * @returns {Promise<object>} `{ ok, dir, files }`
 */
export async function performListOutputs({ config, dir, limit }) {
  const resolved = safePath(dir) ?? config.outputsDir
  const capped = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 500) : 200
  return listOutputs(resolved, { limit: capped })
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

/**
 * Parse a JSON body, tolerating an empty one (POSTs whose defaults are enough).
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<{ ok: boolean, value: object, error?: string, status?: number }>}
 */
async function readJsonBody(req) {
  let text
  try {
    text = await readBody(req)
  } catch (error) {
    const tooLarge = error?.code === 'too-large'
    return { ok: false, value: {}, status: tooLarge ? 413 : 400, error: tooLarge ? '请求内容过大' : 'could not read the request body' }
  }
  if (text.trim() === '') return { ok: true, value: {} }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, value: {}, status: 400, error: '请求内容必须是 JSON 对象' }
    }
    return { ok: true, value: parsed }
  } catch {
    return { ok: false, value: {}, status: 400, error: '请求内容不是有效的 JSON' }
  }
}

/** The pickle map for a picker request body. */
function pickerRequest(body, kind) {
  const filters = normalizeFilters(body.filters)
  return {
    kind,
    prompt: typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim().slice(0, 200) : undefined,
    defaultName: typeof body.defaultName === 'string' ? body.defaultName : '',
    filters,
    defaultLocation: typeof body.defaultDir === 'string' ? body.defaultDir : undefined,
    timeoutMs: PICK_TIMEOUT_MS,
  }
}

/**
 * Mount the plugin: routes, tools, and a boot proof.
 * @param {object} ctx - host plugin context
 */
export function apply(ctx) {
  // TEMPORARY DIAGNOSTIC — records that apply ran and any error it threw.
  try {
    writeFileSync(
      path.join(process.env.DSH_HOME || path.join(process.env.HOME, '.dsh'), 'dsh-spss.apply.json'),
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid, hasInject: typeof ctx?.inject }, null, 2),
    )
  } catch {}
  const DIAG = (step, extra) => {
    try {
      writeFileSync(
        path.join(process.env.DSH_HOME || path.join(process.env.HOME, '.dsh'), 'dsh-spss.trace.json'),
        JSON.stringify({ at: new Date().toISOString(), pid: process.pid, step, ...extra }, null, 2),
      )
    } catch {}
  }
  DIAG('config.start')
  const config = readConfig(ctx?.config)
  DIAG('config.done', { config })
  try {
    mkdirSync(path.dirname(path.join(defaultOutputsDir())), { recursive: true })
  } catch {
    // A read-only home only costs the first export, not the plugin.
  }
  DIAG('mkdir.done')
  try {
    writeBootProof(config)
    DIAG('bootproof.done')
  } catch (e) {
    DIAG('bootproof.failed', { error: String(e?.message ?? e) })
  }

  DIAG('inject.start', { services: typeof ctx.inject })
  ctx.inject(['webServer', 'connection'], (routeCtx) => {
    DIAG('inject.callback', { hasWebServer: typeof routeCtx?.webServer, hasConnection: typeof routeCtx?.connection })
    routeCtx.effect(() => {
      DIAG('register.start')
      const dispose = routeCtx.webServer.register({
        kind: 'prefix',
        path: MOUNT_PATH,
        handler: async (req, res) => {
          const rejection = routeCtx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          try {
            await handleRoute(req, res, config)
          } catch (error) {
            respond(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      })
      DIAG('register.done', { kind: 'prefix', path: MOUNT_PATH })
      return dispose
    }, 'dsh-spss: /api/dsh-spss/*')
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => registerTools(toolCtx, config), 'dsh-spss: tools')
  })
}

/**
 * Reduce a request address to the tail this plugin routes on.
 *
 * A prefix registration may hand over either the full address
 * (`/api/dsh-spss/status`) or the remainder after the mount point
 * (`/status`). Query strings, fragments, and trailing slashes are removed, and
 * the mount prefix is stripped when present, so both shapes route identically.
 *
 * @param {unknown} url - `req.url` as received
 * @returns {string} the tail, always beginning with `/` (may be `/`)
 */
export function routeTail(url) {
  const raw = typeof url === 'string' ? url : ''
  let pathname = raw.split('?')[0].split('#')[0]
  // Collapse duplicate slashes and drop any trailing slash, so `/status/` and
  // `//status` both read as `/status`.
  pathname = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  if (pathname === MOUNT_PATH) return '/'
  if (pathname.startsWith(`${MOUNT_PATH}/`)) return pathname.slice(MOUNT_PATH.length)
  return pathname === '' ? '/' : pathname
}

/**
 * Dispatch one request under `/api/dsh-spss`.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ pythonPath: string, timeoutMs: number, outputsDir: string, allowNativePicker: boolean }} config
 */
async function handleRoute(req, res, config) {
  // A `kind: 'prefix'` registration hands the handler the address *after* the
  // registered prefix, so the same request can arrive as `/status` or as
  // `/api/dsh-spss/status` depending on how the host strips the mount point.
  // Normalise both to the routed tail so neither shape can silently fall
  // through to the 404 below.
  const rawUrl = typeof req.url === 'string' ? req.url : ''
  const pathname = routeTail(rawUrl)
  const method = req.method === 'HEAD' ? 'GET' : req.method
  const outputsDir = config.outputsDir

  if (pathname === '/status') {
    if (method !== 'GET') return respond(res, 405, { ok: false, error: 'method not allowed' })
    return respond(res, 200, await buildStatus(config, outputsDir))
  }

  if (pathname === '/outputs') {
    if (method !== 'GET') return respond(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(rawUrl, 'http://localhost')
    const listed = await performListOutputs({
      config: { outputsDir },
      dir: url.searchParams.get('dir') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })
    return respond(res, 200, listed)
  }

  if (pathname === '/pick' || pathname === '/pick-dir') {
    if (method !== 'POST') return respond(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJsonBody(req)
    if (!body.ok) return respond(res, body.status ?? 400, { ok: false, error: body.error })
    return respond(res, 200, await handlePick(pathname.endsWith('/pick-dir') ? 'folder' : undefined, body.value, config))
  }

  if (pathname === '/run') {
    if (method !== 'POST') return respond(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJsonBody(req)
    if (!body.ok) return respond(res, body.status ?? 400, { ok: false, error: body.error })
    const result = await performRun({ config, body: body.value })
    // A failed analysis is still a well-formed answer to the caller (§ the UI
    // renders `ok:false`), not an HTTP error.
    return respond(res, 200, result)
  }

  if (pathname === '/open-path') {
    if (method !== 'POST') return respond(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJsonBody(req)
    if (!body.ok) return respond(res, body.status ?? 400, { ok: false, error: body.error })
    const target = safePath(body.value.path ?? body.value.target)
    if (target === null) return respond(res, 400, { ok: false, error: '`path` must be a non-empty absolute path without NUL bytes' })
    return respond(res, 200, await revealPath(target))
  }

  if (pathname === '/read-data') {
    if (method !== 'POST') return respond(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJsonBody(req)
    if (!body.ok) return respond(res, body.status ?? 400, { ok: false, error: body.error })
    const source = safePath(body.value.path ?? body.value.inputPath)
    if (source === null) return respond(res, 400, { ok: false, error: '`path` must be a non-empty absolute path without NUL bytes' })
    const python = await resolvePython(config.pythonPath)
    if (!python.ok) {
      return respond(res, 200, {
        ok: false,
        error: 'no Python 3 interpreter was found; set `pythonPath` in the dsh-spss config or DSH_SPSS_PYTHON',
        tried: python.tried,
      })
    }
    const preview = await readDataPreview({
      pythonPath: python.path,
      path: source,
      sheet: body.value.sheet,
      csvOptions: body.value.csvOptions,
      limit: 50,
      timeoutMs: Math.min(config.timeoutMs, 120_000),
    })
    return respond(res, 200, preview)
  }

  return respond(res, 404, { ok: false, error: `unknown dsh-spss route: ${rawUrl}` })
}

/**
 * The picker routes: capability gate, then the native dialog.
 * @param {'open'|'save'|'folder'|undefined} forcedKind - set for `/pick-dir`
 * @param {object} body - the request body
 * @param {{ allowNativePicker: boolean }} config
 */
async function handlePick(forcedKind, body, config) {
  if (!config.allowNativePicker) {
    return {
      ok: false,
      unsupported: true,
      error: 'the native file picker is disabled in this plugin’s config (`allowNativePicker: false`)',
      hint: 'Type the path into the path field instead.',
    }
  }
  const requested = typeof body.kind === 'string' ? body.kind.trim().toLowerCase() : ''
  const kind = forcedKind ?? (requested === 'save' ? 'save' : 'open')
  if (forcedKind === undefined && requested !== '' && requested !== 'open' && requested !== 'save') {
    return { ok: false, error: '`kind` must be "open" or "save"' }
  }
  const result = await pickNativePath(kind, pickerRequest(body, kind))
  // The save panel cannot filter by type, so a missing/foreign extension is
  // completed here (engine-bridge.finishPick). Report the dialog kind back for
  // the UI's own bookkeeping.
  return { ...result, kind }
}

/**
 * The `/status` payload. Everything here is expanded and absolute — the UI can
 * pre-fill its path fields straight from this response.
 * @param {{ pythonPath: string, timeoutMs: number, outputsDir: string, allowNativePicker: boolean }} config
 * @param {string} outputsDirRaw - `config.outputsDir` (may be empty)
 */
async function buildStatus(config, outputsDirRaw) {
  const engine = enginePath(bundleDir)
  const python = await resolvePython(config.pythonPath)
  const modules = python.ok ? await probeModules(python.path, ['pyreadstat', 'scipy', 'pandas', 'numpy', 'docx', 'matplotlib']) : {}
  return {
    ok: true,
    python: {
      path: python.path,
      executable: python.executable,
      version: python.version,
      ok: python.ok,
      tried: python.tried,
    },
    enginePath: engine,
    engineExists: engineCheck(engine),
    hasPyreadstat: modules.pyreadstat === true,
    hasScipy: modules.scipy === true,
    hasPandas: modules.pandas === true,
    hasNumpy: modules.numpy === true,
    hasDocx: modules.docx === true,
    hasMatplotlib: modules.matplotlib === true,
    homeDir: expandHome('~') ?? '',
    outputsDir: resolveOutputsDir(outputsDirRaw),
    defaultOutBaseName: `spss-${new Date().toISOString().slice(0, 10)}`,
    platform: process.platform,
    arch: process.arch,
    picker: pickerStatus(config),
    config: {
      pythonPath: config.pythonPath,
      timeoutMs: config.timeoutMs,
      allowNativePicker: config.allowNativePicker,
      outputsDirConfigured: outputsDirRaw,
    },
    pluginDir: bundleDir,
    version: '1.0.0',
  }
}

/** Is the engine file present? (Never throws.) */
function engineCheck(engine) {
  try {
    return typeof engine === 'string' && engine !== '' && existsSync(engine)
  } catch {
    return false
  }
}

/**
 * What the UI should expect from the picker right now.
 *
 * `available:false` is a *normal* answer (headless session, `DSH_SPSS_PICKER=off`,
 * picker disabled in config): the panel then relies on its typed path field and
 * never hangs waiting for a dialog.
 * @param {{ allowNativePicker: boolean }} config
 */
export function pickerStatus(config) {
  const forcedOff = String(process.env.DSH_SPSS_PICKER ?? '').trim().toLowerCase() === 'off'
  if (!config.allowNativePicker) {
    return { available: false, reason: 'disabled by config (allowNativePicker: false)', hint: 'Type the path into the path field.' }
  }
  if (forcedOff) {
    return { available: false, reason: 'DSH_SPSS_PICKER=off', hint: 'Type the path into the path field.' }
  }
  if (process.platform === 'darwin') return { available: true, tool: 'osascript', hint: 'A native macOS panel opens on this computer.' }
  if (process.platform === 'win32') return { available: true, tool: 'powershell', hint: 'A native Windows dialog opens on this computer.' }
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  return hasDisplay
    ? { available: true, tool: 'zenity', hint: 'A native GTK dialog opens on this computer.' }
    : { available: false, reason: 'no DISPLAY in this session (headless Host)', hint: 'Type the path into the path field.' }
}

/**
 * Register the two model-facing tools.
 * @param {object} ctx - context carrying `tools`
 * @param {{ pythonPath: string, timeoutMs: number, outputsDir: string }} config
 * @returns {() => void} disposer
 */
function registerTools(ctx, config) {
  const disposers = []

  disposers.push(ctx.tools.register({
    name: 'spss_analyze',
    description:
      'Run an SPSS-style statistical analysis on a local data file (.sav/.zsav/.csv/.xlsx/.dta) and write the requested result files (csv, xlsx, docx, png, json, sav) to a chosen folder on this computer. '
      + 'Use this whenever the user asks for statistical analysis of a dataset — descriptives, frequencies, crosstabs, t-test, ANOVA, correlation, regression. '
      + 'Ask the user (or use the dsh-spss panel with its native file pickers) for the input path and the output folder; both are real paths on this machine. '
      + 'Returns the engine result verbatim plus the absolute paths that were written.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inputPath: { type: 'string', description: 'Absolute path of the data file on this computer.' },
        variables: { type: 'array', items: { type: 'string' }, description: 'Variable names to analyse. Empty means every variable for descriptive analyses.' },
        analyses: {
          type: 'array',
          description: 'The analyses to run, in order.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', description: 'Analysis name, e.g. descriptives, frequencies, crosstabs, ttest, anova, correlation, regression.' },
              variables: { type: 'array', items: { type: 'string' }, description: 'Variables this analysis uses.' },
              groupBy: { type: 'string', description: 'Optional grouping variable.' },
            },
            required: ['type'],
          },
        },
        exports: {
          type: 'array',
          description: 'Output formats to write. Defaults to csv, xlsx and json.',
          items: { type: 'string', enum: ['csv', 'xlsx', 'docx', 'png', 'json', 'sav'] },
        },
        outDir: { type: 'string', description: 'Absolute output folder. Defaults to the plugin outputs folder.' },
        outBaseName: { type: 'string', description: 'Base name for the written files (no folder, no extension).' },
      },
      required: ['inputPath', 'analyses'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
        },
      },
      render: (args, value) => [
        {
          type: 'text',
          text: typeof value?.summary === 'string' && value.summary.trim() !== ''
            ? value.summary
            : `spss_analyze ${String(args?.inputPath ?? '')} → ${value?.ok === true ? 'done' : 'failed'}`,
        },
      ],
    },
    execute: async (args) => {
      const raw = args !== null && typeof args === 'object' ? args : {}
      const source = safePath(raw.inputPath)
      // The tool's `variables` list is folded into every analysis that named
      // none, so a user can pass a flat variable list and one analysis type.
      const analyses = Array.isArray(raw.analyses)
        ? raw.analyses.map((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry.variables) && Array.isArray(raw.variables)
          ? { ...entry, variables: raw.variables }
          : entry))
        : raw.analyses
      const result = await performRun({
        config,
        body: {
          ...raw,
          inputPath: source ?? raw.inputPath,
          analyses,
        },
      })
      return {
        ...result,
        summary: summarizeRun(result),
      }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'spss_list_outputs',
    description:
      'List the result files the dsh-spss plugin has written to its outputs folder on this computer, newest first, with absolute paths and sizes. '
      + 'Use it to tell the user where their results are, or before opening one.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dir: { type: 'string', description: 'Absolute folder to list. Defaults to the plugin outputs folder.' },
        limit: { type: 'number', description: 'Maximum rows to return (default 50).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          dir: { type: 'string' },
          count: { type: 'number' },
        },
      },
      render: (args, value) => {
        const count = typeof value?.count === 'number' ? value.count : 0
        const dir = typeof value?.dir === 'string' ? value.dir : ''
        return [{ type: 'text', text: `spss_list_outputs ${dir} → ${count} file${count === 1 ? '' : 's'}` }]
      },
    },
    execute: async (args) => {
      const raw = args !== null && typeof args === 'object' ? args : {}
      const listed = await performListOutputs({ config, dir: raw.dir, limit: raw.limit ?? 50 })
      const files = Array.isArray(listed.files) ? listed.files : []
      return {
        ok: listed.ok !== false,
        dir: listed.dir,
        count: files.length,
        files: files.slice(0, 50),
        ...(listed.error === undefined ? {} : { error: listed.error }),
        summary: files.length === 0
          ? `No result files yet in ${listed.dir}`
          : `${files.length} result file${files.length === 1 ? '' : 's'} in ${listed.dir}: ${files.slice(0, 12).map((file) => file.name).join(', ')}${files.length > 12 ? ', …' : ''}`,
      }
    },
  }))

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // A disposer that throws must not keep its sibling registered.
      }
    }
  }
}

/**
 * One short, human-readable digest of a run: what was written and where.
 *
 * The digest is what the agent (and the transcript card) actually shows, so it
 * names the absolute output paths — that is the plugin's whole point.
 * @param {object} result - engine result
 * @returns {string}
 */
export function summarizeRun(result) {
  if (result === null || typeof result !== 'object') return 'spss_analyze produced no result'
  if (result.ok !== true) {
    const error = typeof result.error === 'string' ? result.error : 'the analysis failed'
    return `spss_analyze failed: ${error}`
  }
  const written = collectWrittenPaths(result)
  const tables = Array.isArray(result.tables) ? result.tables.length : 0
  const head = `spss_analyze wrote ${written.length} file${written.length === 1 ? '' : 's'}${tables === 0 ? '' : ` and ${tables} table${tables === 1 ? '' : 's'}`}`
  if (written.length === 0) return head
  return `${head}:\n${written.map((entry) => `- ${entry}`).join('\n')}`
}

/**
 * Harvest every file path the engine reported.
 *
 * The engine owns its response schema, so this accepts the shapes it is
 * documented to use (`outputs: [{path}]`, `files: [string]`, `exported: [string]`,
 * and a string `outDir` + `outBaseName`) and de-duplicates. A path is reported
 * only when it is already absolute.
 * @param {object} result - engine result
 * @returns {string[]}
 */
export function collectWrittenPaths(result) {
  const found = []
  const push = (value) => {
    if (typeof value === 'string' && path.isAbsolute(value) && !found.includes(value)) found.push(value)
  }
  for (const key of ['files', 'outputs', 'written', 'exported']) {
    const value = result[key]
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (typeof entry === 'string') push(entry)
      else if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string') push(entry.path)
    }
  }
  if (result.outputs !== null && typeof result.outputs === 'object' && !Array.isArray(result.outputs)) {
    for (const entry of Object.values(result.outputs)) {
      if (typeof entry === 'string') push(entry)
      else if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string') push(entry.path)
    }
  }
  return found
}

/** Record that the running server mounted this row, for install diagnostics. */
function writeBootProof(config) {
  try {
    const home = process.env.DSH_HOME?.trim() || path.join(expandHome('~') ?? '.', '.dsh')
    mkdirSync(home, { recursive: true })
    writeFileSync(
      path.join(home, 'dsh-spss.boot.json'),
      `${JSON.stringify(
        {
          plugin: name,
          pid: process.pid,
          mountedAt: new Date().toISOString(),
          node: process.version,
          pluginDir: bundleDir,
          engine: enginePath(bundleDir),
          outputsDir: resolveOutputsDir(config.outputsDir),
          routes: [
            'GET /api/dsh-spss/status',
            'POST /api/dsh-spss/pick',
            'POST /api/dsh-spss/pick-dir',
            'POST /api/dsh-spss/run',
            'POST /api/dsh-spss/open-path',
            'POST /api/dsh-spss/read-data',
            'GET /api/dsh-spss/outputs',
          ],
          tools: ['spss_analyze', 'spss_list_outputs'],
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

/** Re-export so `scripts/test.mjs` and a future client can share one entry. */
export { resetPythonCache }
