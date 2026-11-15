/**
 * dsh-notes — client half.
 *
 * One root-scoped panel, reached from a row in the left sidebar:
 *
 *   sidebar.panellist  a sticky-note mark and the "便签" label
 *   main               the note wall itself, keyed by the same panel id
 *
 * Notes are grouped by the day they were written, not by when they were last
 * touched, so an edit never moves yesterday's thought into today. The host half
 * persists the list; this half keeps a browser cache and says so honestly when
 * the host file is unreachable.
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom'
import { makeT, resolveLocale } from './copy.js'
import { COLORS, MAX_TEXT, countToday, formatTime, groupNotes, isColor } from './model.js'
import {
  addNote,
  dismissNotice,
  editNote,
  getState,
  removeNote,
  restoreNote,
  retrySave,
  subscribe,
} from './store.js'
import { installStyles } from './styles.js'
import {
  CloseIcon,
  EmptyNoteIcon,
  NotesIcon,
  PencilIcon,
  SearchIcon,
  TrashIcon,
} from './icons.js'

export const name = 'dsh-notes'
export const inject = ['slots']

/** The id shared by the sidebar row and the main-slot key. */
export const PANEL_ID = 'notes'

/** Subscribe the panel to the module-level note store. */
function useNotes() {
  return useSyncExternalStore(subscribe, getState, getState)
}

