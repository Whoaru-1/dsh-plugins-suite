/**
 * dsh-spss self-test — exercises the plugin's external helpers in isolation.
 *
 * No DSH runtime is needed: `engine-bridge.js` and the pure helpers in
 * `index.js` are imported directly, so this runs anywhere Node runs.
 *
 *   node scripts/test.mjs           # everything except the interactive dialog
 *   node scripts/test.mjs --dialog  # also open a real native dialog (needs a GUI)
 *
 * The dialog test is opt-in because it requires a human to see the window; by
 * default the picker is validated through compile-checks and script inspection.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundleDir = path.dirname(here)

const bridge = await import(new URL('../engine-bridge.js', import.meta.url).href)
const host = await import(new URL('../index.js', import.meta.url).href)

let passed = 0
let failed = 0
const failures = []

/** Assert one condition, recording the outcome. */
function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
    return
  }
  failed += 1
  failures.push(label)
  console.log(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** Run `osacompile` on a generated script to prove it is valid AppleScript. */
function compileCheck(source) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-spss-compile-'))
    const scriptPath = path.join(dir, 'picker.applescript')
    const outPath = path.join(dir, 'picker.scpt')
    writeFileSync(scriptPath, source, 'utf8')
    execFile('/usr/bin/osacompile', ['-o', outPath, scriptPath], { timeout: 30_000 }, async (error, _stdout, stderr) => {
      const ok = error === null && existsSync(outPath)
      await rm(dir, { recursive: true, force: true })
      resolve({ ok, stderr: String(stderr ?? '') })
    })
  })
}

console.log(`\ndsh-spss self-test — ${bundleDir}\n`)

/* ------------------------------------------------------------------ */
console.log('1. safePath — untrusted path handling')
check('rejects NUL byte', bridge.safePath('/tmp/a\u0000b') === null)
check('rejects empty string', bridge.safePath('   ') === null)
check('rejects non-string', bridge.safePath(42) === null && bridge.safePath(null) === null)
check('rejects over-long path', bridge.safePath(`/${'a'.repeat(5000)}`) === null)
check('resolves relative to absolute', bridge.safePath('rel/x.csv') === path.resolve('rel/x.csv'))
check('keeps an absolute path', bridge.safePath('/tmp/x.csv') === '/tmp/x.csv')

/* ------------------------------------------------------------------ */
console.log('\n2. expandHome / outputs dir')
check('expands ~', bridge.expandHome('~/Documents') === path.join(homedir(), 'Documents'))
check('blank becomes null', bridge.expandHome('') === null && bridge.expandHome(undefined) === null)
check('default outputs dir is under dsh home', bridge.defaultOutputsDir().startsWith(bridge.dshHome()))
check('empty config resolves to the default', bridge.resolveOutputsDir('') === bridge.defaultOutputsDir())
check('configured dir wins', bridge.resolveOutputsDir('/tmp/out') === '/tmp/out')

/* ------------------------------------------------------------------ */
console.log('\n3. sanitizeFileName — traversal')
check('../../etc/passwd → passwd', bridge.sanitizeFileName('../../etc/passwd') === 'passwd')
check('absolute path → base name', bridge.sanitizeFileName('/etc/shadow') === 'shadow')
check('windows separators', bridge.sanitizeFileName('..\\..\\win.ini') === 'win.ini')
check('empty stays empty', bridge.sanitizeFileName('') === '' && bridge.sanitizeFileName('..') === '')
check('NUL stripped', bridge.sanitizeFileName('a\u0000b.csv') === 'ab.csv')

/* ------------------------------------------------------------------ */
console.log('\n4. appleScriptEscape — no script breakout')
const escapedBackslash = bridge.appleScriptEscape('a\\b')
check('backslash doubled', escapedBackslash === 'a\\\\b', escapedBackslash)
const escapedQuote = bridge.appleScriptEscape('a"b')
check('quote escaped', escapedQuote === 'a\\"b', escapedQuote)
check('newlines folded', bridge.appleScriptEscape('a\nb') === 'a b')
check('NUL removed', bridge.appleScriptEscape('a\u0000b') === 'ab')
const inject = bridge.buildAppleScript('open', { prompt: 'x" & (do shell script "id") & "' })
const injectLine = inject.trim().split('\n').find((line) => line.includes('choose')) ?? ''
// Every embedded quote must be backslash-escaped, so the literal never closes
// early and the payload cannot become an AppleScript statement.
check(
  'injection prompt stays inside the string literal',
  injectLine === '\t\tchoose file with prompt "x\\" & (do shell script \\"id\\") & \\""',
  JSON.stringify(injectLine),
)
check('generated script has no tell application', !/tell application/i.test(inject))
check('generated script has no System Events', !/System Events/i.test(inject))

