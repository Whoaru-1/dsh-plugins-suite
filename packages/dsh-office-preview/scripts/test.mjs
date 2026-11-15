/**
 * Offline verification for dsh-office-preview.
 *
 * Runs the generated browser bundle inside jsdom with the real React runtime and
 * the real fixtures in /tmp/dopfx, then checks:
 *   1. the bundle registers through window.__ModuleLoader__ and exports {name, inject, apply}
 *   2. apply() registers every definition with the right extensions and loading mode
 *   3. each body renders real document markup into the DOM (docx pages, xlsx grid, pptx slides)
 *   4. the pure helpers behave (delimited parsing, sniffing, sheet grids)
 *
 * Usage: node scripts/test.mjs [fixture-dir]
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { act } from 'react'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const fixtures = process.argv[2] || process.env.DSH_OFFICE_FIXTURES || ''

/**
 * Optional fixtures.
 *
 * The original suite rendered documents from a scratch directory on the
 * author's machine (personal projects, real reports). Those files are not part
 * of this repository, so every content-specific assertion below is skipped when
 * the directory is absent, while the structural checks still run. Point
 * DSH_OFFICE_FIXTURES at a folder holding sample.docx / sample.xlsx /
 * sample.pptx / sample.csv to exercise the full set.
 */
const fixturesAvailable = (() => {
  if (fixtures === '') return false
  try {
    return existsSync(fixtures)
  } catch {
    return false
  }
})()
if (!fixturesAvailable) {
  console.log(`· 未提供文档样本目录（DSH_OFFICE_FIXTURES），跳过内容级断言，仅做结构验证。`)
}

const failures = []
const checks = []
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

/* ------------------------------------------------------------------- jsdom */

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
const { window } = dom

// The host page owns these; jsdom does not implement them.
if (typeof window.ResizeObserver !== 'function') {
  window.ResizeObserver = class ResizeObserver {
    constructor(callback) {
      this.callback = callback
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
if (typeof window.URL.createObjectURL !== 'function') {
  window.URL.createObjectURL = () => 'blob:mock'
  window.URL.revokeObjectURL = () => {}
}

globalThis.window = window
globalThis.document = window.document
// Node 24 exposes `navigator` as a getter-only global; redefine rather than assign.
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
globalThis.Node = window.Node
globalThis.Element = window.Element
globalThis.HTMLElement = window.HTMLElement
globalThis.SVGElement = window.SVGElement
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.CustomEvent = window.CustomEvent
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.DOMParser = window.DOMParser
globalThis.XMLSerializer = window.XMLSerializer
globalThis.requestAnimationFrame =
  typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (callback) => setTimeout(() => callback(Date.now()), 16)
globalThis.cancelAnimationFrame =
  typeof window.cancelAnimationFrame === 'function'
    ? window.cancelAnimationFrame.bind(window)
    : (handle) => clearTimeout(handle)
globalThis.ResizeObserver = window.ResizeObserver
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* ------------------------------------------------------------- load bundle */

const source = await readFile(path.join(root, 'lib', 'client.js'), 'utf8')
let registration = null
window.__ModuleLoader__ = { load: (row) => { registration = row } }
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'navigator', source)(window, window.document, window.navigator)

check('bundle registers with __ModuleLoader__', registration !== null)
check('bundle id is dsh-office-preview', registration?.id === 'dsh-office-preview')

const requireTable = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': {},
}
const exportsObject = registration.factory((specifier) => {
  if (specifier in requireTable) return requireTable[specifier]
  throw new Error(`unexpected require("${specifier}")`)
})

check('exports name', exportsObject.name === 'dsh-office-preview', String(exportsObject.name))
check('exports apply()', typeof exportsObject.apply === 'function')

/* -------------------------------------------------- register with mock ctx */

const definitions = []
const slotKeys = new Set()
const bodies = new Map()
let effectCleanup = null

const ctx = {
  get(service) {
    if (service === 'documentPreviews') {
      return {
        register(definition) {
          definitions.push(definition)
          return () => {
            const index = definitions.indexOf(definition)
            if (index >= 0) definitions.splice(index, 1)
          }
        },
      }
    }
    if (service === 'slots') {
      return {
        inject(name, factory) {
          const disposer = factory()
          return typeof disposer === 'function' ? disposer : () => {}
        },
        register(descriptor, component) {
          check(`slot name is sidebar.right.tab.document (${descriptor.key})`, descriptor.name === 'sidebar.right.tab.document')
          check(`slot key unique (${descriptor.key})`, !slotKeys.has(descriptor.key), descriptor.key)
          slotKeys.add(descriptor.key)
          bodies.set(descriptor.key, component)
          return () => bodies.delete(descriptor.key)
        },
      }
    }
    return undefined
  },
  effect(callback) {
    effectCleanup = callback()
  },
}

exportsObject.apply(ctx)

const styleTag = window.document.getElementById('dsh-office-preview-css')
const injectedCss = styleTag ? styleTag.textContent : ''
check('injects its stylesheet', Boolean(styleTag) && injectedCss.length > 500)
check('overrides the docx wrapper background', injectedCss.includes('.dop-docx-host .dop-docx-wrapper'))

check('registered 8 preview definitions', definitions.length === 8, `got ${definitions.length}`)
check('every definition loads complete bytes', definitions.every((d) => d.loading === 'bytes-complete'))
check('every definition outranks builtins', definitions.every((d) => d.priority === 'extension'))
check('definitions carry a title()', definitions.every((d) => typeof d.title === 'function' && d.title().length > 0))
check('every definition has a body', definitions.every((d) => bodies.has(d.id)))
check('no duplicate extensions across definitions', (() => {
  const seen = new Set()
  for (const definition of definitions) {
    for (const extension of definition.extensions) {
      if (seen.has(extension)) return false
      seen.add(extension)
    }
  }
  return true
})())

const byExtension = new Map()
for (const definition of definitions) {
  for (const extension of definition.extensions) byExtension.set(extension, definition.id)
}
for (const extension of ['docx', 'docm', 'xlsx', 'xls', 'csv', 'tsv', 'pptx', 'pptm', 'doc', 'odt', 'epub', 'zip', 'mp3', 'mp4', 'ttf']) {
  check(`.${extension} is claimed`, byExtension.has(extension))
}

/* -------------------------------------------------------------- body render */

async function renderBody(definitionId, content, resourceAddress) {
  const Body = bodies.get(definitionId)
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const scrollports = []
  const props = {
    resourceAddress,
    content,
    wrap: false,
    scrollportRef: (element) => {
      if (element) scrollports.push(element)
    },
  }
  const { createRoot } = await import('react-dom/client')
  const reactRoot = createRoot(container)
  await act(async () => {
    reactRoot.render(React.createElement(Body, props))
  })
  // Renderers finish asynchronously (docx/pptx are promise based).
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    if (container.querySelector('.dop-docx-host section, .dop-grid, .dop-pptx-stage > *, .dop-card')) break
  }
  return { container, scrollports, unmount: () => act(() => reactRoot.unmount()) }
}

