/**
 * dsh-file-tray — client half.
 *
 * Two surfaces, both fed by the official `deliverables` projection:
 *
 *   1. `conversation.session.header.utilities` — the conversation header's
 *      top-right utilities strip: a small tray button with the produced-file
 *      count that opens a popover listing every file this conversation wrote.
 *      Clicking a row opens it in the right-side document preview. (The
 *      header's single-occupancy `…header.corner` seat is already held by the
 *      sidebar column's expand control, so the tray shares the utilities list
 *      rather than shadowing it.)
 *   2. `conversation.chat.turnTail` — an invisible seat per closing turn that
 *      reads that turn's produced paths into the module ledger. It renders no
 *      DOM; it exists so the header control can aggregate the whole session.
 *
 * This plugin deliberately leaves the document preview alone. An earlier
 * revision also tried to fit and then to zoom workspace images; both were
 * withdrawn, so the preview keeps the behaviour the bundled plugin gives it.
 *
 * Every colour comes from the design system's `--dsw-alias-*` tokens, so both
 * surfaces follow the active light/dark theme.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom'
import { basenameOf, collectProduced, dirnameOf, fileAddressFor, fileKindOf, kindLabel } from './files.js'
import { retireImagePreviewLayer } from './image-fit.js'
import { clear, list, recordProduced, subscribe } from './store.js'

export const name = 'dsh-file-tray'

/** Services this client half depends on. */
export const inject = ['slots', 'sidebarRight']

/* ------------------------------------------------------------------ copy */

/**
 * Copy for the tray.
 *
 * The harness ships Chinese and English UI dictionaries; this plugin keeps one
 * small table and picks by document language, the same resolution the balance
 * plugin uses, so it needs no locale registration of its own.
 */
const zh = {
  'tray.label': '本次对话产出的文件',
  'tray.button': '产出文件',
  'tray.panelTitle': '产出文件',
  'tray.count': '{count} 个',
  'tray.empty': '本次对话还没有产出文件',
  'tray.emptyHint': '模型写入或修改文件后会自动出现在这里。',
  'tray.hint': '点击打开',
  'tray.openAll': '全部打开',
  'tray.clear': '清空',
  'tray.close': '关闭',
}

const en = {
  'tray.label': 'Files produced in this conversation',
  'tray.button': 'Files',
  'tray.panelTitle': 'Produced files',
  'tray.count': '{count}',
  'tray.empty': 'No files produced yet',
  'tray.emptyHint': 'Files the model writes or edits show up here automatically.',
  'tray.hint': 'Open',
  'tray.openAll': 'Open all',
  'tray.clear': 'Clear',
  'tray.close': 'Close',
}

/** Resolve copy for the document language, falling back to English. */
function makeT() {
  let lang = ''
  try {
    lang = (typeof document !== 'undefined' && document.documentElement.lang) || ''
    if (lang === '') lang = typeof navigator !== 'undefined' ? navigator.language : ''
  } catch {
    // A missing document keeps the English copy.
  }
  const table = /^zh/i.test(lang) ? zh : en
  return (key, values) => {
    const raw = table[key] ?? en[key] ?? key
    if (values === undefined) return raw
    return raw.replace(/\{(\w+)\}/g, (match, name) => (values[name] === undefined ? match : String(values[name])))
  }
}

/* --------------------------------------------------------------- styling */

const V = {
  text1: 'var(--dsw-alias-label-primary, #1a1a1a)',
  text2: 'var(--dsw-alias-label-secondary, #555)',
  text3: 'var(--dsw-alias-label-tertiary, #8a8a8a)',
  caption: 'var(--dsw-alias-label-caption, #a5a5a5)',
  link: 'var(--dsw-alias-link, #3b6ef2)',
  // The popover card is deliberately translucent. The theme's menu surface
  // token already carries its own alpha; the fallbacks are equally transparent
  // so the frosted treatment survives a missing token instead of collapsing to
  // an opaque card.
  surface: 'var(--dsw-specific-menu, rgba(248, 249, 250, .58))',
  blur: 'var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))',
  layer: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.04))',
  border1: 'var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
  border2: 'var(--dsw-alias-border-l2, rgba(0,0,0,.14))',
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))',
  // Row hover inside the frosted card: deliberately lighter than the standard
  // hover wash, so a hovered row never reads as a second opaque card.
  hoverSoft: 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .08))',
  accent: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe))',
}

