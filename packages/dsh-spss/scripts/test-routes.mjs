/**
 * Route + tool integration test — boots `index.js` in a stub host context.
 *
 * The stub reproduces the three things `apply()` depends on and nothing more:
 * a `webServer` that accepts `{ kind, path, handler }` registrations, a
 * `connection.requestRejection(req)` fence, and an `inject`/`effect` pair that
 * mirrors Cordis's lifecycle. A real `node:http` server then serves those
 * handlers, so the routes are exercised over actual HTTP.
 *
 *   node scripts/test-routes.mjs
 *
 * Dialog routes are asserted against `DSH_SPSS_PICKER=off` by default (so the
 * suite never blocks on a human); pass `--dialog` to allow one real dialog.
 */
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundleDir = path.dirname(here)

// A throwaway DSH_HOME keeps the suite off the real profile and gives the
// outputs-dir assertions a known, per-pid root.
process.env.DSH_HOME = mkdtempSync(path.join(tmpdir(), `dsh-spss-routes-${process.pid}`))

let passed = 0
let failed = 0
const failures = []
function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    failures.push(label)
    console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/* ------------------------------------------------------------------ */
/* A minimal Cordis-shaped context.                                    */

const registrations = []
const tools = new Map()
const disposers = []

const webServer = {
  register: (entry) => {
    registrations.push(entry)
    return () => {
      const index = registrations.indexOf(entry)
      if (index >= 0) registrations.splice(index, 1)
    }
  },
}

const connection = {
  // The fence: a real Request carries no `dsh-session` cookie here, so the
  // stub mimics the "authorized" branch and the test asserts the contract by
  // flipping `deny` below.
  deny: false,
  requestRejection: (req) => {
    if (connection.deny) return 403
    if (req.headers['x-test-unauthorized'] === '1') return 401
    return undefined
  },
}

