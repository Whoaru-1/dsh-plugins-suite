/**
 * Host-half smoke test: mounts the plugin on a tiny fake DSH context, calls the
 * four routes through a real HTTP server, and runs the read-only `check` action.
 * Uses a throwaway DSH_HOME so it never touches the real plugin config.
 */
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

process.env.DSH_HOME = await mkdtemp(path.join(tmpdir(), 'dsh-deploy-test-'))

// A self-contained project fixture, so the test does not depend on any real
// project directory on this machine. It carries just enough for the plugin's
// detection and the read-only `check` action to have something to look at.
const { writeFile, mkdir } = await import('node:fs/promises')
const FIXTURE_PROJECT = await mkdtemp(path.join(tmpdir(), 'dsh-deploy-project-'))
await mkdir(path.join(FIXTURE_PROJECT, 'scripts'), { recursive: true })
await writeFile(path.join(FIXTURE_PROJECT, 'index.html'), '<!doctype html><title>fixture</title>\n')
await writeFile(path.join(FIXTURE_PROJECT, 'version.json'), JSON.stringify({ version: '1.1.0' }))
await writeFile(
  path.join(FIXTURE_PROJECT, 'scripts', 'deploy-cloudbase.sh'),
  '#!/usr/bin/env bash\n# fixture deploy script\necho "fixture deploy ok"\n',
  { mode: 0o755 }
)

const { apply, DEFAULT_CONFIG, sanitizeConfig, validateConfig } = await import('../index.js')

const routes = new Map()
const fakeCtx = {
  effect(fn) {
    fn()
  },
  inject(_services, cb) {
    cb({
      effect(fn) {
        fn()
      },
      webServer: {
        register(route) {
          routes.set(route.path, route.handler)
          return () => routes.delete(route.path)
        }
      },
      connection: { requestRejection: () => undefined }
    })
  }
}
apply(fakeCtx)
assert.equal(routes.size, 4, 'should register four routes')

const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://x').pathname)
  if (!handler) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function get(p) {
  const res = await fetch(base + p)
  return { status: res.status, body: await res.json() }
}
async function post(p, body) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  })
  return { status: res.status, body: await res.json() }
}

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed += 1
  console.log(`✓ ${label}`)
}

const FIXTURE_CONFIG = {
  projectDir: FIXTURE_PROJECT,
  envId: 'test-env',
  cloudPath: 'ielts',
  siteUrl: 'https://example.tcloudbaseapp.com'
}
const seeded = await post('/api/dsh-deploy/config', FIXTURE_CONFIG)
assert.equal(seeded.status, 200, 'fixture 配置应保存成功')

const state = await get('/api/dsh-deploy/state')
ok(state.status === 200 && state.body.ok === true, 'GET state 返回 ok')
ok(typeof state.body.config.projectDir === 'string', '配置回传 projectDir')
ok(state.body.detected.hasIndex === true, '探测到 index.html')
ok(state.body.detected.hasDeployScript === true, '探测到 deploy-cloudbase.sh')
ok(state.body.versions.local?.version === '1.1.0', '读取本地 version.json')
// The remote check reaches the network for a real deployed site. It cannot be
// asserted from a public checkout, so record whether it resolved instead of
// failing on infrastructure that is not part of this repository.
console.log(`· 线上版本探测：${state.body.versions.remote?.version ?? '(未联网/无站点，跳过)'}`)
ok(state.body.run.running === false, '初始没有运行任务')

const bad = await post('/api/dsh-deploy/config', { projectDir: '/nope', envId: 'x', cloudPath: 'ielts', siteUrl: 'https://x' })
ok(bad.status === 400 && bad.body.ok === false, '非法配置被拒绝')

const saved = await post('/api/dsh-deploy/config', { ...FIXTURE_CONFIG, proxyUrl: '' })
ok(saved.status === 200 && saved.body.ok === true, '保存合法配置')
const pathSaved = await post('/api/dsh-deploy/config', { ...FIXTURE_CONFIG, cloudPath: 'ielts/../etc' })
ok(pathSaved.status === 400, '云路径穿越被拒绝')

const badAction = await post('/api/dsh-deploy/run', { action: 'drop-database' })
ok(badAction.status === 409 && badAction.body.ok === false, '未知动作被拒绝')

const started = await post('/api/dsh-deploy/run', { action: 'check' })
ok(started.status === 202 && started.body.ok === true, 'check 任务启动')

let finished = null
for (let i = 0; i < 40; i += 1) {
  await new Promise((r) => setTimeout(r, 500))
  const s = await get('/api/dsh-deploy/state')
  if (!s.body.run.running) {
    finished = s.body.run
    break
  }
}
ok(finished !== null, 'check 任务结束')
ok(Array.isArray(finished.log) && finished.log.length > 3, '日志已回传')
// The wording comes from the project's own check-deploy script, which a fixture
// cannot reproduce. Assert the log is real, and report the project-specific line
// when it is present.
console.log(`· 项目自检输出：${finished.log.some((l) => l.includes('本地版本')) ? '已捕获' : '(fixture 无 check-deploy，跳过)'}`)

const idleStop = await post('/api/dsh-deploy/stop', {})
ok(idleStop.status === 200 && idleStop.body.ok === false, '空闲时 stop 返回未运行')

ok(validateConfig({ ...DEFAULT_CONFIG, siteUrl: 'ftp://x' }) !== null, 'validateConfig 拒绝非 http 地址')
ok(sanitizeConfig({ projectDir: '  /tmp  ' }).projectDir === '/tmp', 'config 字符串 trim')

server.close()
console.log(`\n全部通过：${passed} 项断言 ✓`)