const FONT = 'var(--dsw-font-family, -apple-system, "Segoe UI", system-ui, sans-serif)'

/* ----------------------------------------------------------------- icons */

/** One stroked path in a 24-grid, shared by every tray glyph. */
function Glyph(props) {
  return React.createElement(
    'svg',
    {
      width: props.size ?? 15,
      height: props.size ?? 15,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      style: props.style,
    },
    props.children,
  )
}

/** The tray button's own mark: a document with a tab, legible at 14px. */
function TrayIcon({ size = 15 }) {
  return React.createElement(
    Glyph,
    { size },
    React.createElement('path', { d: 'M6.5 3.5h11v17h-11Z' }),
    React.createElement('path', { d: 'M6.5 3.5v5h11v-5' }),
    React.createElement('path', { d: 'M9.5 12.5h5M9.5 16h5' }),
  )
}

/**
 * The row glyph for one file kind.
 * @param props - `kind` from {@link fileKindOf} plus an optional size.
 * @returns the icon element.
 */
function KindIcon({ kind, size = 16 }) {
  if (kind === 'image') {
    return React.createElement(
      Glyph,
      { size },
      React.createElement('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }),
      React.createElement('circle', { cx: 8.5, cy: 10, r: 1.6 }),
      React.createElement('path', { d: 'm4 17 4.5-4.5 3.5 3.5 2.5-2.5L20 18' }),
    )
  }
  if (kind === 'document') {
    return React.createElement(
      Glyph,
      { size },
      React.createElement('path', { d: 'M6 3.5h7.5L19 9v11.5H6Z' }),
      React.createElement('path', { d: 'M13.5 3.5V9H19' }),
      React.createElement('path', { d: 'M9 13h6M9 16.5h6' }),
    )
  }
  if (kind === 'data') {
    return React.createElement(
      Glyph,
      { size },
      React.createElement('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }),
      React.createElement('path', { d: 'M3.5 9.5h17M9 9.5v10M3.5 14.5h17' }),
    )
  }
  if (kind === 'archive') {
    return React.createElement(
      Glyph,
      { size },
      React.createElement('rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }),
      React.createElement('path', { d: 'M11 4v3M13 7v3M11 10v3M13 13v3M11 16v4' }),
    )
  }
  if (kind === 'code') {
    return React.createElement(
      Glyph,
      { size },
      React.createElement('path', { d: 'm9 8-4 4 4 4M15 8l4 4-4 4' }),
    )
  }
  return React.createElement(
    Glyph,
    { size },
    React.createElement('path', { d: 'M6 3.5h7.5L19 9v11.5H6Z' }),
    React.createElement('path', { d: 'M13.5 3.5V9H19' }),
  )
}

/** The popover's dismiss affordance. */
function CloseIcon({ size = 14 }) {
  return React.createElement(
    Glyph,
    { size },
    React.createElement('path', { d: 'M6 6l12 12M18 6 6 18' }),
  )
}

/** A chevron marking the two expanding rows. */
function ChevronIcon({ size = 13, open = false }) {
  return React.createElement(
    Glyph,
    { size, style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s ease' } },
    React.createElement('path', { d: 'm9 6 6 6-6 6' }),
  )
}

/* ------------------------------------------------------------- the ledger */

/**
 * Read one session's produced-file ledger with a live subscription.
 * @param sessionId - the Session key.
 * @returns the current records, stable between mutations.
 */
function useProducedFiles(sessionId) {
  const read = useCallback(() => list(sessionId), [sessionId])
  return useSyncExternalStore(subscribe, read, read)
}

/* ---------------------------------------------------------- the tray seat */

/**
 * The header's far-right corner control.
 *
 * It renders nothing until the conversation has produced a file, so it never
 * competes with the header's utilities on an empty session. Once it has rows,
 * the button carries the count and the popover carries the list: one row per
 * file, click to open it in the right-side preview.
 * @param props - session-scoped slot props: `sessionId`, `useSessions`, `t`.
 * @returns the corner control, or `null` while there is nothing to list.
 */
export function FileTray(props) {
  const t = useMemo(makeT, [])
  const sessionId = props?.sessionId
  const useSessions = props?.useSessions
  const cwd = useSessions === undefined ? undefined : useSessions((state) => state?.byId?.[sessionId]?.cwd)
  const records = useProducedFiles(sessionId)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const anchorRef = useRef(null)
  const panelRef = useRef(null)

  // A session switch keeps the corner control mounted; the list behind it does
  // not belong to the new session, so the popover closes rather than swaps.
  useEffect(() => {
    setOpen(false)
    setFilter('')
  }, [sessionId])

  const sidebarRight = props?.sidebarRight
  const openPath = useCallback(
    (path) => {
      if (typeof path !== 'string' || path === '') return
      try {
        const address = fileAddressFor(sessionId, cwd, path)
        if (sidebarRight !== undefined && typeof sidebarRight.openResource === 'function') {
          sidebarRight.openResource(address)
        }
      } catch {
        // A failed open must not break the chat surface.
      }
    },
    [sidebarRight, cwd, sessionId],
  )

  // Dismissal wiring, deliberately deferred by one task.
  //
  // The popover opens from a click, and a listener attached in that same task
  // can still observe the rest of the opening gesture — with a capture-phase
  // pointerdown listener the opening click lands on a handler that is already
  // armed, which reads to the user as "the button does nothing". Arming after
  // the current task also matches how the rest of the UI's popovers behave.
  useEffect(() => {
    if (!open) return undefined
    let armed = false
    const arm = () => {
      armed = true
    }
    const onDown = (event) => {
      if (!armed) return
      const target = event?.target
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onResize = () => setOpen(false)
    const timer = setTimeout(arm, 0)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  if (!Array.isArray(records) || records.length === 0) return null
  const count = records.length

  const button = React.createElement(
    'button',
    {
      ref: anchorRef,
      type: 'button',
      title: t('tray.label'),
      'aria-label': t('tray.label'),
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      'data-file-tray-button': '',
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        setOpen((wasOpen) => !wasOpen)
      },
      // The whole gesture stays with the button: the header's neighbours must
      // not see this press, and the dismissal listener must not either.
      onPointerDown: (event) => event.stopPropagation(),
      onPointerUp: (event) => event.stopPropagation(),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 26,
        maxWidth: 128,
        padding: '0 8px 0 7px',
        margin: 0,
        border: `1px solid ${open ? V.border2 : V.border1}`,
        borderRadius: 999,
        background: open ? V.hover : 'transparent',
        color: open ? V.text1 : V.text2,
        font: `500 12px/1 ${FONT}`,
        fontVariantNumeric: 'tabular-nums',
        cursor: 'pointer',
        flex: 'none',
        whiteSpace: 'nowrap',
        transition: 'background .12s ease, border-color .12s ease, color .12s ease',
        outline: 'none',
      },
      onMouseEnter: (event) => {
        if (open) return
        event.currentTarget.style.background = V.hover
        event.currentTarget.style.color = V.text1
      },
      onMouseLeave: (event) => {
        if (open) return
        event.currentTarget.style.background = 'transparent'
        event.currentTarget.style.color = V.text2
      },
    },
    React.createElement('span', { style: { display: 'inline-flex', flex: 'none', color: open ? V.accent : 'inherit' } }, React.createElement(TrayIcon, { size: 14 })),
    React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, t('tray.button')),
    React.createElement(
      'span',
      {
        style: {
          flex: 'none',
          minWidth: 16,
          height: 16,
          padding: '0 4px',
          borderRadius: 999,
          background: V.layer,
          color: V.text2,
          fontSize: 10,
          lineHeight: '16px',
          textAlign: 'center',
          fontWeight: 600,
        },
      },
      count > 99 ? '99+' : String(count),
    ),
  )

  if (!open) return button

  const rect = anchorRef.current?.getBoundingClientRect()
  const width = 340
  const viewport = typeof window === 'undefined' ? 1280 : window.innerWidth
  const left = rect === undefined ? 16 : Math.min(Math.max(8, rect.right - width), Math.max(8, viewport - width - 8))
  const top = rect === undefined ? 56 : rect.bottom + 8
  const query = filter.trim().toLowerCase()
  const shown = query === '' ? records : records.filter((record) => record.path.toLowerCase().includes(query))

  const panel = React.createElement(
    'div',
    {
      ref: panelRef,
      role: 'dialog',
      'aria-label': t('tray.panelTitle'),
      'data-file-tray-panel': '',
      onPointerDown: (event) => event.stopPropagation(),
      style: {
        position: 'fixed',
        left,
        top,
        width,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'min(70vh, 520px)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 420,
        // A frosted card, matching the design system's own menu surface: the
        // theme token already carries alpha (≈45% dark / ≈58% light) and the
        // backdrop blur keeps the rows legible over whatever sits behind them.
        background: V.surface,
        backdropFilter: V.blur,
        WebkitBackdropFilter: V.blur,
        border: `1px solid ${V.border2}`,
        borderRadius: 14,
        boxShadow: '0 12px 36px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.06)',
        color: V.text1,
        font: `13px/1.5 ${FONT}`,
        overflow: 'hidden',
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: `1px solid ${V.border1}`,
          flex: 'none',
        },
      },
      React.createElement('span', { style: { display: 'inline-flex', color: V.accent, flex: 'none' } }, React.createElement(TrayIcon, { size: 15 })),
      React.createElement('span', { style: { fontWeight: 600, flex: 1, minWidth: 0 } }, t('tray.panelTitle')),
      React.createElement('span', { style: { color: V.text3, fontSize: 11, flex: 'none', fontVariantNumeric: 'tabular-nums' } }, t('tray.count', { count })),
      React.createElement(
        'button',
        {
          type: 'button',
          'aria-label': t('tray.close'),
          title: t('tray.close'),
          onClick: () => setOpen(false),
          style: {
            width: 24,
            height: 24,
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            border: 'none',
            borderRadius: 999,
            background: 'transparent',
            color: V.text3,
            cursor: 'pointer',
          },
          onMouseEnter: (event) => {
            event.currentTarget.style.background = V.hover
            event.currentTarget.style.color = V.text1
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = 'transparent'
            event.currentTarget.style.color = V.text3
          },
        },
        React.createElement(CloseIcon, { size: 14 }),
      ),
    ),

    records.length > 6
      ? React.createElement(
          'div',
          { style: { padding: '8px 12px 0', flex: 'none' } },
          React.createElement('input', {
            type: 'text',
            value: filter,
            placeholder: '筛选…',
            onChange: (event) => setFilter(event.target.value),
            style: {
              boxSizing: 'border-box',
              width: '100%',
              height: 30,
              padding: '0 9px',
              border: `1px solid ${V.border1}`,
              borderRadius: 8,
              background: 'transparent',
              color: V.text1,
              font: `12px/1.4 ${FONT}`,
              outline: 'none',
            },
          }),
        )
      : null,

    React.createElement(
      'div',
      {
        style: {
          flex: 'auto',
          minHeight: 0,
          overflowY: 'auto',
          padding: '6px 6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        },
      },
      shown.length === 0
        ? React.createElement(
            'div',
            { style: { padding: '18px 12px', textAlign: 'center', color: V.text3, fontSize: 12 } },
            t('tray.empty'),
            React.createElement('div', { style: { marginTop: 4, color: V.caption, fontSize: 11 } }, t('tray.emptyHint')),
          )
        : shown.map((record) =>
            React.createElement(
              'button',
              {
                key: record.path,
                type: 'button',
                title: record.path,
                'data-file-tray-row': record.path,
                onClick: () => {
                  openPath(record.path)
                  setOpen(false)
                },
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  borderRadius: 8,
                  background: 'transparent',
                  color: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  font: `inherit`,
                  minWidth: 0,
                },
                onMouseEnter: (event) => {
                  event.currentTarget.style.background = V.hoverSoft
                  const hint = event.currentTarget.querySelector('[data-file-tray-hint]')
                  if (hint !== null) hint.style.opacity = '1'
                },
                onMouseLeave: (event) => {
                  event.currentTarget.style.background = 'transparent'
                  const hint = event.currentTarget.querySelector('[data-file-tray-hint]')
                  if (hint !== null) hint.style.opacity = '0'
                },
              },
              React.createElement(
                'span',
                {
                  style: {
                    flex: 'none',
                    width: 26,
                    height: 26,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    background: V.layer,
                    color: V.link,
                  },
                  title: kindLabel(fileKindOf(record.path)),
                },
                React.createElement(KindIcon, { kind: fileKindOf(record.path), size: 15 }),
              ),
              React.createElement(
                'span',
                { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } },
                React.createElement(
                  'span',
                  {
                    style: {
                      color: V.link,
                      fontWeight: 500,
                      fontSize: 12.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  basenameOf(record.path),
                ),
                React.createElement(
                  'span',
                  {
                    style: {
                      color: V.text3,
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      direction: 'rtl',
                      textAlign: 'left',
                    },
                  },
                  dirnameOf(record.path),
                ),
              ),
              React.createElement(
                'span',
                {
                  'data-file-tray-hint': '',
                  style: {
                    flex: 'none',
                    color: V.caption,
                    fontSize: 11,
                    opacity: 0,
                    transition: 'opacity .12s ease',
                  },
                },
                t('tray.hint'),
              ),
            ),
          ),
    ),

    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderTop: `1px solid ${V.border1}`,
          flex: 'none',
          color: V.caption,
          fontSize: 11,
        },
      },
      React.createElement('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, records[records.length - 1]?.path ?? ''),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            for (const record of records) openPath(record.path)
            setOpen(false)
          },
          style: {
            flex: 'none',
            height: 26,
            padding: '0 10px',
            border: `1px solid ${V.border2}`,
            borderRadius: 8,
            background: 'transparent',
            color: V.text1,
            font: `500 11px/1 ${FONT}`,
            cursor: 'pointer',
          },
        },
        t('tray.openAll'),
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            clear(sessionId)
            setOpen(false)
          },
          style: {
            flex: 'none',
            height: 26,
            padding: '0 10px',
            border: `1px solid ${V.border2}`,
            borderRadius: 8,
            background: 'transparent',
            color: V.text2,
            font: `500 11px/1 ${FONT}`,
            cursor: 'pointer',
          },
        },
        t('tray.clear'),
      ),
    ),
  )

  return React.createElement(React.Fragment, null, button, ReactDOM.createPortal(panel, document.body))
}