const toolRegistry = {
  register: (definition) => {
    if (tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
    tools.set(definition.name, definition)
    return () => tools.delete(definition.name)
  },
}

const ctx = {
  config: {
    // An isolated outputs dir so the test never touches the real one.
    outputsDir: path.join(tmpdir(), `dsh-spss-routes-${process.pid}`),
    timeoutMs: 60_000,
    allowNativePicker: true,
  },
  inject: (services, callback) => {
    const child = {
      webServer: services.includes('webServer') ? webServer : undefined,
      connection: services.includes('connection') ? connection : undefined,
      tools: services.includes('tools') ? toolRegistry : undefined,
      // `effect` runs the callback now and keeps its disposer.
      effect: (factory, label) => {
        const dispose = factory()
        disposers.push({ dispose, label })
      },
    }
    callback(child)
    return () => {}
  },
}

if (process.argv.includes('--dialog')) delete process.env.DSH_SPSS_PICKER
else process.env.DSH_SPSS_PICKER = 'off'

const host = await import(new URL('../index.js', import.meta.url).href)
// Cordis calls apply(ctx, config): the row's config is the SECOND argument.
host.apply(ctx, {
  pythonPath: '',
  timeoutMs: 300_000,
  // Empty => the plugin resolves <DSH_HOME>/dsh-spss/outputs, which the
  // assertions below expect under this test's temporary DSH_HOME.
  outputsDir: '',
  allowNativePicker: true,
})

console.log(`\ndsh-spss route + tool test — ${bundleDir}\n`)

/* ------------------------------------------------------------------ */
console.log('1. registration')
const route = registrations.find((entry) => entry.path === '/api/dsh-spss')
check('one route row registered', registrations.length === 1, JSON.stringify(registrations.map((r) => r.path)))
check('route path is /api/dsh-spss', route?.path === '/api/dsh-spss')
check('route is prefix kind', route?.kind === 'prefix')
check('route has a handler', typeof route?.handler === 'function')
check('two tools registered', tools.size === 2, [...tools.keys()].join(','))
check('spss_analyze registered', tools.has('spss_analyze'))
check('spss_list_outputs registered', tools.has('spss_list_outputs'))

/* ------------------------------------------------------------------ */
console.log('\n2. tool definitions match the ToolDefinition contract')
for (const [toolName, definition] of tools) {
  check(`${toolName}: has name/description/parameters`, typeof definition.name === 'string' && typeof definition.description === 'string' && definition.parameters?.type === 'object')
  check(`${toolName}: required is a sibling array (not in-property)`, definition.parameters?.required === undefined || Array.isArray(definition.parameters.required))
  check(`${toolName}: output.schema is an object schema`, definition.output?.schema?.type === 'object')
  check(`${toolName}: output.render is a function`, typeof definition.output?.render === 'function')
  check(`${toolName}: execute is a function`, typeof definition.execute === 'function')
  const blocks = definition.output.render({}, { ok: true, summary: 'hello', dir: '/tmp', count: 1 })
  check(`${toolName}: render returns ContentBlock[]`, Array.isArray(blocks) && blocks.length > 0 && blocks.every((block) => block && block.type === 'text' && typeof block.text === 'string'), JSON.stringify(blocks))
  const noValue = definition.output.render({}, null)
  check(`${toolName}: render survives a null value`, Array.isArray(noValue) && typeof noValue[0]?.text === 'string')
}
check('spss_analyze requires inputPath + analyses', JSON.stringify(tools.get('spss_analyze').parameters.required) === '["inputPath","analyses"]')
check('spss_analyze export enum is exact', JSON.stringify(tools.get('spss_analyze').parameters.properties.exports.items.enum) === '["csv","xlsx","docx","png","json","sav"]')

/* ------------------------------------------------------------------ */
console.log('\n3. HTTP routes')

const server = createServer((req, res) => {
  // Model BOTH forwarding styles a prefix mount can use, so the handler is
  // exercised the way the live host exercises it:
  //   - full:  the host leaves `req.url` at the full address, or
  //   - tail:  the host strips the mount prefix and passes only `/status`.
  // The live desktop host used the tail form, which reached the handler's 404
  // fallback while every full-path test passed.
  const full = registrations.filter((entry) => req.url.startsWith(entry.path)).at(-1)
  if (full !== undefined) {
    full.handler(req, res)
    return
  }
  const prefixRow = registrations.find((entry) => entry.kind === 'prefix')
  if (prefixRow === undefined) {
    res.writeHead(404)
    res.end('no route')
    return
  }
  prefixRow.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

/** Call one route and parse its JSON. */
async function call(method, routePath, body, headers = {}) {
  const response = await fetch(`${base}${routePath}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed, headers: response.headers }
}

const status = await call('GET', '/api/dsh-spss/status')
check('status is 200', status.status === 200)
check('status ok:true', status.body?.ok === true)
check('status reports python.path/version/ok', typeof status.body?.python?.path === 'string' && typeof status.body?.python?.version === 'string' && typeof status.body?.python?.ok === 'boolean', JSON.stringify(status.body?.python))
check('status reports enginePath inside the bundle', status.body?.enginePath === path.join(bundleDir, 'engine', 'analyze.py'))
check('status reports hasPyreadstat/hasScipy booleans', typeof status.body?.hasPyreadstat === 'boolean' && typeof status.body?.hasScipy === 'boolean')
check('status reports homeDir', typeof status.body?.homeDir === 'string' && status.body.homeDir.startsWith('/'))
check('status reports outputsDir ABSOLUTE and expanded', typeof status.body?.outputsDir === 'string' && path.isAbsolute(status.body.outputsDir) && status.body.outputsDir.includes('dsh-spss-routes-' + process.pid), status.body?.outputsDir)
check('status reports defaultOutBaseName', typeof status.body?.defaultOutBaseName === 'string' && status.body.defaultOutBaseName.startsWith('spss-'), status.body?.defaultOutBaseName)
check('status reports platform', status.body?.platform === process.platform)
check('status reports picker capability', typeof status.body?.picker?.available === 'boolean')
check('status: trailing slash resolves to the same route', (await call('GET', '/api/dsh-spss/status/')).status === 200)
check('status: query string is stripped', (await call('GET', '/api/dsh-spss/status?x=1')).body?.ok === true)
check('status: POST is 405', (await call('POST', '/api/dsh-spss/status', {})).status === 405)

/* A `kind: 'prefix'` registration may hand the handler either the full address
 * or only the tail after the mount point. The live host delivered the tail,
 * which reached the 404 fallback while every full-path test passed. Route both. */
const tailStatus = await call('GET', '/api/dsh-spss/status'.replace('/api/dsh-spss', ''))
check('status: host-stripped tail /status routes (200)', tailStatus.status === 200 && tailStatus.body?.ok === true, `got ${tailStatus.status}`)
check('routeTail maps both shapes to /status', host.routeTail('/api/dsh-spss/status') === '/status' && host.routeTail('/status') === '/status')
check('routeTail strips query, fragment, trailing and doubled slashes',
  host.routeTail('/api/dsh-spss/pick?a=1') === '/pick'
  && host.routeTail('/pick#x') === '/pick'
  && host.routeTail('/pick/') === '/pick'
  && host.routeTail('//api/dsh-spss//pick') === '/pick')
check('routeTail maps the bare mount point to /', host.routeTail('/api/dsh-spss') === '/' && host.routeTail('/api/dsh-spss/') === '/')
const tailOutputs = await call('GET', '/outputs')
check('outputs: host-stripped tail /outputs routes (200)', tailOutputs.status === 200 && tailOutputs.body?.ok === true, `got ${tailOutputs.status}`)
check('unknown tail still 404s', (await call('GET', '/nope')).status === 404)

const outputsEmpty = await call('GET', '/api/dsh-spss/outputs')
check('outputs is 200 with ok:true', outputsEmpty.status === 200 && outputsEmpty.body?.ok === true)
check('outputs lists files array', Array.isArray(outputsEmpty.body?.files))
check('outputs dir is the configured one', outputsEmpty.body?.dir?.includes(`dsh-spss-routes-${process.pid}`), outputsEmpty.body?.dir)

/* A blank config.outputsDir must resolve to <DSH_HOME>/dsh-spss/outputs for
 * BOTH the listing route and a run; passing '' onward used to raise
 * "mkdir '' -> ENOENT" and silently divert results to a temp dir. */
const defaultOutputs = path.join(process.env.DSH_HOME, 'dsh-spss', 'outputs')
const defaultListing = await host.performListOutputs({ config: { outputsDir: '' } })
check('blank outputsDir resolves for listing', defaultListing.ok === true && defaultListing.dir === defaultOutputs, JSON.stringify(defaultListing).slice(0, 160))
const defaultRun = await host.performRun({
  config: { outputsDir: '', timeoutMs: 120_000, pythonPath: '' },
  body: {
    inputPath: path.join(bundleDir, 'engine', 'sample_data.csv'),
    analyses: [{ type: 'descriptives', variables: ['age'] }],
    exports: ['csv'],
    outBaseName: 'default-dir-check',
  },
})
const defaultRunPath = defaultRun.outputs?.find((entry) => entry.kind === 'csv')?.path ?? ''
check('blank outputsDir resolves for a run', defaultRun.ok === true && defaultRunPath.startsWith(defaultOutputs), defaultRunPath || JSON.stringify(defaultRun).slice(0, 160))

const pickOff = await call('POST', '/api/dsh-spss/pick', { kind: 'open', title: 'pick a file' })
check('pick with DSH_SPSS_PICKER=off returns unsupported immediately', pickOff.status === 200 && pickOff.body?.unsupported === true, JSON.stringify(pickOff.body))
check('pick unsupported carries a hint for the UI fallback', typeof pickOff.body?.hint === 'string' && pickOff.body.hint !== '')
check('pick unsupported never includes a path', pickOff.body?.path === undefined)
const pickDirOff = await call('POST', '/api/dsh-spss/pick-dir', {})
check('pick-dir with picker off returns unsupported', pickDirOff.body?.unsupported === true)
check('pick rejects a bad kind', (await call('POST', '/api/dsh-spss/pick', { kind: 'nonsense' })).body?.ok === false)
check('pick rejects malformed JSON with 400', (await call('POST', '/api/dsh-spss/pick', '{not json')).status === 400)

const runBad = await call('POST', '/api/dsh-spss/run', { analyses: [{ type: 'descriptives' }] })
check('run without inputPath fails cleanly', runBad.status === 200 && runBad.body?.ok === false, JSON.stringify(runBad.body))
check('run explains the missing inputPath', /inputPath/.test(String(runBad.body?.error)))
const runNul = await call('POST', '/api/dsh-spss/run', { inputPath: '/tmp/a\u0000b.csv', analyses: [{ type: 'descriptives' }] })
check('run refuses a NUL byte in inputPath', runNul.body?.ok === false && /NUL/.test(String(runNul.body?.error)), JSON.stringify(runNul.body?.error))
const runNoAnalyses = await call('POST', '/api/dsh-spss/run', { inputPath: '/tmp/a.csv' })
check('run refuses a missing analyses list', runNoAnalyses.body?.ok === false && /analyses/.test(String(runNoAnalyses.body?.error)))

const openBad = await call('POST', '/api/dsh-spss/open-path', { path: '/definitely/not/here.csv' })
check('open-path reports a missing target', openBad.status === 200 && openBad.body?.ok === false, JSON.stringify(openBad.body))
check('open-path rejects a NUL byte with 400', (await call('POST', '/api/dsh-spss/open-path', { path: '/tmp/a\u0000b' })).status === 400)
check('open-path rejects a missing path with 400', (await call('POST', '/api/dsh-spss/open-path', {})).status === 400)

const readBad = await call('POST', '/api/dsh-spss/read-data', { path: '/tmp/definitely-missing.csv' })
check('read-data on a missing file fails cleanly', readBad.status === 200 && readBad.body?.ok === false, JSON.stringify(readBad.body).slice(0, 160))
check('read-data rejects a NUL byte with 400', (await call('POST', '/api/dsh-spss/read-data', { path: '/tmp/a\u0000.csv' })).status === 400)

check('unknown route is 404', (await call('GET', '/api/dsh-spss/nope')).status === 404)

console.log('\n4. the connection fence')
const unauthorized = await call('GET', '/api/dsh-spss/status', undefined, { 'x-test-unauthorized': '1' })
check('401 from the fence short-circuits the route', unauthorized.status === 401, String(unauthorized.status))
connection.deny = true
const forbidden = await call('GET', '/api/dsh-spss/status')
check('403 from the fence short-circuits the route', forbidden.status === 403, String(forbidden.status))
check('a fenced request leaks no status payload', forbidden.body !== true && forbidden.body?.ok === undefined)
connection.deny = false

/* ------------------------------------------------------------------ */
console.log('\n5. tools execute over the same operations')
process.env.DSH_SPSS_PICKER = 'off'
const work = mkdtempSync(path.join(tmpdir(), 'dsh-spss-tools-'))
const csvPath = path.join(work, 'data.csv')
writeFileSync(csvPath, 'group,score\nA,1\nA,2\nB,3\nB,4\n', 'utf8')

const toolExec = { signal: new AbortController().signal, callId: 'test', name: 'x', arguments: {} }
const analyzeTool = tools.get('spss_analyze')
const analyzeResult = await analyzeTool.execute({ inputPath: csvPath, analyses: [{ type: 'descriptives', variables: ['score'] }], exports: ['csv'] }, toolExec)
check('spss_analyze returns an object', analyzeResult !== null && typeof analyzeResult === 'object')
check('spss_analyze includes a summary digest', typeof analyzeResult.summary === 'string' && analyzeResult.summary.length > 0, JSON.stringify(analyzeResult).slice(0, 200))
const analyzeBlocks = analyzeTool.output.render({ inputPath: csvPath, analyses: [] }, analyzeResult)
check('spss_analyze render produces a ContentBlock', Array.isArray(analyzeBlocks) && typeof analyzeBlocks[0]?.text === 'string' && analyzeBlocks[0].text.length > 0)

const listTool = tools.get('spss_list_outputs')
const listResult = await listTool.execute({}, toolExec)
check('spss_list_outputs returns count + dir', typeof listResult.count === 'number' && typeof listResult.dir === 'string', JSON.stringify(listResult).slice(0, 160))
check('spss_list_outputs summary is a string', typeof listResult.summary === 'string')
const listBlocks = listTool.output.render({}, listResult)
check('spss_list_outputs render produces a ContentBlock', Array.isArray(listBlocks) && typeof listBlocks[0]?.text === 'string')
const badList = await listTool.execute({ dir: '/tmp/a\u0000b' }, toolExec)
check('spss_list_outputs falls back to the default dir on a bad path', typeof badList.dir === 'string' && !badList.dir.includes('\u0000'), badList.dir)

/* ------------------------------------------------------------------ */
console.log('\n6. lifecycle')
check('two effects are held (route + tools)', disposers.length === 2, String(disposers.length))
for (const { dispose } of disposers) dispose()
check('disposing removes the route', registrations.length === 0)
check('disposing removes both tools', tools.size === 0, [...tools.keys()].join(','))
server.close()
await rm(work, { recursive: true, force: true })
await rm(ctx.config.outputsDir, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log(`failures:\n${failures.map((label) => `  - ${label}`).join('\n')}`)
  process.exitCode = 1
}
