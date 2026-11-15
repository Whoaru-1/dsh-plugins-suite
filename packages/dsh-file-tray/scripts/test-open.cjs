/**
 * Focused harness: does the tray actually open under the browser's real event
 * sequence?
 *
 * `test-e2e.cjs` dispatches a synthetic `click`. A real browser sends
 * `pointerdown` -> `pointerup` -> `click`, and the popover installs dismissal
 * listeners that could consume any of them. This harness replays that order, and
 * then probes what the panel's own geometry looks like.
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
  window.__ModuleLoader__ = { load: (record) => { pending = record } }
  const requireStub = (s) => {
    if (s === 'react') return React
    if (s === 'react-dom') return require('react-dom')
    throw new Error(`unexpected require: ${s}`)
  }
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(projectRoot, 'lib', 'client.js'), 'utf8'))(
    requireStub, { exports: {} }, {},
  )
  const plugin = pending.factory(requireStub)

  let headerEntry = null
  const ctx = {
    effect: (cb) => cb(),
    slots: { inject: (_n, cb) => cb(), register: (o) => { if (o.name === 'conversation.session.header.utilities') headerEntry = o; return () => {} } },
    sidebarRight: { openResource: () => {} },
  }
  plugin.apply(ctx)

  const sessionId = 'session-open'
  plugin.__test.recordProduced(sessionId, 1, 10, ['/Users/me/work/out/chart.svg'])

  const container = document.createElement('div')
  document.body.appendChild(container)
  const reactRoot = ReactDOMClient.createRoot(container)
  await act(async () => {
    reactRoot.render(React.createElement(plugin.__test.FileTray, {
      sessionId,
      useSessions: (sel) => sel({ byId: { [sessionId]: { cwd: '/Users/me/work' } } }),
      sidebarRight: headerEntry.inject().sidebarRight,
    }))
  })

  const button = container.querySelector('[data-file-tray-button]')
  assert.ok(button !== null, 'button renders')

  // Give the button a believable box: top-right of a 1280x800 viewport.
  button.getBoundingClientRect = () => ({ x: 1180, y: 40, left: 1180, top: 40, right: 1272, bottom: 66, width: 92, height: 26 })
  window.innerWidth = 1280
  window.innerHeight = 800

  const fire = (type, target, options = {}) => {
    const EventCtor = type.startsWith('pointer') && typeof window.PointerEvent === 'function' ? window.PointerEvent : window.MouseEvent
    const event = new EventCtor(type, { bubbles: true, cancelable: true, ...options })
    target.dispatchEvent(event)
    return event
  }

  // The real browser order, as the tray would receive it.
  await act(async () => {
    fire('pointerdown', button, { button: 0, pointerId: 1, clientX: 1200, clientY: 50 })
    fire('pointerup', button, { button: 0, pointerId: 1, clientX: 1200, clientY: 50 })
    fire('click', button, { button: 0, clientX: 1200, clientY: 50 })
  })

  const panel = document.querySelector('[data-file-tray-panel]')
  assert.ok(panel !== null, 'the popover opens on a real pointer+click sequence')

  const style = panel.style
  console.log('panel position:', style.position, 'left:', style.left, 'top:', style.top, 'width:', style.width, 'zIndex:', style.zIndex)
  assert.equal(style.position, 'fixed')
  assert.ok(!style.left.includes('NaN') && !style.top.includes('NaN'), 'the panel anchors at finite coordinates')

  // The expanded card is frosted: a translucent theme surface plus a backdrop
  // blur, never an opaque fill and never element opacity (which would dim the
  // rows themselves).
  assert.match(style.background, /--dsw-specific-menu/, 'the card uses the theme menu surface')
  assert.ok(!/#fff\b|#ffffff\b|rgb\(255, *255, *255\)/.test(style.background), 'no opaque white fallback')
  assert.match(style.backdropFilter, /blur\(/, 'the card blurs what sits behind it')
  assert.match(style.webkitBackdropFilter ?? style.WebkitBackdropFilter ?? '', /blur\(/, 'the blur is also set for WebKit')
  assert.equal(style.opacity, '', 'the card is not element-transparent')
  console.log('panel background:', style.background)
  console.log('panel backdrop:', style.backdropFilter)

  // Clicking the button again must close it (toggle).
  await act(async () => {
    fire('pointerdown', button, { button: 0, pointerId: 2, clientX: 1200, clientY: 50 })
    fire('pointerup', button, { button: 0, pointerId: 2, clientX: 1200, clientY: 50 })
    fire('click', button, { button: 0, clientX: 1200, clientY: 50 })
  })
  assert.equal(document.querySelector('[data-file-tray-panel]'), null, 'a second click closes the popover')

  // Re-open, then simulate the header's own container scrolling: the listener
  // must not fire for a scroll that is not the window's.
  await act(async () => {
    fire('pointerdown', button, { button: 0, pointerId: 3, clientX: 1200, clientY: 50 })
    fire('click', button, { button: 0, clientX: 1200, clientY: 50 })
  })
  assert.ok(document.querySelector('[data-file-tray-panel]') !== null, 'the popover opens again')
  console.log('after re-open: panel present')

  // Regression: the dismissal listener must not be armed inside the opening
  // task, or the very click that opened the popover closes it again and the
  // button reads as dead. A document-level pointerdown right after the opening
  // click used to be consumed by the freshly attached capture listener.
  await act(async () => {
    fire('pointerdown', document.body, { button: 0, clientX: 5, clientY: 700 })
    fire('click', document.body, { button: 0, clientX: 5, clientY: 700 })
  })
  assert.ok(
    document.querySelector('[data-file-tray-panel]') !== null,
    'the popover survives the tail of its own opening gesture',
  )

  // Once armed, an outside press DOES dismiss it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    fire('pointerdown', document.body, { button: 0, clientX: 5, clientY: 700 })
  })
  assert.equal(
    document.querySelector('[data-file-tray-panel]'),
    null,
    'an outside press dismisses an armed popover',
  )

  await act(async () => {
    reactRoot.unmount()
  })
  console.log('dsh-file-tray: open harness passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
