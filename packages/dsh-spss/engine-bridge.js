/**
 * dsh-spss engine bridge — every OS-level primitive the host half needs.
 *
 * This module is deliberately free of Cordis/DSH imports so it can be required
 * and exercised in isolation by `scripts/test.mjs` (and by anyone debugging the
 * plugin). `index.js` is the only consumer.
 *
 * Two hard rules live here and nowhere else:
 *
 * 1. **No shell, ever.** Every external program is started with
 *    `execFile`/`spawn` and an argument **array**. Nothing a caller (or the
 *    user) supplies is ever concatenated into a command string, so a path
 *    containing `; rm -rf ~` is just a strange filename, not a command.
 *
 * 2. **A stuck dialog may not wedge the Host.** Every child process carries a
 *    hard timeout and is killed with `SIGKILL`. `SIGTERM` is not enough: during
 *    verification a SIGTERM'd `osascript` dialog kept its process alive and
 *    left the modal window on screen, so the kill signal here is SIGKILL.
 *
 * @module dsh-spss/engine-bridge
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

/** How long a native dialog may stay open before it is killed (ms). */
export const PICK_TIMEOUT_MS = 180_000

/** Largest request body / engine payload accepted (bytes). */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** Sentinel returned by the picker scripts when the user dismissed the dialog. */
const CANCELLED_TOKEN = '__DSH_SPSS_CANCELLED__'

/** Filename of the Python engine inside the bundle. */
export const ENGINE_RELATIVE = path.join('engine', 'analyze.py')

/**
 * The dsh home directory, matching every other DSH component.
 * @returns {string} e.g. `/Users/me/.dsh`
 */
export function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
}

/**
 * The default directory analysis results are written to.
 *
 * Chosen as `<dsh home>/dsh-spss/outputs` (~/.dsh/dsh-spss/outputs) rather than
 * a folder under the *workspace*, because results are the plugin's data, not
 * the project's files: this survives switching workspace, and it is the one
 * location the Host can always create. The UI pre-fills it and the user is
 * free to pick another folder with the native folder picker.
 *
 * @returns {string} absolute path (the directory may not exist yet)
 */
export function defaultOutputsDir() {
  return path.join(dshHome(), 'dsh-spss', 'outputs')
}

/**
 * Resolve the configured outputs directory, expanding an empty config to the
 * default and `~` to the user's home. Always absolute.
 * @param {string} configured - raw `config.outputsDir`
 * @returns {string} absolute path
 */
export function resolveOutputsDir(configured) {
  return expandHome(configured) ?? defaultOutputsDir()
}

/** Expand a leading `~` and make a path absolute; null for a blank value. */
export function expandHome(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw === '') return null
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(homedir(), raw.slice(2))
  return path.resolve(raw)
}

/**
 * Validate an untrusted, caller-supplied path.
 *
 * Every request path goes through here before it reaches `open`, the engine,
 * or the filesystem. A NUL byte is refused outright: it truncates a path in
 * some APIs and is never a legitimate filename character. Relative paths are
 * resolved against the Host's current directory so the result is always
 * absolute and unambiguous.
 *
 * @param {unknown} value - untrusted request value
 * @param {{ required?: boolean, allowEmpty?: boolean }} [options]
 * @returns {string|null} an absolute path, or null when unacceptable
 */
export function safePath(value, options = {}) {
  const { required = true } = options
  if (typeof value !== 'string') return required ? null : null
  if (value.includes('\u0000')) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.length > 4096) return null
  return path.resolve(trimmed)
}

/**
 * Run one external program with an argument array and a hard timeout.
 *
 * The child is **detached into its own process group** and killed with
 * `SIGKILL` on timeout, so a helper that spawns its own children (a shell
 * wrapper, a PowerShell host) cannot outlive the kill. `SIGTERM` alone was
 * observed to leave `osascript` and its dialog alive.
 *
 * @param {string} file - absolute path of the executable
 * @param {string[]} args - argument array, never a command string
 * @param {{ timeoutMs?: number, env?: Record<string,string>, cwd?: string }} [options]
 * @returns {Promise<{ code: number|null, signal: string|null, stdout: string, stderr: string, timedOut: boolean, spawnError: Error|null }>}
 */
export function runProcess(file, args, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : PICK_TIMEOUT_MS
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let timer = null
    let child
    try {
      child = spawn(file, args, {
        // A separate process group is what lets one SIGKILL take down the whole
        // subtree instead of orphaning the grandchild holding the dialog open.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env ?? process.env,
        cwd: options.cwd,
        windowsHide: false,
      })
    } catch (error) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: error })
      return
    }

    const stdout = []
    const stderr = []
    child.stdout?.on('data', (chunk) => stdout.push(chunk))
    child.stderr?.on('data', (chunk) => stderr.push(chunk))

    /** Kill the whole process group, falling back to the direct child. */
    const killTree = (signal) => {
      try {
        if (process.platform !== 'win32' && typeof child.pid === 'number') {
          // Negative pid targets the group created by `detached: true`.
          process.kill(-child.pid, signal)
          return
        }
      } catch {
        // The group is already gone or never existed; fall through.
      }
      try {
        child.kill(signal)
      } catch {
        // Already exited.
      }
    }

    /** Resolve exactly once. */
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve({
        ...result,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    }

    timer = setTimeout(() => {
      timedOut = true
      killTree('SIGKILL')
      // Give the close event a moment; if the child is truly wedged in a
      // runtime we do not control, resolve anyway so no caller hangs.
      setTimeout(() => finish({ code: null, signal: 'SIGKILL', timedOut: true, spawnError: null }), 750)
    }, timeoutMs)

    child.on('error', (error) => finish({ code: null, signal: null, timedOut, spawnError: error }))
    child.on('close', (code, signal) => finish({ code, signal, timedOut, spawnError: null }))
  })
}

