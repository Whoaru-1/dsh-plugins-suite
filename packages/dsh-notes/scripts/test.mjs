/**
 * Offline harness for dsh-notes.
 *
 *   - day grouping and labels;
 *   - cache normalization and ordering;
 *   - host sanitization, atomic save, and backup recovery.
 *
 * Run: node scripts/test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const {
  COLORS,
  createNote,
  dayKey,
  dayLabel,
  formatTime,
  groupNotes,
  normalizeCachedNote,
  normalizeCachedNotes,
  sortNotes,
} = await import('../src/model.js')

/* -------------------------------------------------------------------- dates */

const base = new Date(2026, 10, 4, 9, 30).getTime()
const yesterday = new Date(2026, 10, 3, 21, 5).getTime()
const older = new Date(2026, 9, 28, 8, 0).getTime()

assert.equal(dayKey(base), '2026-11-04')
assert.equal(dayKey(yesterday), '2026-11-03')

const t = (key, values) => {
  const table = {
    dayToday: '今天',
    dayYesterday: '昨天',
  }
  const raw = table[key] ?? key
  if (values === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match))
}
assert.match(dayLabel(base, t, 'zh-CN', base), /^今天 · /)
assert.match(dayLabel(yesterday, t, 'zh-CN', base), /^昨天 · /)
assert.doesNotMatch(dayLabel(older, t, 'zh-CN', base), /^今天|^昨天/)
assert.match(formatTime(base, 'en-US'), /09:30/)

/* --------------------------------------------------------------- validation */

assert.equal(COLORS.length, 5)
const good = normalizeCachedNote({
  id: 'note-123456',
  text: '  hello  ',
  color: 'sky',
  createdAt: base,
  updatedAt: yesterday,
})
assert.equal(good.text, 'hello')
assert.equal(good.color, 'sky')
assert.equal(good.updatedAt, base, 'an update never predates the note')

assert.equal(normalizeCachedNote({ text: '   ' }), null)
assert.equal(normalizeCachedNote(null), null)
assert.equal(normalizeCachedNote({ text: 'x', color: 'neon' }).color, 'yellow')
assert.equal(normalizeCachedNote({ text: 'x', createdAt: 1 }).createdAt > 0, true)
assert.equal(normalizeCachedNote({ text: 'x'.repeat(25000) }).text.length, 20000)

const deduped = normalizeCachedNotes([
  { id: 'same-1234', text: 'first', createdAt: base },
  { id: 'same-1234', text: 'second', createdAt: base },
])
assert.equal(deduped.length, 1)
assert.equal(deduped[0].text, 'second')

const made = createNote({ text: '  one thought  ', color: 'mint' }, base)
assert.equal(made.text, 'one thought')
assert.equal(made.color, 'mint')
assert.equal(made.createdAt, base)
assert.match(made.id, /^[A-Za-z0-9_-]{6,80}$/)

/* ----------------------------------------------------------------- grouping */

const notes = [
  { id: 'a-123456', text: 'today older', color: 'yellow', createdAt: base - 1000, updatedAt: base - 1000 },
  { id: 'b-123456', text: 'today newer', color: 'rose', createdAt: base, updatedAt: base },
  { id: 'c-123456', text: 'yesterday', color: 'sky', createdAt: yesterday, updatedAt: base },
]
const groups = groupNotes(notes, t, 'zh-CN', base)
assert.equal(groups.length, 2)
assert.equal(groups[0].notes[0].id, 'b-123456')
assert.equal(groups[0].notes[1].id, 'a-123456')
assert.equal(groups[1].notes[0].id, 'c-123456')
assert.equal(sortNotes(notes)[0].id, 'b-123456')

/* -------------------------------------------------------------------- host */

const home = await mkdtemp(path.join(tmpdir(), 'dsh-notes-test-'))
process.env.DSH_HOME = home

const {
  notesFile,
  normalizeNote,
  normalizeNotes,
  readNotes,
  writeNotes,
} = await import('../index.js')

assert.equal(normalizeNote({ text: '  hello  ', color: 'lilac' }, base).text, 'hello')
assert.equal(normalizeNote({ text: 'x'.repeat(25000) }, base), null)
const hostNotes = normalizeNotes([
  { id: 'one-123456', text: 'first', color: 'mint', createdAt: base },
  { id: 'one-123456', text: 'replaced', color: 'sky', createdAt: base },
  { text: '' },
])
assert.equal(hostNotes.notes.length, 1)
assert.equal(hostNotes.notes[0].text, 'replaced')
assert.equal(hostNotes.rejected, 1)

await writeNotes([{ id: 'one-123456', text: 'v1', color: 'yellow', createdAt: base, updatedAt: base }])
let snapshot = await readNotes()
assert.equal(snapshot.storage, 'saved')
assert.equal(snapshot.notes[0].text, 'v1')

await writeNotes([{ id: 'two-123456', text: 'v2', color: 'rose', createdAt: base, updatedAt: base }])
snapshot = await readNotes()
assert.equal(snapshot.notes[0].text, 'v2')
assert.equal(JSON.parse(await readFile(`${notesFile()}.bak`, 'utf8')).notes[0].text, 'v1')

await writeFile(notesFile(), '{ broken', 'utf8')
snapshot = await readNotes()
assert.equal(snapshot.storage, 'recovered')
assert.equal(snapshot.damaged, true)
assert.equal(snapshot.notes[0].text, 'v1', 'the previous copy is the recovery')

console.log('dsh-notes: model + host checks passed')
