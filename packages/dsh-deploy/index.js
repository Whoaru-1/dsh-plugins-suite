/**
 * dsh-deploy — host half.
 *
 * One-click deployment for this static site. The browser half owns the panel;
 * this half owns the one thing the browser cannot: running the CloudBase CLI
 * (and git) on the machine, streaming the log, and verifying the live version.
 *
 * Routes (all behind the same Host/Origin + session-cookie fence as /api):
 *   GET  /api/dsh-deploy/state   config + run status/log + local/remote version
 *   POST /api/dsh-deploy/config  save project / env / cloud path / site URL
 *   POST /api/dsh-deploy/run     start deploy | check | push
 *   POST /api/dsh-deploy/stop    kill the current child process
 *
 * Nothing secret is stored: the CLI's own auth lives in ~/.config/.cloudbase.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-deploy'
export const inject = ['webServer', 'connection']

const MAX_BODY_BYTES = 64 * 1024
const MAX_LOG_LINES = 2000
const MAX_RUN_MS = 15 * 60 * 1000
const REMOTE_CACHE_MS = 15 * 1000

/** Server home, matching every other DSH component. */
export function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
}
const configFile = () => path.join(dshHome(), 'dsh-deploy', 'config.json')
const bootFile = () => path.join(dshHome(), 'dsh-deploy.boot.json')

/** Out-of-the-box values for this machine; everything is editable in the panel. */
export const DEFAULT_CONFIG = Object.freeze({
  // Neutral placeholders: set your own values in the panel (or the config file)
  // before the first deploy. Nothing here points at a real project or account.
  projectDir: '',
  envId: '',
  cloudPath: '',
  siteUrl: '',
  proxyUrl: ''
})

const STRING_FIELDS = ['projectDir', 'envId', 'cloudPath', 'siteUrl', 'proxyUrl']

/** Coerce untrusted input into a safe config object (never throws). */
export function sanitizeConfig(raw) {
  const out = { ...DEFAULT_CONFIG }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of STRING_FIELDS) {
      if (typeof raw[key] === 'string') out[key] = raw[key].trim()
    }
  }
  return out
}

/** Validate a config for execution; returns a human error or null. */
export function validateConfig(cfg) {
  if (!cfg.projectDir || !path.isAbsolute(cfg.projectDir)) return '项目路径必须是绝对路径'
  if (!existsSync(cfg.projectDir)) return `项目目录不存在：${cfg.projectDir}`
  if (!existsSync(path.join(cfg.projectDir, 'index.html'))) return '项目目录里没有 index.html'
  if (!/^[a-z0-9][a-z0-9-]{5,63}$/i.test(cfg.envId)) return '环境 ID 格式不正确'
  if (!/^[A-Za-z0-9_/-]{0,64}$/.test(cfg.cloudPath) || cfg.cloudPath.includes('..')) return '云路径不合法'
  if (!/^https?:\/\/\S+$/i.test(cfg.siteUrl)) return '站点地址必须以 http(s):// 开头'
  if (cfg.proxyUrl && !/^https?:\/\/\S+$/i.test(cfg.proxyUrl)) return '代理地址格式不正确'
  return null
}

/** Read the saved config, falling back to defaults. */
export async function readConfig() {
  try {
    const raw = JSON.parse(await readFile(configFile(), 'utf8'))
    return sanitizeConfig(raw)
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/** Persist the config atomically. */
export async function writeConfig(cfg) {
  const file = configFile()
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, file)
}

/** Short git HEAD without spawning git. */
function gitHead(dir) {
  try {
    const head = readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim()
    if (head.startsWith('ref: ')) {
      return readFileSync(path.join(dir, '.git', head.slice(5)), 'utf8').trim().slice(0, 7)
    }
    return head.slice(0, 7)
  } catch {
    return null
  }
}

/** Local version.json from the project. */
function localVersion(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8'))
  } catch {
    return null
  }
}

let remoteCache = { key: '', at: 0, value: null, error: null }