/* -------------------------------------------------------------------------- */
/* Python resolution                                                          */
/* -------------------------------------------------------------------------- */

/** Probed interpreters, cached for the life of the process (it is slow). */
let pythonCache = null

/** The inline program used to identify an interpreter. */
const PYTHON_PROBE = 'import sys,json;print(json.dumps({"version":sys.version.split()[0],"executable":sys.executable,"major":sys.version_info[0],"minor":sys.version_info[1]}))'

/**
 * Candidate interpreters in precedence order.
 * `config.pythonPath` wins, then `DSH_SPSS_PYTHON`, then the PATH and the usual
 * macOS install locations.
 * @param {string} configuredPythonPath - `config.pythonPath`
 * @returns {string[]} candidate program names/paths, de-duplicated
 */
export function pythonCandidates(configuredPythonPath) {
  const configured = typeof configuredPythonPath === 'string' ? configuredPythonPath.trim() : ''
  const fromEnv = String(process.env.DSH_SPSS_PYTHON ?? '').trim()
  const list = [configured, fromEnv, 'python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3']
  return [...new Set(list.filter((entry) => entry !== ''))]
}

/**
 * Probe one interpreter: does it run and which version is it?
 * @param {string} candidate - program name or absolute path
 * @param {number} timeoutMs - probe timeout
 * @returns {Promise<{ path: string, version: string, executable: string, ok: boolean, error?: string }>}
 */
export async function probePython(candidate, timeoutMs = 15_000) {
  const result = await runProcess(candidate, ['-c', PYTHON_PROBE], { timeoutMs })
  if (result.spawnError !== null) {
    return { path: candidate, version: '', executable: '', ok: false, error: String(result.spawnError.message ?? result.spawnError) }
  }
  if (result.timedOut) {
    return { path: candidate, version: '', executable: '', ok: false, error: `probe timed out after ${timeoutMs}ms` }
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().split('\n').slice(-1)[0] ?? ''
    return { path: candidate, version: '', executable: '', ok: false, error: detail === '' ? `exited ${String(result.code)}` : detail }
  }
  try {
    const parsed = JSON.parse(result.stdout.trim())
    return {
      path: candidate,
      version: String(parsed.version ?? ''),
      executable: String(parsed.executable ?? candidate),
      ok: Number(parsed.major) === 3,
      ...(Number(parsed.major) === 3 ? {} : { error: 'not a Python 3 interpreter' }),
    }
  } catch {
    return { path: candidate, version: '', executable: '', ok: false, error: 'probe output was not JSON' }
  }
}

/**
 * Resolve a working Python 3, probing candidates once and caching the winner.
 *
 * A failed result is cached too, so a machine without Python does not pay a
 * probe on every request; `{ force: true }` re-probes.
 *
 * @param {string} configuredPythonPath - `config.pythonPath`
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ path: string, version: string, executable: string, ok: boolean, tried: { path: string, ok: boolean, error?: string }[] }>}
 */
export async function resolvePython(configuredPythonPath, options = {}) {
  const candidates = pythonCandidates(configuredPythonPath)
  const cacheKey = candidates.join('\u0000')
  if (!options.force && pythonCache !== null && pythonCache.key === cacheKey) return pythonCache.value

  const tried = []
  let winner = null
  for (const candidate of candidates) {
    const probed = await probePython(candidate)
    tried.push({ path: candidate, ok: probed.ok, ...(probed.ok ? {} : { error: probed.error ?? '' }) })
    if (probed.ok) {
      winner = probed
      break
    }
  }
  const value = winner === null
    ? { path: '', version: '', executable: '', ok: false, tried }
    : { ...winner, tried }
  pythonCache = { key: cacheKey, value }
  return value
}

/** Forget the cached interpreter (used by the self-test and by `force`). */
export function resetPythonCache() {
  pythonCache = null
}

/**
 * Ask the engine's Python which of a set of importable modules are present.
 * Failures degrade to "none present" rather than throwing.
 * @param {string} pythonPath - a resolved interpreter
 * @param {string[]} modules - import names, e.g. `['pyreadstat','scipy']`
 * @param {number} [timeoutMs]
 * @returns {Promise<Record<string, boolean>>} every requested module mapped to a boolean
 */