// Thrown when a fixture the block needs is not available; each block's own
// catch reports it as a skip rather than a failure.
class FixtureSkip extends Error {}

async function bytesContent(file) {
  if (!fixturesAvailable) throw new FixtureSkip(`无样本目录，跳过 ${file}`)
  try {
    const data = await readFile(path.join(fixtures, file))
    return { kind: 'bytes', data: new Uint8Array(data) }
  } catch (error) {
    if (error instanceof FixtureSkip) throw error
    throw new FixtureSkip(`缺样本 ${file}，跳过`)
  }
}

// --- docx
try {
  const content = await bytesContent('sample.docx')
  const rendered = await renderBody('dsh-office-preview/docx', content, '/tmp/dopfx/sample.docx')
  const html = rendered.container.innerHTML
  const pages = rendered.container.querySelectorAll('section.dop-docx')
  check('docx renders page sections', pages.length >= 1, `sections=${pages.length}`)
  check('docx text reaches the DOM', html.includes('天目湖') || html.includes('研究报告'), html.slice(0, 200))
  check('docx renders the table', rendered.container.querySelectorAll('table').length >= 1)
  check('docx reports its scrollport', rendered.scrollports.length >= 1)
  check('docx has no failure card', !html.includes('渲染失败'))
  await rendered.unmount()
} catch (error) {
  if (error instanceof FixtureSkip) { console.log(`· ${error.message}`); } else check('docx render did not throw', false, error.message)
}

