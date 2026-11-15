/**
 * End-to-end harness for the client half, under real React.
 *
 * The wiring harness proves the plugin's contract; this one proves the actual
 * component: it loads the built bundle with real React 18 and react-dom, mounts
 * the tray the way the slot runtime would, and drives it through the DOM —
 * click the button, click a row, and read the resource address that reaches the
 * injected sidebar face.
 *
 * Run: node scripts/test-e2e.cjs
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const projectRoot = path.dirname(__dirname)

async function main() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  window.document.documentElement.lang = 'zh-CN'
  globalThis.window = window
  globalThis.document = window.document
  globalThis.MutationObserver = window.MutationObserver
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Element = window.Element
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const React = require('react')
  const ReactDOMClient = require('react-dom/client')
  const { act } = require('react-dom/test-utils')

  let pending = null
  window.__ModuleLoader__ = {
    load: (record) => {
      pending = record
    },
  }

  const requireStub = (specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react-dom') return require('react-dom')
    throw new Error(`unexpected require: ${specifier}`)
  }

  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(projectRoot, 'lib', 'client.js'), 'utf8'))(
    requireStub,
    { exports: {} },
    {},
  )

  assert.ok(pending !== null, 'the bundle registered a module')
  const plugin = pending.factory(requireStub)
  assert.equal(plugin.name, 'dsh-file-tray', 'plugin name')

  const opened = []
  let headerEntry = null
  const ctx = {
    effect: (callback) => callback(),
    slots: {
      inject: (_name, callback) => {
        callback()
      },
      register: (options) => {
        if (options.name === 'conversation.session.header.utilities') headerEntry = options
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
  assert.ok(headerEntry !== null, 'the header utilities seat is registered')
  const face = headerEntry.inject()

  const container = document.createElement('div')
  document.body.appendChild(container)

  // One file inside the workspace root and one absolute path outside it: the
  // first must open as a workspace-relative address, the second keeps its
  // absolute path in the session scope (one leading slash comes off).
  const sessionId = 'session-e2e'
  assert.equal(
    plugin.__test.recordProduced(sessionId, 1, 10, ['/Users/me/work/out/chart.svg', '/tmp/out/report.pdf']),
    2,
    'the ledger takes both files',
  )

  const useSessions = (select) => select({ byId: { [sessionId]: { cwd: '/Users/me/work' } } })
  const reactRoot = ReactDOMClient.createRoot(container)

  await act(async () => {
    reactRoot.render(
      React.createElement(plugin.__test.FileTray, {
        sessionId,
        useSessions,
        sidebarRight: face.sidebarRight,
      }),
    )
  })

  const button = container.querySelector('[data-file-tray-button]')
  assert.ok(button !== null, 'the tray button renders in the header seat')
  assert.equal(button.getAttribute('aria-expanded'), 'false', 'the button starts closed')

  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })

  const panel = document.querySelector('[data-file-tray-panel]')
  assert.ok(panel !== null, 'clicking the button opens the popover')

  const rows = [...panel.querySelectorAll('[data-file-tray-row]')]
  assert.equal(rows.length, 2, 'the popover lists one row per produced file')
  assert.deepEqual(
    rows.map((row) => row.getAttribute('data-file-tray-row')),
    ['/Users/me/work/out/chart.svg', '/tmp/out/report.pdf'],
    'rows keep the produced order',
  )

  await act(async () => {
    rows[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.deepEqual(
    opened,
    ['dsh-resource://file/session/session-e2e/out/chart.svg'],
    'a workspace file opens relative to the session root',
  )

  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  const reopened = document.querySelector('[data-file-tray-panel]')
  await act(async () => {
    reopened.querySelectorAll('[data-file-tray-row]')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.deepEqual(
    opened.slice(1),
    ['dsh-resource://file/session/session-e2e//tmp/out/report.pdf'],
    'a file outside the root keeps its absolute path',
  )

  await act(async () => {
    reactRoot.unmount()
  })

  console.log('dsh-file-tray: end-to-end harness passed (real React)')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