export async function probeModules(pythonPath, modules, timeoutMs = 30_000) {
  const absent = Object.fromEntries(modules.map((module) => [module, false]))
  if (typeof pythonPath !== 'string' || pythonPath === '') return absent
  const program = [
    'import json,importlib.util',
    `mods=${JSON.stringify(modules)}`,
    'print(json.dumps({m: importlib.util.find_spec(m) is not None for m in mods}))',
  ].join('\n')
  const result = await runProcess(pythonPath, ['-c', program], { timeoutMs })
  if (result.spawnError !== null || result.timedOut || result.code !== 0) return absent
  try {
    const parsed = JSON.parse(result.stdout.trim())
    return Object.fromEntries(modules.map((module) => [module, parsed?.[module] === true]))
  } catch {
    return absent
  }
}

/* -------------------------------------------------------------------------- */
/* Native file picker                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Escape a string for embedding inside an AppleScript double-quoted literal.
 *
 * Backslashes must be doubled (`\\` is an escape introducer in AppleScript),
 * and `"` must be escaped. Newlines are folded to spaces because a raw newline
 * is not legal inside the literal. This runs on every user-supplied prompt and
 * default name, so neither can break out of the string.
 *
 * @param {string} value - untrusted text
 * @returns {string} a fragment safe to place between two `"` characters
 */
export function appleScriptEscape(value) {
  const text = typeof value === 'string' ? value : ''
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\u0000/g, '')
}

/**
 * Escape a string for a PowerShell single-quoted literal (doubling `'`).
 * @param {string} value - untrusted text
 * @returns {string} a fragment safe between two `'` characters
 */
