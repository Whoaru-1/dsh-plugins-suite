/**
 * Offline wiring harness for the client half.
 *
 * The built bundle is loaded as CommonJS with a stubbed module table — React is
 * a tiny hook simulator, so a component can be rendered as a plain call — and a
 * stubbed cordis context. What it proves:
 *
 *   - the bundle's registration contract (`{ id, factory }` → `{ name, inject,
 *     apply }`);
 *   - `apply` registers exactly the two seats this plugin owns, with the ids and
 *     injected faces the slot runtime expects;
 *   - the header tray renders nothing on an empty conversation, and renders the
 *     button + popover once the ledger has files, opening the popover on click
 *     and opening a file through the injected sidebar face.
 *
 * Run: node scripts/test-wiring.cjs
 * (CommonJS on purpose: the bundle assigns `module.exports`.)
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')
const { pathToFileURL } = require('node:url')

const root = path.dirname(__dirname)

/* ------------------------------------------------------------------ module table */

/** A tiny React stand-in: `createElement` records a tree, hooks have slots. */
const hookSlots = []
let hookIndex = 0
let pendingEffects = []

const reactStub = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const flat = []
    const push = (value) => {
      if (value === null || value === undefined || value === false) return
      if (Array.isArray(value)) value.forEach(push)
      else flat.push(value)
    }
    children.forEach(push)
    return { type, props: { ...(props ?? {}), children: flat.length === 1 ? flat[0] : flat } }
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useEffect: (fn) => {
    pendingEffects.push(fn)
  },
  useLayoutEffect: (fn) => {
    pendingEffects.push(fn)
  },
  useState(initial) {
    const index = hookIndex++
    if (hookSlots[index] === undefined) hookSlots[index] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      hookSlots[index] = typeof next === 'function' ? next(hookSlots[index]) : next
    }
    return [hookSlots[index], set]
  },
  useSyncExternalStore(_subscribe, read) {
    return read()
  },
  memo: (component) => component,
}

let pending = null
globalThis.window = {
  __ModuleLoader__: {
    load: (record) => {
      pending = record
    },
  },
  // The tray's popover adds a dismissal listener on the window.
  innerWidth: 1280,
  addEventListener: () => {},
  removeEventListener: () => {},
}

const requireStub = (specifier) => {
  if (specifier === 'react') return reactStub
  if (specifier === 'react-dom') return { createPortal: (node) => node }
  throw new Error(`unexpected require: ${specifier}`)
}

// eslint-disable-next-line no-new-func
new Function('require', 'module', 'exports', fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8'))(
  requireStub,
  { exports: {} },
  {},
)

assert.ok(pending !== null, 'the bundle registered a module')
assert.equal(pending.id, 'dsh-file-tray', 'module id')
const plugin = pending.factory(requireStub)
assert.equal(plugin.name, 'dsh-file-tray', 'plugin name')
assert.deepEqual(plugin.inject, ['slots', 'sidebarRight'], 'declared services')
assert.equal(typeof plugin.apply, 'function', 'apply is exported')
assert.equal(typeof plugin.__test.FileTray, 'function', 'the test face rides along')

/* ----------------------------------------------------------------------- dom */

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
globalThis.document = dom.window.document
globalThis.window.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
// The plugin picks its copy from the document language, so pin it.
dom.window.document.documentElement.lang = 'zh-CN'

/** Render one component call, running its effects once. */
function render(component, props) {
  hookIndex = 0
  pendingEffects = []
  const tree = component({ ...props })
  const effects = pendingEffects
  pendingEffects = []
  for (const effect of effects) {
    const dispose = effect()
    if (typeof dispose === 'function') pendingEffects.push(dispose)
  }
  return tree
}

/* ----------------------------------------------------------------- apply() */

const registrations = []
const opened = []
const ctx = {
  effect: (callback) => callback(),
  slots: {
    inject: (name, callback) => {
      callback()
    },
    register: (options) => {
      registrations.push(options)
      return () => {}
    },
  },
  sidebarRight: {
    openResource: (address) => {
      opened.push(address)
    },
  },
}

plugin.apply(ctx)

assert.equal(registrations.length, 2, 'apply registers exactly two seats')
const headerEntry = registrations.find((entry) => entry.name === 'conversation.session.header.utilities')
const tailEntry = registrations.find((entry) => entry.name === 'conversation.chat.turnTail')
assert.ok(headerEntry !== undefined, 'the header utilities seat is registered')
assert.ok(tailEntry !== undefined, 'the turn-tail seat is registered')
assert.equal(headerEntry.id, 'dsh-file-tray', 'the header entry carries the plugin id')
assert.equal(headerEntry.order, 20, 'the header entry has its order')
assert.equal(typeof headerEntry.inject, 'function', 'the header entry injects a face')
const face = headerEntry.inject()
assert.equal(typeof face.sidebarRight.openResource, 'function', 'the injected face opens resources')
assert.equal(headerEntry.component, undefined, 'the component is passed positionally, not as an option')

