/**
 * dsh-balance host smoke test — offline.
 *
 * Mounts the plugin on a fake DSH context, calls the route through a real HTTP
 * server, and checks only behaviour that needs no network and no real key:
 *
 *   1. the route is registered once, under the expected path
 *   2. the auth fence rejects an unauthenticated request
 *   3. with no stored key the route degrades to `ok:false` with a clear reason
 *      instead of throwing or hanging
 *   4. non-GET methods are refused
 *   5. disposing the effect unregisters the route
 *
 * The provider call itself is never attempted: DSH_HOME points at a temp dir
 * with no credentials file.
 */
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const work = await mkdtemp(path.join(tmpdir(), 'dsh-balance-test-'))
process.env.DSH_HOME = work
delete process.env.DEEPSEEK_API_KEY

const plugin = await import('../index.js')

let passed = 0
function ok(condition, label) {
  assert.ok(condition, label)
  passed += 1
  console.log(`✓ ${label}`)
}

/* -------------------------------------------------------------- fake context */

const registrations = []
const disposers = []
let fence = undefined

const ctx = {
  effect(fn, label) {
    const dispose = fn()
    disposers.push({ dispose, label })
    return dispose
  },
  inject(services, callback) {
    callback({
      effect(fn, label) {
        const dispose = fn()
        disposers.push({ dispose, label })
        return dispose
      },
      webServer: {
        register(spec) {
          registrations.push(spec)
          return () => {
            const at = registrations.indexOf(spec)
            if (at !== -1) registrations.splice(at, 1)
          }
        },
      },
      connection: { requestRejection: () => fence },
    })
  },
}

plugin.apply(ctx)

/* ------------------------------------------------------------------- checks */

console.log('\ndsh-balance host test (offline)\n')

ok(plugin.name === 'dsh-balance', 'plugin exports its name')
ok(registrations.length === 1, `exactly one route registered (got ${registrations.length})`)

const route = registrations[0]
ok(route.path === '/api/balance', `route path is /api/balance (got ${route.path})`)
ok(route.kind === 'exact', `route kind is exact (got ${route.kind})`)
ok(typeof route.handler === 'function', 'route has a handler')

const server = createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname !== route.path) {
    res.writeHead(404)
    res.end('no route')
    return
  }
  route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function call(method = 'GET') {
  const response = await fetch(base + '/api/balance', { method })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

// The fence is the host's own guard; when it fires the route must not run.
fence = 401
const unauthorized = await call()
ok(unauthorized.status === 401, `auth fence returns 401 (got ${unauthorized.status})`)

fence = 403
const forbidden = await call()
ok(forbidden.status === 403, `auth fence returns 403 (got ${forbidden.status})`)

// No fence, but also no key: a degraded answer, never a crash or a hang.
fence = undefined
const noKey = await call()
ok(noKey.status === 200, `no-key request answers 200 (got ${noKey.status})`)
ok(noKey.body?.ok === false, `no-key snapshot is ok:false (got ${JSON.stringify(noKey.body)?.slice(0, 80)})`)
ok(typeof noKey.body?.error === 'string' && noKey.body.error !== '', 'no-key snapshot explains the reason')
ok(!/sk-[A-Za-z0-9]{16,}/.test(JSON.stringify(noKey.body)), 'response never echoes a key')
ok(Array.isArray(noKey.body?.history), 'snapshot carries a history array')

const head = await call('HEAD')
ok(head.status === 200, `HEAD is allowed like other DSH routes (got ${head.status})`)

const posted = await call('POST')
ok(posted.status === 405, `POST is refused with 405 (got ${posted.status})`)

server.close()

// Disposal must leave nothing registered.
for (const { dispose } of disposers) dispose?.()
ok(registrations.length === 0, `dispose unregisters the route (left ${registrations.length})`)

console.log(`\n${passed} checks passed`)
