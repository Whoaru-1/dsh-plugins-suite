/** Client-bundle smoke test: executes the ModuleLoader wrapper with stubs. */
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

const React = {
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useMemo: () => undefined,
  useRef: () => ({ current: null }),
  createElement: () => null
}
const jsx = () => null
const requireStub = (id) => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime' || id === 'react/jsx-runtime.js') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (id === 'react-dom' || id === 'react-dom/client') return { createRoot: () => ({ render() {} }) }
  throw new Error(`unexpected require: ${id}`)
}

let loaded = null
globalThis.window = { __ModuleLoader__: { load: (spec) => { loaded = spec } } }
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '', remove() {} }),
  head: { append() {} }
}

new Function('window', 'document', code)(globalThis.window, globalThis.document)
assert.ok(loaded && loaded.id === 'dsh-deploy', 'bundle registers id dsh-deploy')
const mod = loaded.factory(requireStub)
assert.equal(mod.name, 'dsh-deploy')
assert.deepEqual(mod.inject, ['slots'])
assert.equal(typeof mod.apply, 'function')

const slots = []
const ctx = {
  effect(fn) { fn() },
  slots: {
    inject(_name, fn) { return fn() },
    register(def, comp) { slots.push({ def, comp }); return () => {} }
  }
}
mod.apply(ctx)
assert.equal(slots.length, 2, 'registers two slots')
assert.equal(slots[0].def.name, 'sidebar.panellist')
assert.equal(slots[0].def.id, 'deploy')
assert.equal(slots[1].def.name, 'main')
assert.equal(slots[1].def.key, 'deploy')
console.log('✓ client bundle: id / exports / two slot registrations all good')