/* -------------------------------------------------------- turn-tail seat */

/**
 * Invisible turn-tail seat that feeds one closing turn's produced paths into
 * the ledger.
 *
 * The official `deliverables` projection is turn-scoped and only published on
 * the turn model the seat already receives, so this seat is the one place the
 * tray can read the whole conversation without duplicating the tool-call
 * vocabulary. It renders no DOM.
 * @param props - turn-tail slot props plus the Session id this plugin injects.
 * @returns `null`.
 */
export function ProducedFileRecorder(props) {
  const turn = props?.turn
  const seq = props?.seq
  const sessionId = props?.sessionId
  const turnNumber = turn?.turn

  const paths = useMemo(() => collectProduced(turn, seq), [turn, seq])
  const key = paths.join('\u0000')

  useEffect(() => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (paths.length === 0) return
    recordProduced(sessionId, turnNumber, seq, paths)
    // `key` is the identity of `paths` that React can compare cheaply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, turnNumber, seq, key])

  return null
}

/* ---------------------------------------------------------- plugin face */

/**
 * Register the header tray and the invisible per-turn recorder.
 *
 * The tray lands in `conversation.session.header.utilities` — the header's
 * right-aligned utilities list, beside the session-log and open-in-app
 * controls. It deliberately does NOT take
 * `conversation.session.header.corner`: that slot is single-occupancy and the
 * sidebar-right plugin already holds it with the column's expand button, so a
 * second registration there would shadow (break) that control. A list slot
 * also lets the tray come and go with the conversation's files without
 * rearranging anything else in the header.
 *
 * The tray reads `ctx.sidebarRight` through the slot's injected face rather
 * than closing over the plugin context: an unload of the sidebar column then
 * parks the entry instead of leaving a half-dead button behind.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  // A build before this one injected a stylesheet that styled the document
  // preview. Remove it if the running page still carries one, so a reload lands
  // on the bundled preview behaviour exactly.
  ctx.effect(() => {
    retireImagePreviewLayer()
  }, 'dsh-file-tray: retire the old image-preview sheet')

  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.utilities',
        id: 'dsh-file-tray',
        order: 20,
        inject: () => ({ sidebarRight: ctx.sidebarRight }),
      },
      FileTray,
    ),
  )

  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        id: 'dsh-file-tray',
        order: 60,
      },
      ProducedFileRecorder,
    ),
  )
}

/** Offline harness surface; the loader reads only `name`, `inject`, `apply`. */
export const __test = { FileTray, ProducedFileRecorder, makeT, recordProduced, list, clear }