export function powerShellEscape(value) {
  const text = typeof value === 'string' ? value : ''
  return text.replace(/'/g, "''").replace(/[\r\n]+/g, ' ').replace(/\u0000/g, '')
}

/**
 * POSIX single-quote a string for the `sh -c` strings Gtk/zenity need.
 *
 * Only used for a *filter description*, never for a path or an executable; the
 * resulting text is still passed as a single argv element to `/bin/sh`, not
 * concatenated into a command line. `'` becomes `'\''`, the standard
 * idiom that cannot terminate the quoting early.
 * @param {string} value - untrusted text
 * @returns {string} the single-quoted literal including its quotes
 */
export function shellSingleQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`
}

/**
 * Build the AppleScript source for one native dialog.
 *
 * The script is written to a **file** and run as `osascript <file>`, so no part
 * of it — prompt, default name, filters — ever appears on a command line. Only
 * plain `choose file` / `choose file name` / `choose folder` are used: no
 * `tell application` block, no System Events, no Finder, because scripting
 * another application needs an Automation permission this Host may not have
 * (verified on the target machine: `System Events` fails with -1743).
 *
 * Every user-supplied value is escaped before embedding: the prompt and the
 * default name become literals inside double-quoted AppleScript strings, and
 * the folder default is a `POSIX file` literal. None can break out.
 *
 * @param {'open'|'save'|'folder'} kind - the dialog to show
 * @param {{ prompt?: string, defaultName?: string, defaultLocation?: string }} options
 * @returns {string} AppleScript source
 */
export function buildAppleScript(kind, options = {}) {
  const prompt = appleScriptEscape(options.prompt ?? defaultPrompt(kind))
  const defaultName = appleScriptEscape(sanitizeFileName(options.defaultName ?? ''))
  // Only `choose folder` accepts `default location`; `choose file` and
  // `choose file name` do not, so the clause is emitted for folders alone.
  const startDir = expandHome(options.defaultLocation)
  const locationClause = kind === 'folder' && startDir !== null
    ? ` default location (POSIX file "${appleScriptEscape(startDir)}" as alias)`
    : ''
  let command
  if (kind === 'folder') {
    command = `choose folder with prompt "${prompt}"${locationClause}`
  } else if (kind === 'save') {
    // `choose file name` shows the native save panel. It does NOT enforce a
    // type filter, so the extension is appended in JS after the fact.
    command = defaultName === ''
      ? `choose file name with prompt "${prompt}"`
      : `choose file name with prompt "${prompt}" default name "${defaultName}"`
  } else {
    command = `choose file with prompt "${prompt}"`
  }
  return `-- dsh-spss native file picker (generated; do not edit)
on run argv
\ttry
\t\t${command}
\t\tset theAlias to result
\ton error errMsg number errNumber
\t\tif errNumber is -128 then
\t\t\treturn "${CANCELLED_TOKEN}"
\t\tend if
\t\treturn "__DSH_SPSS_ERROR__" & errNumber & " " & errMsg
\tend try
\treturn POSIX path of theAlias
end run
`
}

/** The default prompt per dialog kind. */
function defaultPrompt(kind) {
  if (kind === 'folder') return 'Choose a folder'
  if (kind === 'save') return 'Save results as'
  return 'Choose a data file'
}

/**
 * Reduce an untrusted value to a single, safe file name component.
 *
 * Separators, NUL and traversal segments are removed, so a `defaultName` of
 * `../../etc/passwd` becomes `passwd` and cannot steer the save panel out of
 * the directory the user is looking at.
 *
 * @param {string} name - untrusted candidate name
 * @returns {string} a base name without separators, possibly empty
 */
export function sanitizeFileName(name) {
  const raw = typeof name === 'string' ? name : ''
  const noNul = raw.replace(/\u0000/g, '')
  const base = path.basename(noNul.replace(/[\\/]+/g, path.sep)).trim()
  if (base === '' || base === '.' || base === '..') return ''
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 200)
}

/**
 * Normalise the caller's `filters` into `{ name, extensions }` rows.
 * Unknown shapes are dropped; extensions lose their leading dot and are
 * lower-cased so `['.XLSX']` and `['xlsx']` agree.
 * @param {unknown} filters - untrusted request value
 * @returns {{ name: string, extensions: string[] }[]}
 */
export function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return []
  const rows = []
  for (const entry of filters.slice(0, 20)) {
    if (entry === null || typeof entry !== 'object') continue
    const extensions = Array.isArray(entry.extensions)
      ? entry.extensions
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim().replace(/^\./, '').toLowerCase())
        .filter((value) => /^[a-z0-9]{1,12}$/.test(value))
        .slice(0, 20)
      : []
    if (extensions.length === 0) continue
    const rawName = typeof entry.name === 'string' ? entry.name.trim() : ''
    rows.push({ name: rawName === '' ? extensions.join('/').toUpperCase() : rawName.slice(0, 80), extensions })
  }
  return rows
}

/**
 * Choose the executable that can show a native dialog on this OS.
 * @returns {{ available: boolean, tool: string, reason?: string }} the capability
 */
export function pickerCapability() {
  if (String(process.env.DSH_SPSS_PICKER ?? '').trim().toLowerCase() === 'off') {
    return { available: false, tool: 'none', reason: 'DSH_SPSS_PICKER=off' }
  }
  const platform = process.platform
  if (platform === 'darwin') {
    const tool = '/usr/bin/osascript'
    return existsSync(tool)
      ? { available: true, tool }
      : { available: false, tool, reason: 'osascript not found' }
  }
  if (platform === 'win32') {
    const tool = 'powershell.exe'
    return { available: true, tool }
  }
  // Linux and friends: zenity is the portable choice; kdialog is a fallback.
  for (const tool of ['zenity', 'kdialog']) {
    const found = whichSync(tool)
    if (found !== null) {
      // Gtk dialogs need a display to attach to.
      if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        return { available: false, tool: found, reason: 'no DISPLAY/WAYLAND_DISPLAY (headless session)' }
      }
      return { available: true, tool: found }
    }
  }
  return { available: false, tool: 'zenity', reason: 'no zenity or kdialog on PATH' }
}

/**
 * Locate a program on PATH without invoking a shell.
 * @param {string} program - bare program name
 * @returns {string|null} absolute path when found
 */
export function whichSync(program) {
  const dirs = String(process.env.PATH ?? '').split(path.delimiter).filter((dir) => dir !== '')
  for (const dir of dirs) {
    const candidate = path.join(dir, program)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Open the native dialog the platform offers and return the path the user
 * picked. **Only** a path the user chose in the dialog is ever returned: on
 * cancel, timeout, or any error there is no path in the result.
 *
 * @param {'open'|'save'|'folder'} kind - dialog kind
 * @param {{ prompt?: string, defaultName?: string, filters?: {name:string, extensions:string[]}[], defaultLocation?: string, timeoutMs?: number }} options
 * @returns {Promise<{ ok: true, path: string } | { ok: false, cancelled?: true, error?: string, unsupported?: true, hint?: string, timedOut?: true }>}
 */
export async function pickNativePath(kind, options = {}) {
  const capability = pickerCapability()
  if (!capability.available) {
    return {
      ok: false,
      unsupported: true,
      error: `the native file picker is unavailable: ${capability.reason ?? 'no supported dialog program'}`,
      hint: 'Type the path into the path field instead, or set DSH_SPSS_PICKER to allow the native dialog.',
    }
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : PICK_TIMEOUT_MS
  const normalized = {
    prompt: typeof options.prompt === 'string' ? options.prompt : undefined,
    defaultName: typeOrEmpty(options.defaultName),
    filters: normalizeFilters(options.filters),
    defaultLocation: expandHome(options.defaultLocation) ?? undefined,
  }
  if (process.platform === 'darwin') return pickMac(kind, normalized, timeoutMs)
  if (process.platform === 'win32') return pickWindows(kind, normalized, timeoutMs)
  return pickLinux(kind, normalized, timeoutMs, capability.tool)
}

/** Coerce an optional string. */
function typeOrEmpty(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * macOS: write the generated AppleScript to a temp FILE and run
 * `osascript <file>`. The prompt never touches the command line.
 */
async function pickMac(kind, options, timeoutMs) {
  const script = buildAppleScript(kind, options)
  let dir
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'dsh-spss-pick-'))
    const scriptPath = path.join(dir, 'picker.applescript')
    await writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o600 })
    const result = await runProcess('/usr/bin/osascript', [scriptPath], { timeoutMs })
    if (result.timedOut) {
      return {
        ok: false,
        cancelled: true,
        timedOut: true,
        error: `the file dialog was closed after ${Math.round(timeoutMs / 1000)}s without a choice`,
        hint: 'Type the path into the path field instead.',
      }
    }
    if (result.spawnError !== null) {
      return { ok: false, error: String(result.spawnError.message ?? result.spawnError), unsupported: true, hint: 'Use the path field.' }
    }
    const stdout = result.stdout.trim()
    if (stdout === CANCELLED_TOKEN) return { ok: false, cancelled: true }
    if (stdout.startsWith('__DSH_SPSS_ERROR__')) {
      return classifyDialogError(stdout.slice('__DSH_SPSS_ERROR__'.length).trim(), result.stderr)
    }
    if (result.code !== 0) return classifyDialogError(stdout, result.stderr)
    return finishPick(kind, stdout, options)
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Map a dialog failure to the route's vocabulary. A user cancel is NOT an
 * error: `osascript` exits non-zero and says "User canceled" / `-128`, and the
 * UI shows "nothing chosen", not a red banner.
 */
function classifyDialogError(stdout, stderr) {
  const text = `${stdout}\n${stderr}`.trim()
  if (/-128\b/.test(text) || /user canceled|user cancelled|annul|cancel/i.test(text)) {
    return { ok: false, cancelled: true }
  }
  const message = text === '' ? 'the file dialog failed' : text.split('\n').slice(-3).join(' ').trim()
  return {
    ok: false,
    error: message,
    hint: 'If no dialog appeared, the Host may have no GUI session (or no Automation permission); type the path into the path field instead.',
  }
}

/**
 * Turn the picked path into the final result, applying the save-panel rules.
 *
 * `choose file name` cannot filter by type, so the extension is enforced here:
 * when the name the user typed has no extension from the wanted set, the first
 * wanted extension is appended. That is presentation only — the user's chosen
 * folder and base name are preserved verbatim.
 */
function finishPick(kind, picked, options) {
  const raw = picked.trim()
  if (raw === '') return { ok: false, error: 'the file dialog returned an empty path' }
  let resolved
  try {
    resolved = path.resolve(raw.replace(/\u0000/g, ''))
  } catch {
    return { ok: false, error: 'the file dialog returned an unusable path' }
  }
  if (kind !== 'save') return { ok: true, path: resolved }
  const wanted = options.filters.flatMap((row) => row.extensions)
  const current = path.extname(resolved).replace(/^\./, '').toLowerCase()
  if (wanted.length === 0 || (current !== '' && wanted.includes(current))) {
    return { ok: true, path: resolved }
  }
  // Replace a wrong extension, or add one when there is none.
  return { ok: true, path: `${resolved.slice(0, current === '' ? resolved.length : resolved.length - current.length - 1)}.${wanted[0]}` }
}

/**
 * Windows: an OpenFileDialog/SaveFileDialog via PowerShell.
 *
 * The script goes to a temp `.ps1` file and the prompt arrives in it as
 * single-quoted literals (doubled `'`), so nothing is concatenated into the
 * command line. `-STA` is required: the WinForms dialogs refuse to run on a
 * multi-threaded apartment.
 */
async function pickWindows(kind, options, timeoutMs) {
  const prompt = powerShellEscape(options.prompt ?? defaultPrompt(kind))
  const defaultName = powerShellEscape(sanitizeFileName(options.defaultName))
  const startDir = powerShellEscape(options.defaultLocation ?? '')
  const extensions = options.filters.flatMap((row) => row.extensions)
  const filterText = options.filters.length > 0
    ? options.filters.map((row) => `${powerShellEscape(row.name)}|${row.extensions.map((ext) => `*.${ext}`).join(';')}`).join('|')
    : 'All files|*'
  const body = kind === 'folder'
    ? `$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '${prompt}'
if ('${startDir}' -ne '') { $d.SelectedPath = '${startDir}' }
$r = $d.ShowDialog()`
    : `$d = New-Object System.Windows.Forms.${kind === 'save' ? 'SaveFileDialog' : 'OpenFileDialog'}
$d.Title = '${prompt}'
$d.Filter = '${filterText}'
$d.CheckPathExists = $true
${kind === 'save' ? '$d.OverwritePrompt = $true\n' : ''}${defaultName === '' ? '' : `$d.FileName = '${defaultName}'\n`}if ('${startDir}' -ne '') { $d.InitialDirectory = '${startDir}' }
$r = $d.ShowDialog()`
  const script = `Add-Type -AssemblyName System.Windows.Forms | Out-Null
${body}
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write(${kind === 'folder' ? '$d.SelectedPath' : '$d.FileName'}) } else { [Console]::Out.Write('${CANCELLED_TOKEN}') }
`
  let dir
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'dsh-spss-pick-'))
    const scriptPath = path.join(dir, 'picker.ps1')
    await writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o600 })
    const result = await runProcess('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ], { timeoutMs })
    if (result.timedOut) {
      return { ok: false, cancelled: true, timedOut: true, error: 'the file dialog timed out', hint: 'Use the path field.' }
    }
    if (result.spawnError !== null) {
      return { ok: false, unsupported: true, error: String(result.spawnError.message ?? result.spawnError), hint: 'Use the path field.' }
    }
    const stdout = result.stdout.trim()
    if (stdout === CANCELLED_TOKEN) return { ok: false, cancelled: true }
    if (result.code !== 0 || stdout === '') {
      return {
        ok: false,
        error: result.stderr.trim().split('\n').slice(-3).join(' ').trim() || 'the file dialog failed',
        hint: 'Use the path field instead.',
      }
    }
    return finishPick(kind, stdout, options)
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Linux: `zenity --file-selection` (or `kdialog`). Every user-supplied value is
 * a separate argv element; filters are the one thing zenity wants as a single
 * `--file-filter=` argument, so only a *description* is single-quoted and it
 * never reaches a shell that could interpret it.
 */
async function pickLinux(kind, options, timeoutMs, tool) {
  const prompt = options.prompt ?? defaultPrompt(kind)
  const args = kind === 'folder'
    ? ['--file-selection', '--directory', `--title=${prompt}`]
    : kind === 'save'
      ? ['--file-selection', '--save', '--confirm-overwrite', `--title=${prompt}`, `--filename=${options.defaultLocation ?? ''}${sanitizeFileName(options.defaultName)}`]
      : ['--file-selection', `--title=${prompt}`]
  if (kind !== 'folder' && options.filters.length > 0) {
    for (const row of options.filters) {
      args.push(`--file-filter=${row.name.replace(/\|/g, '/')} | ${row.extensions.map((ext) => `*.${ext}`).join(' ')}`)
    }
  }
  const program = path.basename(tool) === 'kdialog'
  const finalArgs = program
    ? (kind === 'folder' ? ['--getexistingdirectory', options.defaultLocation ?? '.'] : kind === 'save' ? ['--getsavefilename', options.defaultLocation ?? '', '--title', prompt] : ['--getopenfilename', options.defaultLocation ?? '.', '--title', prompt])
    : args
  const result = await runProcess(tool, finalArgs, { timeoutMs })
  if (result.timedOut) {
    return { ok: false, cancelled: true, timedOut: true, error: 'the file dialog timed out', hint: 'Use the path field.' }
  }
  if (result.spawnError !== null) {
    return { ok: false, unsupported: true, error: String(result.spawnError.message ?? result.spawnError), hint: 'Use the path field.' }
  }
  // zenity exits 1 when the user cancels; kdialog prints nothing.
  if (result.code === 1 && result.stdout.trim() === '') return { ok: false, cancelled: true }
  if (result.code !== 0) {
    return { ok: false, error: result.stderr.trim().split('\n').slice(-3).join(' ').trim() || `dialog exited ${String(result.code)}`, hint: 'Use the path field.' }
  }
  const stdout = result.stdout.trim()
  if (stdout === '') return { ok: false, cancelled: true }
  return finishPick(kind, stdout.split('\n')[0], options)
}

/* -------------------------------------------------------------------------- */
/* Engine invocation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where the Python engine lives.
 * @param {string} bundleDir - the bundle root (from `import.meta.url`)
 * @returns {string} absolute path of `analyze.py`
 */
export function enginePath(bundleDir) {
  return path.join(bundleDir, ENGINE_RELATIVE)
}

/**
 * Run one analysis: write the payload to a temp file, run the engine against
 * it, read the result back, and remove every temp artefact.
 *
 * The engine contract is `python3 analyze.py --payload <in.json> --out-json
 * <out.json>`; its result JSON is returned **verbatim** so the engine owns the
 * schema. A crash, a timeout, or unparseable output becomes `{ ok:false, ... }`
 * rather than an exception.
 *
 * @param {object} params
 * @param {string} params.pythonPath - a resolved interpreter; empty means "none"
 * @param {string} params.engine - absolute path of `analyze.py`
 * @param {object} params.payload - the engine request payload
 * @param {number} [params.timeoutMs] - hard ceiling for the run
 * @returns {Promise<object>} the engine result, or an error object
 */
export async function runEngine({ pythonPath, engine, payload, timeoutMs }) {
  if (typeof pythonPath !== 'string' || pythonPath === '') {
    return {
      ok: false,
      error: 'no Python 3 interpreter was found; set `pythonPath` in the dsh-spss config or DSH_SPSS_PYTHON',
    }
  }
  if (!existsSync(engine)) {
    return { ok: false, error: `the analysis engine is missing at ${engine}` }
  }
  const limit = Number.isFinite(timeoutMs) ? Math.max(1_000, timeoutMs) : 300_000
  let dir
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'dsh-spss-run-'))
    const payloadPath = path.join(dir, 'payload.json')
    const outPath = path.join(dir, 'result.json')
    await writeFile(payloadPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 })
    const started = Date.now()
    const result = await runProcess(pythonPath, [
      engine,
      '--payload',
      payloadPath,
      '--out-json',
      outPath,
    ], { timeoutMs: limit, cwd: dir })
    const elapsedMs = Date.now() - started
    if (result.timedOut) {
      return {
        ok: false,
        error: `the analysis exceeded its ${Math.round(limit / 1000)}s time limit and was stopped`,
        timeout: true,
        elapsedMs,
      }
    }
    if (result.spawnError !== null) {
      return { ok: false, error: String(result.spawnError.message ?? result.spawnError), elapsedMs }
    }
    let parsed = null
    if (existsSync(outPath)) {
      try {
        parsed = JSON.parse(await readFile(outPath, 'utf8'))
      } catch (error) {
        return {
          ok: false,
          error: `the analysis engine wrote a result that is not valid JSON: ${String(error?.message ?? error)}`,
          stderr: tail(result.stderr),
          elapsedMs,
        }
      }
    }
    if (parsed === null) {
      if (result.code !== 0) {
        return {
          ok: false,
          error: `the analysis engine exited ${String(result.code)} without a result`,
          stderr: tail(result.stderr),
          elapsedMs,
        }
      }
      return { ok: false, error: 'the analysis engine produced no result file', stderr: tail(result.stderr), elapsedMs }
    }
    // The engine's own `ok` wins; the exit code is only a symptom.
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...parsed, elapsedMs }
      : { ok: false, error: 'the analysis engine result was not a JSON object', elapsedMs }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Keep the last few stderr lines; the whole traceback is noise in a response. */