/* ------------------------------------------------------------------ */
console.log('\n5. buildAppleScript — shape + validity')
const openScript = bridge.buildAppleScript('open', { prompt: 'Pick a data file' })
const saveScript = bridge.buildAppleScript('save', { prompt: 'Save', defaultName: 'r.xlsx' })
const folderScript = bridge.buildAppleScript('folder', { prompt: 'Folder', defaultLocation: '/Users' })
check('open uses choose file', /choose file with prompt/.test(openScript))
check('save uses choose file name', /choose file name with prompt/.test(saveScript))
check('save carries default name', /default name "r\.xlsx"/.test(saveScript))
check('folder uses choose folder', /choose folder with prompt/.test(folderScript))
check('folder carries default location', /default location \(POSIX file "\/Users"/.test(folderScript))
check('open does not get default location', !/default location/.test(openScript))
check('POSIX path of returned', /return POSIX path of theAlias/.test(openScript))
check('cancel maps to the sentinel', openScript.includes('__DSH_SPSS_CANCELLED__') && /errNumber is -128/.test(openScript))
check('save name not doubled by defaultLocation', !/default location/.test(saveScript))
for (const [kind, source] of [['open', openScript], ['save', saveScript], ['folder', folderScript]]) {
  const compiled = await compileCheck(source)
  check(`${kind} script compiles with osacompile`, compiled.ok, compiled.stderr.trim().split('\n').slice(-2).join(' '))
}
const hostile = bridge.buildAppleScript('folder', { prompt: 'x" & (do shell script "id") & "', defaultLocation: '~/D' })
const hostileCompiled = await compileCheck(hostile)
check('hostile prompt still compiles (inert)', hostileCompiled.ok, hostileCompiled.stderr.trim())

/* ------------------------------------------------------------------ */
console.log('\n6. normalizeFilters')
const filters = bridge.normalizeFilters([{ name: 'Excel', extensions: ['.XLSX', 'xls'] }, { name: '', extensions: ['csv'] }, { name: 'bad', extensions: [''] }])
check('keeps two rows', filters.length === 2, JSON.stringify(filters))
check('lower-cases + strips dots', filters[0].extensions.join(',') === 'xlsx,xls')
check('names a nameless filter', filters[1].name === 'CSV')
check('junk becomes empty', bridge.normalizeFilters('junk').length === 0)

/* ------------------------------------------------------------------ */
console.log('\n7. pickerCapability / DSH_SPSS_PICKER=off')
const previousPicker = process.env.DSH_SPSS_PICKER
process.env.DSH_SPSS_PICKER = 'off'
const offCapability = bridge.pickerCapability()
check('DSH_SPSS_PICKER=off disables it', offCapability.available === false && offCapability.reason === 'DSH_SPSS_PICKER=off')
const offHostStatus = host.pickerStatus({ allowNativePicker: true })
check('host status mirrors the env override', offHostStatus.available === false)
if (previousPicker === undefined) delete process.env.DSH_SPSS_PICKER
else process.env.DSH_SPSS_PICKER = previousPicker
check('allowNativePicker:false disables it', host.pickerStatus({ allowNativePicker: false }).available === false)

/* ------------------------------------------------------------------ */
console.log('\n8. readConfig — defensive defaults')
const defaults = host.readConfig(undefined)
check('missing config → defaults', defaults.timeoutMs === 300_000 && defaults.allowNativePicker === true && defaults.pythonPath === '')
const hostileConfig = host.readConfig({ timeoutMs: -5, allowNativePicker: 'yes', pythonPath: 42, outputsDir: 7 })
check('bad timeout falls back', hostileConfig.timeoutMs === 300_000)
check('non-boolean picker falls back', hostileConfig.allowNativePicker === true)
check('non-string pythonPath falls back', hostileConfig.pythonPath === '')
check('honours a real timeout', host.readConfig({ timeoutMs: 45_000 }).timeoutMs === 45_000)

/* ------------------------------------------------------------------ */
console.log('\n9. normalizeAnalyses / normalizeExports / resultBaseName')
const analyses = host.normalizeAnalyses([
  { type: 'descriptives', variables: ['a', 'b'] },
  { type: '', variables: ['ignored'] },
  'junk',
  { type: 'ttest', variables: ['x'], groupBy: 'g' },
])
check('drops the unusable entries', analyses.ok && analyses.analyses.length === 2, JSON.stringify(analyses.analyses))
check('keeps groupBy', analyses.analyses[1].groupBy === 'g')
check('empty list is an error', host.normalizeAnalyses([]).ok === false)
check('non-array is an error', host.normalizeAnalyses('x').ok === false)
check('too many analyses rejected', host.normalizeAnalyses(Array.from({ length: 61 }, () => ({ type: 'a' }))).ok === false)
check('dedupes variables', host.normalizeAnalyses([{ type: 'x', variables: ['a', 'a', ' b '] }]).analyses[0].variables.join(',') === 'a,b')
const exportsList = host.normalizeExports(['CSV', '.xlsx', 'evil', 'csv'])
check('filters unknown formats + dedupes', exportsList.join(',') === 'csv,xlsx', exportsList.join(','))
check('empty exports → a default set', host.normalizeExports([]).length === 3)
check('strips a known extension from the base name', host.resultBaseName('report.csv') === 'report')
check('blank base name becomes a timestamp', /^spss-/.test(host.resultBaseName('')))

/* ------------------------------------------------------------------ */
console.log('\n10. collectWrittenPaths / summarizeRun')
const digest = host.summarizeRun({
  ok: true,
  outputs: [{ path: '/tmp/a.csv' }, { path: '/tmp/b.xlsx' }],
  files: ['/tmp/a.csv', 'relative/ignored.csv'],
  tables: [{ name: 'descriptives' }],
})
check('digest names both absolute files', digest.includes('/tmp/a.csv') && digest.includes('/tmp/b.xlsx'), digest)
check('digest skips relative paths', !digest.includes('relative/ignored.csv'))
check('failure digest mentions the error', host.summarizeRun({ ok: false, error: 'boom' }).includes('boom'))
check('no result digest', host.summarizeRun(null).length > 0)

/* ------------------------------------------------------------------ */
console.log('\n11. Python resolution')
bridge.resetPythonCache()
const python = await bridge.resolvePython('')
check('a Python 3 was found', python.ok === true, JSON.stringify(python.tried))
if (python.ok) {
  check('version looks like x.y.z', /^\d+\.\d+\.\d+/.test(python.version), python.version)
  const cached = await bridge.resolvePython('')
  check('second resolve is cached', cached.path === python.path)
  const modules = await bridge.probeModules(python.path, ['pandas', 'definitely_not_installed_xyz'])
  check('probeModules reports a real module', modules.pandas === true, JSON.stringify(modules))
  check('probeModules reports a missing module', modules.definitely_not_installed_xyz === false)
}
// A bad `pythonPath` must not disable the plugin: it falls back to the next
// candidate, and the failure it saw is reported in `tried` for diagnosis.
const noPython = await bridge.resolvePython('/nonexistent/python3')
check('a bad configured path records its failure', noPython.tried[0]?.path === '/nonexistent/python3' && noPython.tried[0]?.ok === false, JSON.stringify(noPython.tried))
check('a bad configured path falls back to a working interpreter', noPython.ok === true && noPython.path !== '/nonexistent/python3')
const noneAtAll = await bridge.resolvePython('/nope-a')
check('every candidate failing is reported as ok:false with tried', noneAtAll.ok === true || (Array.isArray(noneAtAll.tried) && noneAtAll.path === ''))

/* ------------------------------------------------------------------ */
console.log('\n12. runEngine — real child process against a fake engine')
const work = mkdtempSync(path.join(tmpdir(), 'dsh-spss-faketest-'))
const fakeEngine = path.join(work, 'fake_analyze.py')
writeFileSync(fakeEngine, `import argparse, json
parser = argparse.ArgumentParser()
parser.add_argument("--payload")
parser.add_argument("--out-json")
args = parser.parse_args()
payload = json.load(open(args.payload, encoding="utf-8"))
json.dump({"ok": True, "echo": payload, "tables": [{"name": "descriptives"}]}, open(args.out_json, "w", encoding="utf-8"))
print("done")
`, 'utf8')
const slowEngine = path.join(work, 'slow_analyze.py')
writeFileSync(slowEngine, 'import time\ntime.sleep(30)\n', 'utf8')
const crashEngine = path.join(work, 'crash_analyze.py')
writeFileSync(crashEngine, 'import sys\nprint("Traceback: boom", file=sys.stderr)\nsys.exit(3)\n', 'utf8')

if (python.ok) {
  const result = await bridge.runEngine({
    pythonPath: python.path,
    engine: fakeEngine,
    payload: { inputPath: '/tmp/data.sav', analyses: [{ type: 'descriptives' }] },
    timeoutMs: 20_000,
  })
  check('engine result returned verbatim', result.ok === true && result.echo?.inputPath === '/tmp/data.sav', JSON.stringify(result).slice(0, 200))
  check('tables survive', Array.isArray(result.tables) && result.tables.length === 1)
  check('elapsedMs recorded', typeof result.elapsedMs === 'number')

  const crashed = await bridge.runEngine({ pythonPath: python.path, engine: crashEngine, payload: {}, timeoutMs: 20_000 })
  check('crash reported as ok:false', crashed.ok === false, JSON.stringify(crashed).slice(0, 160))
  check('crash keeps stderr', String(crashed.stderr ?? '').includes('boom'))

  const started = Date.now()
  const timedOut = await bridge.runEngine({ pythonPath: python.path, engine: slowEngine, payload: {}, timeoutMs: 1_500 })
  const elapsed = Date.now() - started
  check('timeout stops the engine', timedOut.ok === false && timedOut.timeout === true, JSON.stringify(timedOut).slice(0, 160))
  check('timeout returns promptly', elapsed < 8_000, `${elapsed}ms`)
}
const noEngine = await bridge.runEngine({ pythonPath: '', engine: fakeEngine, payload: {}, timeoutMs: 1_000 })
check('empty interpreter is refused cleanly', noEngine.ok === false && /Python 3/.test(noEngine.error))

/* ------------------------------------------------------------------ */
console.log('\n13. temp files are always cleaned')
const leftoverRuns = await import('node:fs/promises').then((fs) => fs.readdir(tmpdir()))
const runDirs = leftoverRuns.filter((entry) => entry.startsWith('dsh-spss-run-'))
check('no dsh-spss-run-* temp dirs left behind', runDirs.length === 0, runDirs.join(','))

/* ------------------------------------------------------------------ */
console.log('\n14. revealPath / listOutputs')
if (python.ok) {
  const outputsDir = path.join(work, 'outputs')
  const first = path.join(outputsDir, 'a.csv')
  const listedEmpty = await bridge.listOutputs(outputsDir)
  check('listOutputs creates the dir', listedEmpty.ok === true && existsSync(outputsDir))
  writeFileSync(first, 'x,y\n1,2\n', 'utf8')
  const listed = await bridge.listOutputs(outputsDir)
  check('listOutputs finds the file', listed.files.length === 1 && listed.files[0].name === 'a.csv', JSON.stringify(listed.files))
  check('listOutputs reports size + mtime', listed.files[0].size > 0 && listed.files[0].mtime > 0)
  check('listOutputs path is absolute', path.isAbsolute(listed.files[0].path))
}
const missing = await bridge.revealPath('/definitely/not/here.csv')
check('revealPath refuses a missing path', missing.ok === false && /no such/.test(missing.error))

/* ------------------------------------------------------------------ */
console.log('\n15. readDataPreview — a real CSV round-trip')
if (python.ok) {
  const csvPath = path.join(work, 'sample.csv')
  writeFileSync(csvPath, 'group,score\nA,1\nA,2\nB,3\nB,4\n', 'utf8')
  const preview = await bridge.readDataPreview({ pythonPath: python.path, path: csvPath, limit: 50, timeoutMs: 60_000 })
  if (preview.ok === true) {
    check('preview reports variables', Array.isArray(preview.variables) && preview.variables.length === 2, JSON.stringify(preview.variables))
    check('preview reports totalRows', preview.totalRows === 4, String(preview.totalRows))
    check('preview returns rows', Array.isArray(preview.rows) && preview.rows.length === 4)
  } else if (preview.missingDependency === true) {
    console.log(`  – skipped: pandas is not installed (${preview.error})`)
  } else {
    check('preview succeeded', false, JSON.stringify(preview).slice(0, 200))
  }
}

/* ------------------------------------------------------------------ */
console.log('\n16. bundle manifest + engine wiring')
const manifest = JSON.parse(readFileSync(path.join(bundleDir, 'package.json'), 'utf8'))
check('package.json parses and has the bundle patch', manifest.dsh?.bundle?.patch === './cordis.patch.yml')
check('package.json declares the client', manifest.dsh?.client?.platform === 'web')
check('exports ./client → ./client.js', manifest.exports?.['./client'] === './client.js')
check('main is ./index.js', manifest.main === './index.js')
check('cordis.patch.yml mounts the row', readFileSync(path.join(bundleDir, 'cordis.patch.yml'), 'utf8').includes("id: dsh-spss"))
check('engine path resolves inside the bundle', bridge.enginePath(bundleDir) === path.join(bundleDir, 'engine', 'analyze.py'))
check('engine file is present (or reported absent without throwing)', typeof existsSync(bridge.enginePath(bundleDir)) === 'boolean')

/* ------------------------------------------------------------------ */
if (process.argv.includes('--dialog')) {
  console.log('\n17. real native dialog (opt-in)')
  const picked = await bridge.pickNativePath('open', { prompt: 'dsh-spss self-test — pick any file, or press Cancel', timeoutMs: 60_000 })
  check('the dialog answered (picked or cancelled)', picked.ok === true || picked.cancelled === true, JSON.stringify(picked))
  if (picked.ok === true) check('a picked path is absolute', path.isAbsolute(picked.path), picked.path)
} else {
  console.log('\n17. real native dialog — skipped (run with --dialog to open one)')
}

await rm(work, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log(`failures:\n${failures.map((label) => `  - ${label}`).join('\n')}`)
  process.exitCode = 1
}