/** Remote version.json, cached briefly so panel polling stays cheap. */
async function remoteVersion(cfg) {
  const key = `${cfg.siteUrl}/${cfg.cloudPath}`.replace(/\/+$/, '')
  if (remoteCache.key === key && Date.now() - remoteCache.at < REMOTE_CACHE_MS) return remoteCache
  let value = null
  let error = null
  try {
    const res = await fetch(`${key}/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    value = await res.json()
  } catch (err) {
    error = String(err?.message ?? err)
  }
  remoteCache = { key, at: Date.now(), value, error }
  return remoteCache
}

/* ---------------------------------------------------------------- run state */

const run = {
  id: null,
  action: null,
  running: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  log: []
}
let child = null
let timer = null

function pushLog(chunk) {
  const text = String(chunk).replace(/\x1b\[[0-9;]*m/g, '')
  for (const line of text.split(/\r?\n/)) {
    if (line === '') continue
    run.log.push(line)
  }
  if (run.log.length > MAX_LOG_LINES) run.log.splice(0, run.log.length - MAX_LOG_LINES)
}

function finishRun(code, signal) {
  run.running = false
  run.finishedAt = new Date().toISOString()
  run.exitCode = typeof code === 'number' ? code : null
  if (signal) pushLog(`— 进程被 ${signal} 终止 —`)
  pushLog(code === 0 ? '✔ 完成' : `✗ 结束，退出码 ${code ?? '未知'}`)
  child = null
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  remoteCache.at = 0
}

/** Build the argv for one supported action. */
function commandFor(action, cfg) {
  const env = { ...process.env }
  if (cfg.proxyUrl) {
    env.HTTPS_PROXY = cfg.proxyUrl
    env.HTTP_PROXY = cfg.proxyUrl
  }
  if (action === 'deploy') {
    return {
      cmd: 'bash',
      args: [path.join(cfg.projectDir, 'scripts', 'deploy-cloudbase.sh')],
      env: {
        ...env,
        PATH: `${path.join(homedir(), '.local', 'bin')}:${env.PATH || ''}`,
        CLOUDBASE_ENV_ID: cfg.envId,
        CLOUDBASE_PATH: cfg.cloudPath,
        CLOUDBASE_SITE_URL: cfg.siteUrl
      }
    }
  }
  if (action === 'check') {
    return {
      cmd: 'node',
      args: [path.join(cfg.projectDir, 'scripts', 'check-deploy.mjs'), `${cfg.siteUrl}/${cfg.cloudPath}`],
      env
    }
  }
  if (action === 'push') {
    return { cmd: 'git', args: ['push', 'origin', 'main'], env }
  }
  return null
}

/** Start one action; returns { ok, error }. */
export function startRun(action, cfg) {
  if (run.running) return { ok: false, error: '已有部署任务在运行' }
  if (!['deploy', 'check', 'push'].includes(action)) return { ok: false, error: '未知操作' }
  const invalid = validateConfig(cfg)
  if (invalid) return { ok: false, error: invalid }
  const command = commandFor(action, cfg)
  if (command === null) return { ok: false, error: '未知操作' }

  run.id = `${Date.now().toString(36)}`
  run.action = action
  run.running = true
  run.startedAt = new Date().toISOString()
  run.finishedAt = null
  run.exitCode = null
  run.log = [`▶ ${action}  ${cfg.projectDir}`, `$ ${command.cmd} ${command.args.join(' ')}`]

  try {
    child = spawn(command.cmd, command.args, {
      cwd: cfg.projectDir,
      env: command.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    finishRun(null)
    pushLog(`✗ 无法启动：${String(err?.message ?? err)}`)
    return { ok: false, error: String(err?.message ?? err) }
  }

  child.stdout.on('data', pushLog)
  child.stderr.on('data', pushLog)
  child.on('error', (err) => pushLog(`✗ 进程错误：${String(err?.message ?? err)}`))
  child.on('close', (code, signal) => finishRun(code, signal))

  timer = setTimeout(() => {
    if (run.running && child !== null) {
      pushLog(`✗ 超过 ${Math.round(MAX_RUN_MS / 60000)} 分钟，已终止`)
      child.kill('SIGTERM')
    }
  }, MAX_RUN_MS)

  return { ok: true }
}

/** Stop the running child. */
export function stopRun() {
  if (!run.running || child === null) return { ok: false, error: '当前没有运行中的任务' }
  pushLog('— 收到停止请求 —')
  child.kill('SIGTERM')
  setTimeout(() => {
    if (child !== null) child.kill('SIGKILL')
  }, 4000)
  return { ok: true }
}

/** The snapshot the panel polls. */
export async function getState() {
  const cfg = await readConfig()
  const remote = await remoteVersion(cfg)
  const hasProject = existsSync(cfg.projectDir)
  return {
    ok: true,
    config: cfg,
    run: {
      id: run.id,
      action: run.action,
      running: run.running,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      exitCode: run.exitCode,
      log: run.log.slice(-400)
    },
    versions: {
      local: hasProject ? localVersion(cfg.projectDir) : null,
      remote: remote.value,
      remoteError: remote.error,
      checkedAt: remote.at
    },
    detected: {
      projectExists: hasProject,
      hasIndex: hasProject && existsSync(path.join(cfg.projectDir, 'index.html')),
      hasDeployScript: hasProject && existsSync(path.join(cfg.projectDir, 'scripts', 'deploy-cloudbase.sh')),
      cloudbaseCli: existsSync(path.join(homedir(), '.local', 'bin', 'cloudbase')),
      gitHead: hasProject ? gitHead(cfg.projectDir) : null
    }
  }
}

/* ------------------------------------------------------------------- HTTP */

function respond(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text)
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeBootProof() {
  try {
    mkdir(path.dirname(bootFile()), { recursive: true }).catch(() => {})
    writeFile(
      bootFile(),
      `${JSON.stringify(
        {
          plugin: name,
          pid: process.pid,
          mountedAt: new Date().toISOString(),
          routes: [
            '/api/dsh-deploy/state',
            '/api/dsh-deploy/config',
            '/api/dsh-deploy/run',
            '/api/dsh-deploy/stop'
          ]
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    ).catch(() => {})
  } catch {
    // A missing proof only costs a diagnostic, never the plugin.
  }
}

/**
 * Mount the four routes on the shared web server.
 * @param ctx - host context; `webServer` and `connection` are required.
 */
export function apply(ctx) {
  writeBootProof()
  ctx.inject(['webServer', 'connection'], (routeCtx) => {
    const guard = (handler) => async (req, res) => {
      const rejection = routeCtx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      try {
        await handler(req, res)
      } catch (err) {
        respond(res, 500, { ok: false, error: String(err?.message ?? err) })
      }
    }

    routeCtx.effect(
      () =>
        routeCtx.webServer.register({
          kind: 'exact',
          path: '/api/dsh-deploy/state',
          handler: guard(async (req, res) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              respond(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            respond(res, 200, await getState())
          })
        }),
      'dsh-deploy: state'
    )

    routeCtx.effect(
      () =>
        routeCtx.webServer.register({
          kind: 'exact',
          path: '/api/dsh-deploy/config',
          handler: guard(async (req, res) => {
            if (req.method !== 'POST') {
              respond(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            const payload = JSON.parse(await readBody(req))
            const next = sanitizeConfig(payload)
            const invalid = validateConfig(next)
            if (invalid) {
              respond(res, 400, { ok: false, error: invalid })
              return
            }
            await writeConfig(next)
            respond(res, 200, { ok: true, config: next })
          })
        }),
      'dsh-deploy: config'
    )

    routeCtx.effect(
      () =>
        routeCtx.webServer.register({
          kind: 'exact',
          path: '/api/dsh-deploy/run',
          handler: guard(async (req, res) => {
            if (req.method !== 'POST') {
              respond(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            const payload = JSON.parse(await readBody(req))
            const action = String(payload?.action ?? '')
            const cfg = payload?.config ? sanitizeConfig(payload.config) : await readConfig()
            const invalid = validateConfig(cfg)
            if (invalid) {
              respond(res, 400, { ok: false, error: invalid })
              return
            }
            const started = startRun(action, cfg)
            respond(res, started.ok ? 202 : 409, started)
          })
        }),
      'dsh-deploy: run'
    )

    routeCtx.effect(
      () =>
        routeCtx.webServer.register({
          kind: 'exact',
          path: '/api/dsh-deploy/stop',
          handler: guard(async (req, res) => {
            if (req.method !== 'POST') {
              respond(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            respond(res, 200, stopRun())
          })
        }),
      'dsh-deploy: stop'
    )
  })
}