function tail(text, lines = 20) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value === '') return ''
  const parts = value.split('\n')
  return parts.length <= lines ? value : `…\n${parts.slice(-lines).join('\n')}`
}

/* -------------------------------------------------------------------------- */
/* Dataset preview                                                            */
/* -------------------------------------------------------------------------- */

/** The reader used by `read-data`, run as `python3 -c <program>`. */
const PREVIEW_PROGRAM = String.raw`
import json, os, sys
# The request arrives on fd 3, never on stdin: stdin carries the program text
# itself, so writing JSON there would make Python execute it as code.
req = json.loads(os.fdopen(3, "r", encoding="utf-8").read())
path = req["path"]; sheet = req.get("sheet"); opts = req.get("csvOptions") or {}
limit = int(req.get("limit") or 50)
def label_of(name):
    return name
def respond(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False)); sys.stdout.flush()
low = path.lower()
try:
    if low.endswith(".sav") or low.endswith(".zsav"):
        import pyreadstat
        df, meta = pyreadstat.read_sav(path, apply_value_formats=False)
        variables = []
        for i, name in enumerate(list(df.columns)):
            lab = meta.column_names_to_labels.get(name) or ""
            kind = "string" if str(df[name].dtype).startswith("object") else ("numeric" if str(df[name].dtype).startswith(("int","float")) else "string")
            variables.append({"name": name, "label": lab, "type": kind, "measure": (meta.variable_measure.get(name) or "nominal")})
        total = int(len(df)); head = df.head(limit)
        rows = [[None if (v is None or (isinstance(v,float) and v != v)) else v for v in row] for row in head.itertuples(index=False, name=None)]
        respond({"ok": True, "variables": variables, "rows": rows, "totalRows": total, "source": "sav"})
    else:
        import pandas as pd
        if low.endswith(".dta"):
            df = pd.read_stata(path)
        elif low.endswith((".xlsx", ".xls", ".xlsm")):
            df = pd.read_excel(path, sheet_name=(sheet if sheet not in (None, "") else 0))
        else:
            sep = opts.get("delimiter") or ","
            enc = opts.get("encoding") or "utf-8-sig"
            df = pd.read_csv(path, sep=sep, encoding=enc, header=(0 if opts.get("hasHeader", True) else None))
        def kind_of(dtype):
            s = str(dtype)
            if s.startswith(("int", "float")): return "numeric"
            if s.startswith("datetime"): return "date"
            if s in ("bool",): return "numeric"
            return "string"
        variables = [{"name": str(c), "label": label_of(c), "type": kind_of(df[c].dtype),
                      "measure": "scale" if kind_of(df[c].dtype) == "numeric" else "nominal"} for c in df.columns]
        total = int(len(df)); head = df.head(limit)
        def cell(v):
            try:
                import math
                if v is None or (isinstance(v, float) and math.isnan(v)): return None
            except Exception: pass
            if hasattr(v, "isoformat"): return v.isoformat()
            return v
        rows = [[cell(v) for v in row] for row in head.itertuples(index=False, name=None)]
        respond({"ok": True, "variables": variables, "rows": rows, "totalRows": total, "source": "table"})
except ImportError as error:
    respond({"ok": False, "error": "missing Python package: " + str(error), "missingDependency": True})
except Exception as error:
    respond({"ok": False, "error": type(error).__name__ + ": " + str(error)})
`

