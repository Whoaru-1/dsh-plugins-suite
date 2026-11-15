/**
 * Offline harness for the client half.
 *
 *   - produced-path collection, path helpers, and resource addresses;
 *   - the per-session ledger (order, de-duplication, stable snapshots).
 *
 * The header tray and the turn-tail seat are React components; their wiring is
 * asserted where it can be checked without a DOM: the ledger and the pure
 * helpers here, and the slot registrations in `test-wiring.cjs`.
 *
 * Run: node scripts/test.mjs
 */
import assert from 'node:assert/strict'

const {
  basenameOf,
  collectProduced,
  dirnameOf,
  fileAddressFor,
  fileKindOf,
  normalizePath,
  relativeToRoot,
} = await import('../src/files.js')
const { clear, list, recordProduced, subscribe } = await import('../src/store.js')
const { retireImagePreviewLayer } = await import('../src/image-fit.js')

/* ------------------------------------------------------------------- helpers */

assert.equal(normalizePath('.\\a\\b.txt'), 'a/b.txt')
assert.equal(basenameOf('/tmp/x/report.v2.md'), 'report.v2.md')
assert.equal(dirnameOf('/tmp/x/report.v2.md'), '/tmp/x/')
assert.equal(dirnameOf('report.md'), './')
assert.equal(relativeToRoot('/w/a/b.txt', '/w'), 'a/b.txt')
assert.equal(relativeToRoot('/other/b.txt', '/w'), '/other/b.txt')

assert.equal(
  fileAddressFor('session-1', '/Users/me/work', 'out/a b.svg'),
  'dsh-resource://file/session/session-1/out/a%20b.svg',
)
assert.equal(
  fileAddressFor('session-1', '/Users/me/work', '/Users/me/work/out/a.svg'),
  'dsh-resource://file/session/session-1/out/a.svg',
)
assert.equal(fileKindOf('x/y.svg'), 'image')
assert.equal(fileKindOf('x/y.md'), 'document')
assert.equal(fileKindOf('x/y.csv'), 'data')
assert.equal(fileKindOf('x/y.zip'), 'archive')
assert.equal(fileKindOf('x/y.mjs'), 'code')
assert.equal(fileKindOf('x/y.unknown'), 'other')

/** A fake turn model publishing a deliverables value. */
const turnWith = (value) => ({ turn: 1, data: { get: (key) => (key === 'deliverables' ? value : undefined) } })

assert.deepEqual(collectProduced(turnWith({ produced: [{ path: 'a.txt', seq: 3 }] }), 5), ['a.txt'])
assert.deepEqual(
  collectProduced(turnWith({ produced: [{ path: 'a.txt', seq: 3 }, { path: 'a.txt', seq: 4 }] }), 5),
  ['a.txt'],
  'produced paths de-duplicate',
)
assert.deepEqual(collectProduced(turnWith({ produced: [{ path: 'late.txt', seq: 9 }] }), 5), [], 'late produced path excluded')
assert.deepEqual(
  collectProduced(turnWith({ produced: [], presented: [{ path: 'p.txt', seq: 5 }, { path: 'q.txt', seq: 4 }] }), 5),
  ['q.txt'],
  'presented paths count strictly before the closing seq',
)
assert.deepEqual(collectProduced({}, 5), [])
assert.deepEqual(collectProduced(turnWith({ produced: [{ path: '  ', seq: 1 }] }), 5), [], 'a blank path is ignored')

/* -------------------------------------------------------------------- ledger */

let changes = 0
const unsubscribe = subscribe(() => {
  changes += 1
})
assert.equal(recordProduced('s1', 2, 10, ['b.txt', 'a.txt']), 2)
assert.equal(recordProduced('s1', 1, 4, ['older.txt']), 1, 'a late older turn still inserts')
assert.equal(recordProduced('s1', 3, 20, ['b.txt']), 0, 'an existing path is not re-added')
assert.deepEqual(
  list('s1').map((record) => record.path),
  ['older.txt', 'b.txt', 'a.txt'],
  'records order by turn, then arrival',
)
assert.equal(changes, 2, 'a mutation that adds nothing does not notify')
const before = list('s1')
assert.equal(list('s1'), before, 'an unchanged read is identity-stable')
recordProduced('s1', 4, 30, ['c.txt'])
assert.notEqual(list('s1'), before, 'a changed read returns a new array')
assert.equal(clear('s1'), true)
assert.equal(clear('s1'), false)
assert.deepEqual(list('s1'), [])
unsubscribe()

/* ------------------------------------------------------------ preview scope */

// The plugin no longer touches the document preview in any way. Outside a
// document the retirement helper is a no-op, and inside one it only removes a
// sheet an earlier build of this plugin stamped itself.
assert.equal(retireImagePreviewLayer(), 0, 'no preview sheet is touched outside a document')

console.log('dsh-file-tray: pure harness passed')