/** The panel page: heading, composer, search, and the day-grouped wall. */
export function NotesPage() {
  const t = useMemo(makeT, [])
  const locale = useMemo(resolveLocale, [])
  const state = useNotes()

  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState({ text: '', color: 'yellow' })
  const [editingId, setEditingId] = useState(null)
  const [toast, setToast] = useState(null)

  const composerRef = useRef(null)
  const inputRef = useRef(null)
  const toastTimer = useRef(null)

  const today = state.notes.length === 0 ? 0 : countToday(state.notes)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return state.notes
    return state.notes.filter((note) => note.text.toLowerCase().includes(needle))
  }, [state.notes, query])
  const groups = useMemo(() => groupNotes(filtered, t, locale), [filtered, t, locale])

  useEffect(
    () => () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    },
    [],
  )

  /** Show one toast; an undo action keeps it on screen longer. */
  function showToast(message, undo) {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    setToast({ message, undo, key: Date.now() })
    toastTimer.current = setTimeout(
      () => {
        setToast(null)
        toastTimer.current = null
      },
      undo === undefined ? 2200 : 6500,
    )
  }

  /** Put an existing note into the composer. */
  function startEdit(note) {
    setEditingId(note.id)
    setDraft({ text: note.text, color: note.color })
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      inputRef.current?.focus({ preventScroll: true })
      const input = inputRef.current
      if (input !== null) {
        input.setSelectionRange(input.value.length, input.value.length)
      }
    })
  }

  /** Leave editing, or empty the new-note draft. */
  function cancelComposer() {
    setEditingId(null)
    setDraft((current) => ({ text: '', color: current.color }))
    inputRef.current?.blur()
  }

  /** Save the composer as a new note or as an edit of the current one. */
  function saveDraft() {
    const text = draft.text.trim()
    if (text === '' || text.length > MAX_TEXT || !state.hydrated) return
    if (editingId !== null) {
      editNote(editingId, { text, color: isColor(draft.color) ? draft.color : 'yellow' })
    } else {
      addNote({ text, color: draft.color })
    }
    setEditingId(null)
    setDraft((current) => ({ text: '', color: current.color }))
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  /** Remove a note and offer one chance to put it back. */
  function deleteNote(note) {
    const index = state.notes.findIndex((entry) => entry.id === note.id)
    removeNote(note.id)
    if (editingId === note.id) cancelComposer()
    showToast(t('toastDeleted'), () => {
      restoreNote(note, index)
      setToast(null)
      if (toastTimer.current !== null) {
        clearTimeout(toastTimer.current)
        toastTimer.current = null
      }
    })
  }

  /** Undo from the toast. */
  function undoDelete() {
    if (typeof toast?.undo === 'function') toast.undo()
  }

  const searching = query.trim() !== ''
  const showLoading = state.phase === 'idle' && state.notes.length === 0
  const saveState =
    state.persistence === 'local' || state.save === 'error'
      ? 'local'
      : state.save === 'saving'
        ? 'saving'
        : 'saved'
  const saveLabel =
    saveState === 'saving'
      ? t('statusSaving')
      : saveState === 'local'
        ? t('statusLocal')
        : t('statusSaved')

  return (
    <section className="dsh-notes-page" aria-label={t('ariaNotes')}>
      <div className="dsh-notes-scroll">
        <div className="dsh-notes-doc">
          <header className="dsh-notes-topbar">
            <div className="dsh-notes-heading">
              <h1>{t('title')}</h1>
              <p className="dsh-notes-sub">
                <span>{t('subtitle')}</span>
                <span className="dsh-notes-dot" aria-hidden="true" />
                <span>{searching ? t('countFiltered', { count: filtered.length }) : t('countNotes', { count: state.notes.length })}</span>
                {!searching && today > 0 ? (
                  <>
                    <span className="dsh-notes-dot" aria-hidden="true" />
                    <span>{t('countToday', { count: today })}</span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="dsh-notes-tools">
              <div className="dsh-notes-search" role="search">
                <SearchIcon size={14} />
                <input
                  type="search"
                  value={query}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setQuery('')
                  }}
                />
                {query !== '' ? (
                  <button
                    type="button"
                    className="dsh-notes-search-clear"
                    aria-label={t('searchClear')}
                    title={t('searchClear')}
                    onClick={(event) => {
                      event.preventDefault()
                      setQuery('')
                    }}
                  >
                    <CloseIcon size={12} />
                  </button>
                ) : null}
              </div>
              <span className="dsh-notes-save" data-state={saveState} aria-live="polite" title={state.error ?? ''}>
                {saveLabel}
              </span>
            </div>
          </header>

          {state.error !== null && state.persistence === 'local' ? (
            <div className="dsh-notes-banner" role="status">
              <p>{t('errorBanner')}</p>
              <button type="button" onClick={() => retrySave()}>
                {t('errorRetry')}
              </button>
            </div>
          ) : state.notice === 'recovered' ? (
            <div className="dsh-notes-banner" role="status">
              <p>{t('noticeRecovered')}</p>
              <button type="button" onClick={() => dismissNotice()}>
                {t('noticeDismiss')}
              </button>
            </div>
          ) : null}

          <div ref={composerRef}>
            <Composer
              t={t}
              inputRef={inputRef}
              draft={draft}
              editing={editingId !== null}
              disabled={!state.hydrated}
              onChange={setDraft}
              onSave={saveDraft}
              onCancel={cancelComposer}
            />
          </div>

          {showLoading ? (
            <div className="dsh-notes-loading">{t('loading')}</div>
          ) : state.notes.length === 0 && !searching ? (
            <div className="dsh-notes-empty">
              <span className="dsh-notes-empty-icon">
                <EmptyNoteIcon size={42} />
              </span>
              <h2>{t('emptyTitle')}</h2>
              <p>{t('emptyBody')}</p>
            </div>
          ) : searching && filtered.length === 0 ? (
            <div className="dsh-notes-empty">
              <span className="dsh-notes-empty-icon">
                <SearchIcon size={34} />
              </span>
              <h2>{t('emptySearchTitle')}</h2>
              <p>{t('emptySearchBody')}</p>
            </div>
          ) : (
            <div className="dsh-notes-wall" aria-label={t('ariaNotes')}>
              {groups.map((group) => (
                <section className="dsh-notes-day" key={group.key}>
                  <div className="dsh-notes-day-head">
                    <span className="dsh-notes-day-label">{group.label}</span>
                    <span className="dsh-notes-day-count">{t('count', { count: group.notes.length })}</span>
                    <span className="dsh-notes-day-rule" aria-hidden="true" />
                  </div>
                  <NoteWall
                    notes={group.notes}
                    t={t}
                    locale={locale}
                    onEdit={startEdit}
                    onDelete={deleteNote}
                  />
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {toast !== null
        ? ReactDOM.createPortal(
            <div className="dsh-notes-toast" role="status" key={toast.key}>
              <span>{toast.message}</span>
              {toast.undo !== undefined ? (
                <button type="button" onClick={undoDelete}>
                  {t('toastUndo')}
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}

/** The paper composer: one new thought, or an edit of the selected note. */
function Composer({ t, inputRef, draft, editing, disabled, onChange, onSave, onCancel }) {
  const overLimit = draft.text.length > MAX_TEXT
  const canSave = draft.text.trim() !== '' && !overLimit && !disabled
  const showCounter = draft.text.length >= MAX_TEXT - 500
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
  const hint = isMac ? t('composerHint') : t('composerHintWin')

  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 56), 260)}px`
  }, [draft.text, inputRef])

  function handleKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      onSave()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="dsh-notes-composer" data-color={draft.color} data-editing={editing ? 'true' : 'false'}>
      <div className="dsh-notes-composer-head">
        <span className="dsh-notes-label">
          <NotesIcon size={13} strokeWidth={1.9} />
          {editing ? t('composerEdit') : t('composerNew')}
        </span>
        <div className="dsh-notes-swatches" role="group" aria-label={t('colorLabel')}>
          {COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              className="dsh-notes-swatch"
              data-color={color.id}
              aria-label={t(`color${color.id[0].toUpperCase()}${color.id.slice(1)}`)}
              aria-pressed={draft.color === color.id}
              title={t(`color${color.id[0].toUpperCase()}${color.id.slice(1)}`)}
              onClick={() => onChange({ ...draft, color: color.id })}
            />
          ))}
        </div>
      </div>
      <textarea
        ref={inputRef}
        className="dsh-notes-input"
        value={draft.text}
        placeholder={editing ? t('composerPlaceholderEdit') : disabled ? t('loading') : t('composerPlaceholder')}
        aria-label={editing ? t('composerEdit') : t('composerNew')}
        maxLength={MAX_TEXT + 1}
        rows={2}
        readOnly={disabled}
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
        onKeyDown={handleKeyDown}
      />
      <div className="dsh-notes-composer-foot">
        <span className="dsh-notes-hint">
          {hint}
          {showCounter ? (
            <span className="dsh-notes-counter" data-over={overLimit ? 'true' : 'false'}>
              {t('composerLimit', { count: draft.text.length })}
            </span>
          ) : null}
        </span>
        <div className="dsh-notes-actions">
          {editing || draft.text !== '' ? (
            <button type="button" className="dsh-notes-btn dsh-notes-btn-ghost" onClick={onCancel}>
              {t('composerCancel')}
            </button>
          ) : null}
          <button
            type="button"
            className="dsh-notes-btn dsh-notes-btn-primary"
            disabled={!canSave}
            onClick={onSave}
          >
            {editing ? t('composerUpdate') : t('composerSave')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** A rough content height, used only to balance the note columns. */
function estimateNoteHeight(note) {
  const lines = note.text.split('\n')
  let rows = 0
  for (const line of lines) rows += Math.max(1, Math.ceil(line.length / 18))
  return 72 + rows * 24
}

/**
 * A balanced masonry wall.
 *
 * CSS multi-column layout leaves later columns empty when a day holds only a
 * few notes, so the page distributes cards itself: measure the available
 * width, choose three, two, or one columns, and always place the next note in
 * the currently shortest column. The result fills the whole width without
 * splitting a card between columns.
 */
function NoteWall({ notes, t, locale, onEdit, onDelete }) {
  const ref = useRef(null)
  const [columns, setColumns] = useState(3)

  useEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    const measure = () => {
      const width = element.clientWidth
      setColumns(width >= 860 ? 3 : width >= 500 ? 2 : 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const buckets = useMemo(() => {
    const next = Array.from({ length: columns }, () => [])
    const heights = next.map(() => 0)
    for (const note of notes) {
      let target = 0
      for (let index = 1; index < columns; index += 1) {
        if (heights[index] < heights[target]) target = index
      }
      next[target].push(note)
      heights[target] += estimateNoteHeight(note)
    }
    return next
  }, [notes, columns])

  return (
    <div className="dsh-notes-grid" ref={ref}>
      {buckets.map((bucket, column) => (
        <div className="dsh-notes-column" key={column}>
          {bucket.map((note, index) => (
            <NoteCard
              key={note.id}
              note={note}
              index={index}
              t={t}
              locale={locale}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** One sticky note on the wall. */
function NoteCard({ note, index, t, locale, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const long = note.text.length > 320 || note.text.split('\n').length > 13
  return (
    <article
      className="dsh-notes-note"
      data-color={note.color}
      style={{ animationDelay: `${Math.min(index, 9) * 18}ms` }}
    >
      <p className="dsh-notes-note-text" data-clamped={long && !expanded ? 'true' : 'false'}>
        {note.text}
      </p>
      {long ? (
        <button type="button" className="dsh-notes-expand" onClick={() => setExpanded((value) => !value)}>
          {expanded ? t('noteCollapse') : t('noteExpand')}
        </button>
      ) : null}
      <footer className="dsh-notes-note-foot">
        <time className="dsh-notes-note-time" dateTime={new Date(note.createdAt).toISOString()}>
          {formatTime(note.createdAt, locale)}
        </time>
        <div className="dsh-notes-note-actions">
          <button
            type="button"
            className="dsh-notes-icon-btn"
            aria-label={`${t('noteEdit')}: ${note.text.slice(0, 24)}`}
            title={t('noteEdit')}
            onClick={() => onEdit(note)}
          >
            <PencilIcon size={14} />
          </button>
          <button
            type="button"
            className="dsh-notes-icon-btn"
            data-danger="true"
            aria-label={`${t('noteDelete')}: ${note.text.slice(0, 24)}`}
            title={t('noteDelete')}
            onClick={() => onDelete(note)}
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </footer>
    </article>
  )
}

/** The sidebar mark. */
function NotesPanelIcon({ size, active }) {
  return <NotesIcon size={size ?? 17} strokeWidth={active ? 2.05 : 1.75} />
}

/** Mount the sidebar row and the page. */
export function apply(ctx) {
  ctx.effect(() => installStyles(), 'dsh-notes: styles')

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        label: () => makeT()('panel'),
      },
      NotesPanelIcon,
    ),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
      },
      NotesPage,
    ),
  )
}

/** Offline harness surface; the loader reads only `name`, `inject`, `apply`. */
export const __test = { NotesPage, Composer, NoteCard, PANEL_ID }