/**
 * Read a dataset preview: variable list plus the first rows.
 * @param {{ pythonPath: string, path: string, sheet?: string|number, csvOptions?: object, limit?: number, timeoutMs?: number }} params
 * @returns {Promise<object>} `{ ok, variables, rows, totalRows }` or `{ ok:false, error }`
 */
export async function readDataPreview({ pythonPath, path: dataPath, sheet, csvOptions, limit = 50, timeoutMs = 120_000 }) {
  if (typeof pythonPath !== 'string' || pythonPath === '') {
    return { ok: false, error: 'no Python 3 interpreter was found; set `pythonPath` in the dsh-spss config or DSH_SPSS_PYTHON' }
  }
  // The program travels in argv (`-c`), NOT on stdin, so no path or option is
  // ever exposed to a shell or to `ps` by being pasted into a command string.
  const request = JSON.stringify({ path: dataPath, sheet, csvOptions, limit })
  return new Promise((resolve) => {
    let settled = false
    let child
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      try {
        if (typeof child?.pid === 'number') process.kill(-child.pid, 'SIGKILL')
        else child?.kill('SIGKILL')
      } catch {
        try {
          child?.kill('SIGKILL')
        } catch {
          // Already gone.
        }
      }
      finish({ ok: false, error: `reading the dataset exceeded ${Math.round(timeoutMs / 1000)}s` })
    }, Math.max(1_000, timeoutMs))
    try {
      // fd 3 is the request channel; stdin is an ordinary empty pipe so the
      // interpreter and the payload can never read each other's bytes.
      child = spawn(pythonPath, ['-c', PREVIEW_PROGRAM], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: process.env,
      })
    } catch (error) {
      finish({ ok: false, error: String(error?.message ?? error) })
      return
    }
    const out = []
    const err = []
    child.stdout?.on('data', (chunk) => out.push(chunk))
    child.stderr?.on('data', (chunk) => err.push(chunk))
    child.on('error', (error) => finish({ ok: false, error: String(error?.message ?? error) }))
    child.on('close', () => {
      const text = Buffer.concat(out).toString('utf8').trim()
      if (text === '') {
        finish({ ok: false, error: 'the dataset reader produced no output', stderr: tail(Buffer.concat(err).toString('utf8')) })
        return
      }
      // The reply is one JSON object; tolerate a stray trailing newline but not
      // arbitrary preceding chatter, which would mean the program misbehaved.
      try {
        finish(JSON.parse(text))
      } catch {
        finish({ ok: false, error: 'the dataset reader produced invalid output', stderr: tail(Buffer.concat(err).toString('utf8')) })
      }
    })
    try {
      child.stdio[3].end(request, 'utf8')
    } catch (error) {
      finish({ ok: false, error: String(error?.message ?? error) })
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Reveal in file manager                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Show a file or folder in the OS file manager.
 *
 * macOS: `open -R <file>` selects it in Finder, `open <dir>` opens the folder.
 * Windows: `explorer /select,<file>` (one argv element, no shell).
 * Linux: `xdg-open <parent-or-dir>`.
 *
 * @param {string} target - an absolute, validated path
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
export async function revealPath(target) {
  let info = null
  try {
    info = await stat(target)
  } catch {
    return { ok: false, path: target, error: `no such file or folder: ${target}` }
  }
  const isDir = info.isDirectory()
  let file
  let args
  if (process.platform === 'darwin') {
    file = '/usr/bin/open'
    args = isDir ? [target] : ['-R', target]
  } else if (process.platform === 'win32') {
    file = 'explorer.exe'
    args = isDir ? [target] : [`/select,${target}`]
  } else {
    file = whichSync('xdg-open') ?? 'xdg-open'
    args = [isDir ? target : path.dirname(target)]
  }
  const result = await runProcess(file, args, { timeoutMs: 20_000 })
  if (result.spawnError !== null) {
    return { ok: false, path: target, error: String(result.spawnError.message ?? result.spawnError) }
  }
  // `open` and `explorer` may report a non-zero code while having succeeded;
  // only a timeout or a missing program is a real failure.
  if (result.timedOut) return { ok: false, path: target, error: 'the file manager did not respond' }
  return { ok: true, path: target }
}

/* -------------------------------------------------------------------------- */
/* Outputs directory                                                          */
/* -------------------------------------------------------------------------- */

/**
 * List the result files in the outputs directory, newest first.
 * @param {string} dir - absolute directory (created on demand)
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ ok: boolean, dir: string, files: { name: string, size: number, mtime: number, path: string }[], error?: string }>}
 */
export async function listOutputs(dir, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : 200
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    return { ok: false, dir, files: [], error: `cannot create the outputs directory: ${String(error?.message ?? error)}` }
  }
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      try {
        const info = await stat(full)
        files.push({ name: entry.name, size: info.size, mtime: info.mtimeMs, path: full })
      } catch {
        // A file removed mid-listing is simply absent.
      }
    }
    files.sort((a, b) => b.mtime - a.mtime)
    return { ok: true, dir, files: files.slice(0, limit) }
  } catch (error) {
    return { ok: false, dir, files: [], error: String(error?.message ?? error) }
  }
}
