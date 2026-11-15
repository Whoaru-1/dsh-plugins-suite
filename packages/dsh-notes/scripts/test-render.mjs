/**
 * Browser-surface harness: load the built client bundle under JSDOM, mount the
 * page through the real slot registrations, and exercise the whole note loop
 * (load → write → save → search → delete → undo).
 *
 * Run: node scripts/test-render.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dom = new JSDOM('<!doctype html><html lang="zh-CN"><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.localStorage = dom.window.localStorage
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.KeyboardEvent = dom.window.KeyboardEvent
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const ReactDOMClient = (await import('react-dom/client')).default
const ReactDOMModule = await import('react-dom')
const ReactDOM = ReactDOMModule.default ?? ReactDOMModule
const act = React.act
const jsxRuntime = await import('react/jsx-runtime')

/* ------------------------------------------------------------ host fixture */

const now = Date.now()
const seed = [
  {
    id: 'seed-note-1',
    text: '今天的第一条想法',
    color: 'yellow',
    createdAt: now,
    updatedAt: now,
  },
]
let saved = null
let getCalls = 0
let postCalls = 0

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

globalThis.fetch = async (url, options = {}) => {
  if (url !== '/api/dsh-notes') throw new Error(`unexpected fetch: ${url}`)
  if (options.method === 'POST') {
    postCalls += 1
    saved = JSON.parse(options.body).notes
    return jsonResponse({ ok: true, savedAt: Date.now(), notes: saved, rejected: 0 })
  }
  getCalls += 1
  return jsonResponse({ ok: true, notes: saved ?? seed, storage: 'saved', damaged: false })
}

/* ------------------------------------------------------- load the bundle */

const bundle = await readFile(path.join(root, 'lib', 'client.js'), 'utf8')
let plugin = null
dom.window.__ModuleLoader__ = {
  load({ id, factory }) {
    if (id !== 'dsh-notes') throw new Error(`unexpected module id: ${id}`)
    plugin = factory((name) => {
      if (name === 'react') return React
      if (name === 'react-dom') return ReactDOM
      if (name === 'react/jsx-runtime') return jsxRuntime
      throw new Error(`unexpected require: ${name}`)
    })
  },
}
new Function('window', bundle)(dom.window)
assert.ok(plugin !== null, 'bundle registered a module')
assert.equal(plugin.name, 'dsh-notes')
assert.deepEqual(plugin.inject, ['slots'])

/* ------------------------------------------------------- mount the plugin */

const registrations = []
const ctx = {
  effect(effect) {
    effect()
  },
  slots: {
    inject(_name, register) {
      register()
    },
    register(meta, component) {
      registrations.push({ meta, component })
      return () => {}
    },
  },
}
plugin.apply(ctx)

const panel = registrations.find((entry) => entry.meta.name === 'sidebar.panellist')
const main = registrations.find((entry) => entry.meta.name === 'main')
assert.ok(panel, 'sidebar.panellist registered')
assert.equal(panel.meta.id, 'notes')
assert.equal(panel.meta.label(), '便签')
assert.ok(main, 'main panel registered')
assert.equal(main.meta.key, 'notes')

const container = document.getElementById('app')
const rootInstance = ReactDOMClient.createRoot(container)
await act(async () => {
  rootInstance.render(React.createElement(plugin.__test.NotesPage))
  await new Promise((resolve) => setTimeout(resolve, 40))
})

async function tick(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

assert.equal(getCalls, 1, 'the page read the host list once')
assert.match(container.textContent, /便签/)
assert.match(container.textContent, /今天的第一条想法/)
assert.match(container.textContent, /今天/)
assert.match(container.textContent, /已保存/)

/* ------------------------------------------------------------ write a note */

function setValue(element, value) {
  const prototype =
    element instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}

const textarea = container.querySelector('textarea')
assert.ok(textarea, 'composer textarea exists')
await act(async () => {
  setValue(textarea, '第二个念头，关于傍晚的风。')
})
const saveButton = [...container.querySelectorAll('button')].find(
  (button) => button.textContent === '保存',
)
assert.ok(saveButton, 'save button exists')
await act(async () => {
  saveButton.click()
})
await tick(360)

assert.equal(postCalls, 1, 'one save request')
assert.equal(saved.length, 2, 'both notes are in the saved list')
assert.ok(saved.some((note) => note.text.includes('傍晚的风')))
assert.match(container.textContent, /傍晚的风/)
assert.equal(textarea.value, '', 'the composer clears after save')

/* ---------------------------------------------------------------- search */

const search = container.querySelector('input[type="search"]')
await act(async () => {
  setValue(search, '第一条')
})
await tick()
assert.match(container.textContent, /今天的第一条想法/)
assert.doesNotMatch(container.textContent, /傍晚的风/)

await act(async () => {
  setValue(search, '不存在的词')
})
await tick()
assert.match(container.textContent, /没有找到便签/)

await act(async () => {
  setValue(search, '')
})
await tick()

/* --------------------------------------------------------- delete + undo */

const deleteButton = container.querySelector('button[aria-label^="删除: 今天的第一条想法"]')
assert.ok(deleteButton, 'delete button exists')
await act(async () => {
  deleteButton.click()
})
await tick(360)
assert.doesNotMatch(container.textContent, /今天的第一条想法/)
assert.match(document.body.textContent, /已删除/)
assert.equal(saved.length, 1, 'delete reached the host')

const undoButton = [...document.body.querySelectorAll('button')].find(
  (button) => button.textContent === '撤销',
)
assert.ok(undoButton, 'undo action is offered')
await act(async () => {
  undoButton.click()
})
await tick(360)
assert.match(container.textContent, /今天的第一条想法/, 'undo puts the note back')
assert.equal(saved.length, 2, 'undo reached the host')

await act(async () => {
  rootInstance.unmount()
})

console.log('dsh-notes: render + interaction checks passed')