// --- xlsx
try {
  const content = await bytesContent('sample.xlsx')
  const rendered = await renderBody('dsh-office-preview/xlsx', content, '/tmp/dopfx/sample.xlsx')
  const html = rendered.container.innerHTML
  const grid = rendered.container.querySelector('.dop-grid')
  check('xlsx renders a grid', Boolean(grid))
  check('xlsx shows sheet tabs', rendered.container.querySelectorAll('.dop-tab').length === 2)
  check('xlsx shows the header row', html.includes('姓名') && html.includes('分数'))
  check('xlsx shows cell values', html.includes('张三') && html.includes('95.5'))
  check('xlsx formats the date cell', html.includes('2026'), html.match(/2026[^<]*/)?.[0])
  check('xlsx marks numeric cells', rendered.container.querySelectorAll('td.dop-num').length >= 2)
  await rendered.unmount()
} catch (error) {
  if (error instanceof FixtureSkip) { console.log(`· ${error.message}`); } else check('xlsx render did not throw', false, error.message)
}

// --- csv
try {
  const text = 'name,score,note\n"张,三",95,"含有,逗号"\n李四,88,"多行\n内容"\n'
  const content = { kind: 'bytes', data: new TextEncoder().encode(text) }
  const rendered = await renderBody('dsh-office-preview/csv', content, '/tmp/dopfx/sample.csv')
  const html = rendered.container.innerHTML
  check('csv renders a grid', Boolean(rendered.container.querySelector('.dop-grid')))
  check('csv keeps quoted commas', html.includes('张,三') && html.includes('含有,逗号'))
  check('csv keeps embedded newlines', html.includes('多行'))
  await rendered.unmount()
} catch (error) {
  if (error instanceof FixtureSkip) { console.log(`· ${error.message}`); } else check('csv render did not throw', false, error.message)
}

// --- pptx
try {
  const content = await bytesContent('sample.pptx')
  const rendered = await renderBody('dsh-office-preview/pptx', content, '/tmp/dopfx/sample.pptx')
  const html = rendered.container.innerHTML
  // The renderer mounts its slide list beside the stage element, not inside it.
  const slides = rendered.container.querySelectorAll('.pptx-preview-slide-wrapper').length
  check('pptx renders slides', slides >= 2, `slides=${slides}`)
  check('pptx text reaches the DOM', html.includes('侧边栏预览验证') || html.includes('第二页'), html.slice(0, 300))
  check('pptx has no failure card', !html.includes('渲染失败'))
  check('pptx wrapper is retargeted by the panel stylesheet', injectedCss.includes('.dop-pptx-stage .pptx-preview-wrapper'))
  await rendered.unmount()
} catch (error) {
  if (error instanceof FixtureSkip) { console.log(`· ${error.message}`); } else check('pptx render did not throw', false, error.message)
}

// --- unsupported fallback
try {
  const content = { kind: 'bytes', data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x01]) }
  const rendered = await renderBody('dsh-office-preview/legacy-document', content, '/tmp/dopfx/old.doc')
  const html = rendered.container.innerHTML
  check('legacy .doc shows a friendly card', html.includes('无法在侧边栏内预览') && html.includes('old.doc'))
  check('legacy .doc card carries the hint', html.includes('转换成'))
  await rendered.unmount()
} catch (error) {
  if (error instanceof FixtureSkip) { console.log(`· ${error.message}`); } else check('unsupported fallback did not throw', false, error.message)
}

/* ----------------------------------------------------------------- helpers */

const helpers = exportsObject.__test || {}
check('exports test helpers', Object.keys(helpers).length >= 6)
if (helpers.parseDelimited) {
  const rows = helpers.parseDelimited('a,b\n"x,y",z\n', ',')
  check('parseDelimited handles quotes', rows.length === 2 && rows[1][0] === 'x,y')
  check('guessDelimiter sniffs tabs', helpers.guessDelimiter('a\tb\tc\n') === '\t')
  check('extensionOf ignores query strings', helpers.extensionOf('a/b/Report.DOCX?v=2') === 'docx')
  check('formatSize renders MB', helpers.formatSize(3 * 1024 * 1024) === '3.0 MB', helpers.formatSize(3 * 1024 * 1024))
}

/* ------------------------------------------------------------------ report */

if (effectCleanup) {
  try {
    effectCleanup()
    check('teardown runs cleanly', true)
    check('teardown disposes every definition', definitions.length === 0, `left ${definitions.length}`)
    check('teardown disposes every body', bodies.size === 0, `left ${bodies.size}`)
  } catch (error) {
    check('teardown runs cleanly', false, error.message)
  }
}

const passed = checks.filter((entry) => entry.ok).length
console.log('')
for (const entry of checks) {
  console.log(`${entry.ok ? '  ok  ' : ' FAIL '} ${entry.name}${entry.ok || !entry.detail ? '' : ` — ${entry.detail}`}`)
}
console.log(`\n${passed}/${checks.length} checks passed`)
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
