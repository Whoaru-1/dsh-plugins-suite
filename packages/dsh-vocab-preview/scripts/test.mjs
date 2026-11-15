/**
 * Offline harness for dsh-vocab-preview.
 *
 * Two layers, both runnable with `npm test` and no browser:
 *
 *   1. `src/match.js` — the pure candidate rule.
 *   2. `lib/client.js` — the SHIPPED bundle, evaluated against a stubbed
 *      `window.__ModuleLoader__` exactly as the browser host would, so the
 *      loader contract, the slot registration, and the auto-open flow are all
 *      exercised as built. Run `npm run build` first.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { collectCandidates, isVocabPage, turnKey } from '../src/match.js'

let passed = 0
/** Run one named case and count it. */
function check(label, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

/** Run one async case and count it. */
async function checkAsync(label, fn) {
  await fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

/** Build a turn model shaped like the host's turn-tail prop. */
function makeTurn({ produced = [], presented = [] } = {}) {
  const data = new Map([['deliverables', { turn: 1, calls: new Map(), produced, presented }]])
  return { id: 1, data }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

console.log('dsh-vocab-preview — detection harness')

check('accepts the skill default deck name', () => {
  assert.equal(isVocabPage('/Users/x/Documents/series-vocab/vocab-show-S01E01.html'), true)
  assert.equal(isVocabPage('vocab-show-S01E01.htm'), true)
  assert.equal(isVocabPage('/tmp/剧有词/S01E01.html'), true)
})

check('rejects non-HTML and unrelated HTML', () => {
  assert.equal(isVocabPage('/tmp/vocab.json'), false)
  assert.equal(isVocabPage('/tmp/report.html'), false)
  assert.equal(isVocabPage(''), false)
  assert.equal(isVocabPage(undefined), false)
  assert.equal(isVocabPage(null), false)
})

check('collects a produced deck inside the closing window', () => {
  const turn = makeTurn({ produced: [{ path: '/w/series-vocab/vocab-show-S01E01.html', seq: 4 }] })
  assert.deepEqual(collectCandidates(turn, 4), ['/w/series-vocab/vocab-show-S01E01.html'])
})

check('excludes produced files settled after the closing seq', () => {
  const turn = makeTurn({ produced: [{ path: '/w/series-vocab/vocab-show-S01E01.html', seq: 9 }] })
  assert.deepEqual(collectCandidates(turn, 4), [])
})

check('filters unrelated produced files', () => {
  const turn = makeTurn({
    produced: [
      { path: '/w/series-vocab/vocab-show-S01E01.json', seq: 2 },
      { path: '/w/notes.html', seq: 3 },
      { path: '/w/series-vocab/vocab-show-S01E01.html', seq: 4 },
    ],
  })
  assert.deepEqual(collectCandidates(turn, 4), ['/w/series-vocab/vocab-show-S01E01.html'])
})

check('deduplicates a path produced twice', () => {
  const turn = makeTurn({
    produced: [
      { path: '/w/vocab-show-S01E01.html', seq: 2 },
      { path: '/w/vocab-show-S01E01.html', seq: 3 },
    ],
  })
  assert.deepEqual(collectCandidates(turn, 4), ['/w/vocab-show-S01E01.html'])
})

check('keeps first-seen order so the newest is last', () => {
  const turn = makeTurn({
    produced: [
      { path: '/w/vocab-show-S01E01.html', seq: 2 },
      { path: '/w/vocab-show-S01E02.html', seq: 3 },
    ],
  })
  const out = collectCandidates(turn, 4)
  assert.deepEqual(out, ['/w/vocab-show-S01E01.html', '/w/vocab-show-S01E02.html'])
  assert.equal(out[out.length - 1], '/w/vocab-show-S01E02.html')
})

check('counts a presented deck strictly before the closing seq', () => {
  const before = makeTurn({ presented: [{ path: '/w/vocab-show-S01E01.html', seq: 3, index: 0 }] })
  assert.deepEqual(collectCandidates(before, 4), ['/w/vocab-show-S01E01.html'])
  const same = makeTurn({ presented: [{ path: '/w/vocab-show-S01E01.html', seq: 4, index: 0 }] })
  assert.deepEqual(collectCandidates(same, 4), [])
})

check('merges produced and presented without repeating a path', () => {
  const turn = makeTurn({
    produced: [{ path: '/w/vocab-show-S01E01.html', seq: 2 }],
    presented: [{ path: '/w/vocab-show-S01E01.html', seq: 3, index: 0 }],
  })
  assert.deepEqual(collectCandidates(turn, 4), ['/w/vocab-show-S01E01.html'])
})

check('survives a missing, empty, or malformed projection', () => {
  assert.deepEqual(collectCandidates(undefined, 1), [])
  assert.deepEqual(collectCandidates({}, 1), [])
  assert.deepEqual(collectCandidates({ data: {} }, 1), [])
  assert.deepEqual(collectCandidates({ data: new Map() }, 1), [])
  assert.deepEqual(collectCandidates(makeTurn({}), 1), [])
  assert.deepEqual(collectCandidates({ data: new Map([['deliverables', {}]]) }, 1), [])
  assert.deepEqual(
    collectCandidates({ data: new Map([['deliverables', { produced: 'nope', presented: 7 }]]) }, 1),
    [],
  )
})

check('keys turns by seq when present, else by turn identity', () => {
  assert.equal(turnKey({ id: 7 }, 12), 'seq:12')
  assert.equal(turnKey({ id: 7 }, undefined), 'turn:7')
  assert.equal(turnKey({ turn: 3 }), 'turn:3')
  assert.equal(turnKey({}, undefined), 'turn')
})

console.log('\ndsh-vocab-preview — shipped bundle contract')

/**
 * Evaluate lib/client.js the way the browser host does.
 * @param options.store - optional persistent tab store to reuse across loads.
 * @returns the loader id, the factory exports, the tab store, and hook state.
 */
function loadBundle(options = {}) {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const effects = []
  const react = {
    useEffect: (fn, deps) => {
      effects.push({ fn, deps })
    },
  }
  const storage = options.store ?? new Map()
  let entry
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => void storage.set(key, String(value)),
    },
    window: { __ModuleLoader__: { load: (value) => void (entry = value) } },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  if (entry === undefined) throw new Error('bundle never called __ModuleLoader__.load')
  const exports = entry.factory((specifier) => {
    if (specifier === 'react') return react
    throw new Error(`unexpected require("${specifier}")`)
  })
  return { id: entry.id, exports, storage, effects }
}

const OPEN_DEBOUNCE_MS = loadBundle().exports.__test.OPEN_DEBOUNCE_MS

/**
 * Mount the seat the way the host does: apply, run the slot injection, and take
 * the component the registration produced.
 * @param bundle - a loadBundle() result.
 * @returns the registered turn-tail component.
 */
function mountSeat(bundle) {
  const injections = []
  const registered = []
  bundle.exports.apply({
    slots: {
      inject: (slot, factory) => void injections.push({ slot, factory }),
      register: (config, component) => {
        registered.push({ config, component })
        return () => {}
      },
    },
  })
  injections[0].factory()
  return registered[0].component
}

check('registers under the package id and requires only react', () => {
  const { id } = loadBundle()
  assert.equal(id, 'dsh-vocab-preview')
})

check('exports name, inject, and apply', () => {
  const { exports } = loadBundle()
  assert.equal(exports.name, 'dsh-vocab-preview')
  // The bundle lives in its own vm realm, so copy before a strict compare.
  assert.deepEqual(Array.from(exports.inject), ['slots'])
  assert.equal(typeof exports.apply, 'function')
})

check('apply seats one turn-tail component and renders no DOM', () => {
  const { exports } = loadBundle()
  const injections = []
  const registered = []
  exports.apply({
    slots: {
      inject: (slot, factory) => void injections.push({ slot, factory }),
      register: (config, component) => {
        registered.push({ config, component })
        return () => {}
      },
    },
  })
  assert.equal(injections.length, 1)
  assert.equal(injections[0].slot, 'conversation.chat.turnTail')
  injections[0].factory()
  assert.equal(registered.length, 1)
  assert.equal(registered[0].config.name, 'conversation.chat.turnTail')
  assert.equal(registered[0].config.id, 'dsh-vocab-preview')
  assert.equal(
    registered[0].component({ turn: makeTurn({}), seq: 1, openFile: () => {} }),
    null,
  )
})

await checkAsync('auto-opens the produced deck through openFile', async () => {
  const bundle = loadBundle()
  const seat = mountSeat(bundle)
  const opened = []
  const props = {
    turn: makeTurn({ produced: [{ path: '/w/series-vocab/vocab-show-S01E01.html', seq: 4 }] }),
    seq: 4,
    openFile: (path) => void opened.push(path),
  }
  seat(props)
  assert.equal(bundle.effects.length, 1)
  bundle.effects[0].fn()
  assert.deepEqual(opened, [], 'must not open before the debounce settles')
  await sleep(OPEN_DEBOUNCE_MS + 80)
  assert.deepEqual(opened, ['/w/series-vocab/vocab-show-S01E01.html'])
})

await checkAsync('never opens the same deck twice in one page load', async () => {
  const bundle = loadBundle()
  const seat = mountSeat(bundle)
  const opened = []
  const props = {
    turn: makeTurn({ produced: [{ path: '/w/vocab-show-S01E01.html', seq: 4 }] }),
    seq: 4,
    openFile: (path) => void opened.push(path),
  }
  seat(props)
  bundle.effects[0].fn()
  seat(props)
  bundle.effects[1].fn()
  await sleep(OPEN_DEBOUNCE_MS + 80)
  assert.deepEqual(opened, ['/w/vocab-show-S01E01.html'])
})

await checkAsync('lets the newest of a render burst win', async () => {
  const bundle = loadBundle()
  const seat = mountSeat(bundle)
  const opened = []
  seat({
    turn: makeTurn({ produced: [{ path: '/w/vocab-show-S01E01.html', seq: 4 }] }),
    seq: 4,
    openFile: (path) => void opened.push(path),
  })
  bundle.effects[0].fn()
  seat({
    turn: makeTurn({ produced: [{ path: '/w/vocab-show-S01E02.html', seq: 5 }] }),
    seq: 5,
    openFile: (path) => void opened.push(path),
  })
  bundle.effects[1].fn()
  await sleep(OPEN_DEBOUNCE_MS + 80)
  assert.deepEqual(opened, ['/w/vocab-show-S01E02.html'])
})

await checkAsync('stays quiet on reload of a tab that already opened it', async () => {
  const first = loadBundle()
  const firstSeat = mountSeat(first)
  const opened = []
  const props = {
    turn: makeTurn({ produced: [{ path: '/w/vocab-show-S01E01.html', seq: 4 }] }),
    seq: 4,
    openFile: (path) => void opened.push(path),
  }
  firstSeat(props)
  first.effects[0].fn()
  await sleep(OPEN_DEBOUNCE_MS + 80)
  assert.equal(opened.length, 1)

  // A reload keeps sessionStorage but drops every in-memory guard.
  const second = loadBundle({ store: first.storage })
  mountSeat(second)({
    ...props,
    openFile: (path) => void opened.push(path),
  })
  second.effects[0].fn()
  await sleep(OPEN_DEBOUNCE_MS + 80)
  assert.equal(opened.length, 1, 'a reload must not resurrect the old study page')
})

await checkAsync('opens nothing when the turn produced no deck', async () => {
  const bundle = loadBundle()
  const seat = mountSeat(bundle)
  const opened = []
  seat({
    turn: makeTurn({ produced: [{ path: '/w/report.html', seq: 4 }] }),
    seq: 4,
    openFile: (path) => void opened.push(path),
  })
  assert.equal(bundle.effects.length, 1, 'hooks stay unconditional; the effect is merely inert')
  bundle.effects[0].fn()
  await sleep(OPEN_DEBOUNCE_MS + 80)
  assert.deepEqual(opened, [])
})

console.log(`\n${passed} checks passed`)