const { FileTray, ProducedFileRecorder } = plugin.__test
assert.equal(typeof FileTray, 'function', 'the tray component is exported for tests')
assert.equal(typeof ProducedFileRecorder, 'function', 'the recorder component is exported for tests')

/* ---------------------------------------------------------------- the tray */

const sessionId = 'session-abc'
const useSessions = (select) => select({ byId: { [sessionId]: { cwd: '/Users/me/work' } } })

// Empty conversation: the tray renders nothing at all, so the header is
// untouched until there is something to list.
assert.equal(render(FileTray, { sessionId, useSessions, sidebarRight: face.sidebarRight }), null, 'an empty ledger renders nothing')

// The invisible recorder feeds the ledger from a turn's deliverables.
const turn = { turn: 3, data: { get: (key) => (key === 'deliverables' ? { produced: [{ path: 'out/chart.svg', seq: 7 }] } : undefined) } }
assert.equal(render(ProducedFileRecorder, { turn, seq: 9, sessionId }), null, 'the recorder renders no DOM')

// Now the tray shows the button, with the count on it.
const closed = render(FileTray, { sessionId, useSessions, sidebarRight: face.sidebarRight })
assert.equal(closed.type, 'button', 'the tray is a button')
assert.equal(closed.props['data-file-tray-button'], '', 'the button carries its marker')
assert.equal(closed.props.title, '本次对话产出的文件', 'the Chinese copy is used for a zh document')
const badge = closed.props.children.find((child) => child?.props?.children === '1')
assert.ok(badge !== undefined, 'the badge shows the produced-file count')

// The dictionary follows the document language.
dom.window.document.documentElement.lang = 'en-US'
const english = render(FileTray, { sessionId, useSessions, sidebarRight: face.sidebarRight })
assert.equal(english.props.title, 'Files produced in this conversation', 'the English copy is used for an en document')
dom.window.document.documentElement.lang = 'zh-CN'

// Clicking opens the popover, which lists one row per file.
closed.props.onClick({ preventDefault() {}, stopPropagation() {} })
const open = render(FileTray, { sessionId, useSessions, sidebarRight: face.sidebarRight })
assert.equal(open.type, reactStub.Fragment, 'the open tray is the button plus the portal')
const panel = open.props.children[1]
assert.ok(panel !== null && typeof panel === 'object', 'the portal element exists')
assert.equal(panel.props['data-file-tray-panel'], '', 'the panel carries its marker')
const rows = []
const walk = (node) => {
  if (node === null || typeof node !== 'object') return
  if (node.props?.['data-file-tray-row'] !== undefined) rows.push(node)
  const children = node.props?.children
  if (Array.isArray(children)) children.forEach(walk)
  else if (children !== undefined) walk(children)
}
walk(panel)
assert.equal(rows.length, 1, 'one row per produced file')
assert.equal(rows[0].props['data-file-tray-row'], 'out/chart.svg', 'the row names the produced path')

// Clicking a row opens that file through the sidebar face.
rows[0].props.onClick()
assert.deepEqual(opened, ['dsh-resource://file/session/session-abc/out/chart.svg'], 'the row opens the file resource')

/* -------------------------------------------------- retired preview sheet */

/** Load the ESM helper under test from source. */
const loadRetire = () => import(pathToFileURL(path.join(root, 'src', 'image-fit.js')).href)



loadRetire().then(({ retireImagePreviewLayer }) => {
// An earlier build of this plugin appended a preview stylesheet. A page that
// is still running it must land on the bundled behaviour after a reload, so
// `apply` retires exactly that sheet — and nothing else.
const stale = document.createElement('style')
stale.dataset.plugin = 'dsh-file-tray'
stale.dataset.pluginCss = 'dsh-file-tray/image-fit'
document.head.appendChild(stale)
const foreign = document.createElement('style')
foreign.dataset.plugin = 'someone-else'
foreign.dataset.pluginCss = 'dsh-file-tray/image-fit'
document.head.appendChild(foreign)

assert.equal(retireImagePreviewLayer(), 1, 'the retired sheet is removed once')
assert.equal(document.head.contains(stale), false, 'the stale sheet is gone')
assert.equal(document.head.contains(foreign), true, 'a sheet this plugin did not stamp is left alone')
assert.equal(retireImagePreviewLayer(), 0, 'the cleanup is idempotent')

console.log('dsh-file-tray: wiring harness passed')
})

