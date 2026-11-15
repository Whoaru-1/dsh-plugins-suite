/**
 * dsh-balance — client half.
 *
 * Two surfaces, both fed by one shared poller over `GET /api/balance`:
 *
 *   1. `conversation.input.right` — a compact capsule beside the composer that
 *      shows the current total and opens a detail popover with the 30-day trend.
 *   2. `settings.section`        — an "API 余额" page with the full breakdown.
 *
 * The design system's alias tokens (`--dsw-alias-*`) carry every colour so the
 * surfaces follow the active light/dark theme.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'

const NS = 'dsh-balance'
/** Poll cadence; the host caches for five minutes, so this stays cheap. */
const POLL_MS = 60 * 1000

/* ------------------------------------------------------------------ i18n */

const zh = {
  'capsule.title': 'DeepSeek API 余额',
  'capsule.loading': '读取中…',
  'capsule.error': '读取失败',
  'detail.header': 'API 余额',
  'detail.total': '总余额',
  'detail.granted': '赠送余额',
  'detail.toppedUp': '充值余额',
  'detail.available': '账户可用',
  'detail.unavailable': '账户不可用',
  'detail.trend': '近 30 天走势',
  'detail.trendEmpty': '本次会话内还没有足够的历史数据',
  'detail.updated': '更新于',
  'detail.refresh': '刷新',
  'detail.refreshing': '刷新中…',
  'detail.close': '关闭',
  'nav': 'API 余额',
  'section.intro': '这里的数字直接来自 DeepSeek 官方余额接口。密钥只留在本地服务端，不会下发到浏览器。',
  'section.estimate': '剩余可用额度',
  'section.detailTitle': '余额构成',
  'section.trendTitle': '余额走势',
  'section.trendHint': '每 5 分钟采样一次，最多保留 720 个点。',
  'section.refresh': '立即刷新',
  'section.updated': '最后更新',
  'section.errorTitle': '无法读取余额',
  'section.keyHint': '请确认 ~/.dsh/.credentials.yaml 中已配置 DEEPSEEK_API_KEY。',
  'section.stale': '（显示的是缓存值）',
}

const en = {
  'capsule.title': 'DeepSeek API balance',
  'capsule.loading': 'Loading…',
  'capsule.error': 'Unavailable',
  'detail.header': 'API balance',
  'detail.total': 'Total balance',
  'detail.granted': 'Granted',
  'detail.toppedUp': 'Topped up',
  'detail.available': 'Account available',
  'detail.unavailable': 'Account unavailable',
  'detail.trend': 'Last 30 days',
  'detail.trendEmpty': 'Not enough history in this session yet',
  'detail.updated': 'Updated',
  'detail.refresh': 'Refresh',
  'detail.refreshing': 'Refreshing…',
  'detail.close': 'Close',
  'nav': 'API balance',
  'section.intro': 'These figures come straight from the DeepSeek balance endpoint. The key stays on the local host and is never sent to the browser.',
  'section.estimate': 'Remaining credit',
  'section.detailTitle': 'Breakdown',
  'section.trendTitle': 'Balance trend',
  'section.trendHint': 'Sampled every five minutes, keeping at most 720 points.',
  'section.refresh': 'Refresh now',
  'section.updated': 'Last updated',
  'section.errorTitle': 'Could not read the balance',
  'section.keyHint': 'Check that DEEPSEEK_API_KEY is present in ~/.dsh/.credentials.yaml.',
  'section.stale': '(showing a cached value)',
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
  return (key) => table[key] ?? en[key] ?? key
}

/* --------------------------------------------------------------- polling */

/**
 * One process-wide balance poller.
 *
 * Both surfaces mount independently but must not double-poll, and a capsule
 * remount (every session switch rebuilds the composer) must not blank the
 * readout. A module-level store with subscriber fan-out covers both.
 */
const store = {
  state: { phase: 'idle', data: null, error: null },
  listeners: new Set(),
  timer: null,
  inflight: null,
}

function emit() {
  for (const listener of store.listeners) listener()
}

async function load(force) {
  if (store.inflight !== null) return store.inflight
  store.inflight = (async () => {
    try {
      const url = force ? '/api/balance?force=1' : '/api/balance'
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      store.state = { phase: 'ready', data: body, error: null }
    } catch (error) {
      store.state = { phase: 'ready', data: null, error: String(error?.message ?? error) }
    } finally {
      store.inflight = null
      emit()
    }
  })()
  return store.inflight
}

function subscribe(listener) {
  store.listeners.add(listener)
  if (store.timer === null) {
    load(false)
    store.timer = setInterval(() => load(false), POLL_MS)
  }
  return () => {
    store.listeners.delete(listener)
    if (store.listeners.size === 0 && store.timer !== null) {
      clearInterval(store.timer)
      store.timer = null
    }
  }
}

/** Subscribe one component to the shared store. */
function useBalance() {
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  const refresh = useCallback((force) => load(force !== false), [])
  return { ...store.state, refresh }
}

/* ------------------------------------------------------------- utilities */

/** The figure the capsule headlines: the first currency row's total. */
function primaryRow(data) {
  const rows = Array.isArray(data?.balanceInfos) ? data.balanceInfos : []
  return rows[0] ?? null
}

/** Currency symbol for the amounts the endpoint reports. */
function symbolFor(currency) {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return currency ? `${currency} ` : ''
}

/** Format an amount with two decimals, or an em dash when it is unknown. */
function amount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—'
}

/** Format a timestamp as a short local clock time. */
function clockTime(at) {
  if (typeof at !== 'number') return ''
  try {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/* --------------------------------------------------------------- styling */

const V = {
  text1: 'var(--dsw-alias-label-primary, #222)',
  text2: 'var(--dsw-alias-label-secondary, #555)',
  text3: 'var(--dsw-alias-label-tertiary, #999)',
  caption: 'var(--dsw-alias-label-caption, #aaa)',
  bg: 'var(--dsw-alias-bg-base, #fff)',
  bgLayer: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.03))',
  border1: 'var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
  border2: 'var(--dsw-alias-border-l2, rgba(0,0,0,.12))',
  accent: 'var(--dsw-alias-state-business-primary, #5a6cf3)',
  success: 'var(--dsw-alias-state-success-primary, #16a34a)',
  danger: 'var(--dsw-alias-state-error-primary, #e5484d)',
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))',
}

const FONT = "var(--dsw-font-ui, -apple-system, 'Segoe UI', system-ui, sans-serif)"

/* ----------------------------------------------------------------- icons */

function CoinIcon(props) {
  return React.createElement(
    'svg',
    {
      width: props?.size ?? 14,
      height: props?.size ?? 14,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
    React.createElement('path', { d: 'M12 7v10M9.5 9.5h5M9.5 14.5h5' }),
  )
}

/* ------------------------------------------------------------ trend plot */

/**
 * A compact balance sparkline.
 *
 * Values are plotted on a padded domain so a nearly flat series still reads as
 * a line rather than collapsing onto one edge. The area fill is a single
 * accent gradient; the stroke uses a non-scaling width so the curve keeps its
 * weight at any element size.
 */
function TrendChart({ points, height = 120 }) {
  const width = 560
  const padY = 14
  const geometry = useMemo(() => {
    if (!Array.isArray(points) || points.length === 0) return null
    const values = points.map((point) => point.total)
    const min = Math.min(...values)
    const max = Math.max(...values)
    // A flat series gets an artificial span so the line sits mid-chart.
    const span = max - min < 1e-6 ? Math.max(Math.abs(max), 1) * 0.1 : max - min
    const low = min - span * 0.15
    const high = max + span * 0.15
    const stepX = points.length > 1 ? width / (points.length - 1) : 0
    const toY = (value) => padY + (1 - (value - low) / (high - low)) * (height - padY * 2)
    const coords = points.map((point, index) => [index * stepX, toY(point.total)])
    const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
    const area = `${line} L${width},${height} L0,${height} Z`
    return { line, area, min, max, last: coords[coords.length - 1] }
  }, [points, height])

  if (geometry === null) return null
  return React.createElement(
    'svg',
    {
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: 'none',
      style: { width: '100%', height, display: 'block', overflow: 'visible' },
      role: 'img',
    },
    React.createElement(
      'defs',
      null,
      React.createElement(
        'linearGradient',
        { id: 'dsh-balance-fill', x1: 0, y1: 0, x2: 0, y2: 1 },
        React.createElement('stop', { offset: '0%', stopColor: V.accent, stopOpacity: 0.28 }),
        React.createElement('stop', { offset: '100%', stopColor: V.accent, stopOpacity: 0 }),
      ),
    ),
    React.createElement('path', { d: geometry.area, fill: 'url(#dsh-balance-fill)', stroke: 'none' }),
    React.createElement('path', {
      d: geometry.line,
      fill: 'none',
      stroke: V.accent,
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
    }),
    React.createElement('circle', {
      cx: geometry.last[0],
      cy: geometry.last[1],
      r: 3.5,
      fill: V.accent,
      vectorEffect: 'non-scaling-stroke',
    }),
  )
}

/* ----------------------------------------------------- shared data view */

/** The current snapshot pared down to what the surfaces render. */
function useBalanceView() {
  const state = useBalance()
  const data = state.data
  const row = primaryRow(data)
  return {
    phase: state.phase,
    error: state.error ?? data?.error ?? null,
    at: data?.at ?? null,
    available: data?.isAvailable === true,
    currency: row?.currency ?? 'CNY',
    total: row?.totalBalance ?? null,
    granted: row?.grantedBalance ?? null,
    toppedUp: row?.toppedUpBalance ?? null,
    rows: Array.isArray(data?.balanceInfos) ? data.balanceInfos : [],
    history: Array.isArray(data?.history) ? data.history : [],
    refresh: state.refresh,
  }
}

/** Proportional split bar for granted versus topped-up credit. */
function BreakdownBar({ view }) {
  const granted = Math.max(view.granted ?? 0, 0)
  const toppedUp = Math.max(view.toppedUp ?? 0, 0)
  const sum = granted + toppedUp
  const grantedPct = sum > 0 ? (granted / sum) * 100 : 0
  return React.createElement(
    'div',
    { style: { display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: V.bgLayer } },
    grantedPct > 0
      ? React.createElement('div', { style: { width: `${grantedPct}%`, background: V.success } })
      : null,
    grantedPct < 100
      ? React.createElement('div', { style: { flex: 1, background: V.accent } })
      : null,
  )
}

/* ------------------------------------------------------- composer capsule */

/**
 * The composer-right capsule.
 *
 * It is deliberately small: a coin mark plus the headline figure. Detail lives
 * in the popover so the composer never grows a second toolbar.
 */
function BalanceCapsule() {
  const t = useMemo(makeT, [])
  const view = useBalanceView()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const popRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      const target = event?.target
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const loading = view.phase === 'idle'
  const failed = view.total === null
  const money = loading ? t('capsule.loading') : failed ? t('capsule.error') : `${symbolFor(view.currency)}${amount(view.total)}`

  const button = React.createElement(
    'button',
    {
      ref: anchorRef,
      type: 'button',
      title: `${t('capsule.title')} · ${money}`,
      'aria-label': t('capsule.title'),
      'aria-expanded': open,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 30,
        padding: '0 9px',
        margin: 0,
        border: `1px solid ${V.border1}`,
        borderRadius: 999,
        background: 'transparent',
        color: failed ? V.text3 : V.text2,
        font: `500 12px/1 ${FONT}`,
        fontVariantNumeric: 'tabular-nums',
        cursor: 'pointer',
        flex: 'none',
        transition: 'background .12s ease, border-color .12s ease, color .12s ease',
        outline: 'none',
      },
      onMouseEnter: (event) => {
        event.currentTarget.style.background = V.hover
        event.currentTarget.style.color = V.text1
      },
      onMouseLeave: (event) => {
        event.currentTarget.style.background = 'transparent'
        event.currentTarget.style.color = failed ? V.text3 : V.text2
      },
      onPointerDown: (event) => event.stopPropagation(),
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        setOpen((wasOpen) => !wasOpen)
      },
    },
    React.createElement('span', { style: { display: 'inline-flex', color: failed ? V.text3 : V.accent } }, CoinIcon({ size: 13 })),
    React.createElement('span', null, money),
  )

  if (!open) return button

  const rect = anchorRef.current?.getBoundingClientRect()
  const popoverTop = rect ? Math.max(8, rect.top - 12) : 80
  const popoverStyle = {
    position: 'fixed',
    left: rect ? Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 328)) : 16,
    top: popoverTop,
    transform: 'translateY(-100%)',
    width: 320,
    maxWidth: 'calc(100vw - 16px)',
    zIndex: 400,
    background: V.bg,
    border: `1px solid ${V.border2}`,
    borderRadius: 14,
    boxShadow: '0 10px 34px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.08)',
    color: V.text1,
    font: `13px/1.45 ${FONT}`,
    overflow: 'hidden',
  }

  const rows = [
    [t('detail.total'), `${symbolFor(view.currency)}${amount(view.total)}`],
    [t('detail.granted'), `${symbolFor(view.currency)}${amount(view.granted)}`],
    [t('detail.toppedUp'), `${symbolFor(view.currency)}${amount(view.toppedUp)}`],
  ]

  const popover = React.createElement(
    'div',
    { ref: popRef, style: popoverStyle, onPointerDown: (event) => event.stopPropagation() },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: `1px solid ${V.border1}`,
          fontWeight: 600,
        },
      },
      React.createElement('span', { style: { display: 'inline-flex', color: V.accent } }, CoinIcon({ size: 15 })),
      React.createElement('span', { style: { flex: 1 } }, t('detail.header')),
      React.createElement(
        'span',
        { style: { fontWeight: 400, fontSize: 11, color: view.available && !failed ? V.success : V.danger } },
        view.available && !failed ? t('detail.available') : t('detail.unavailable'),
      ),
    ),
    failed
      ? React.createElement(
          'div',
          { style: { padding: '12px', color: V.danger, fontSize: 12, wordBreak: 'break-word' } },
          view.error ?? t('capsule.error'),
        )
      : React.createElement(
          'div',
          { style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 } },
          rows.map(([label, value]) =>
            React.createElement(
              'div',
              { key: label, style: { display: 'flex', justifyContent: 'space-between' } },
              React.createElement('span', { style: { color: V.text2 } }, label),
              React.createElement('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 500 } }, value),
            ),
          ),
          React.createElement(BreakdownBar, { view }),
        ),
    React.createElement(
      'div',
      { style: { padding: '0 12px 8px' } },
      React.createElement('div', { style: { fontSize: 11, color: V.text3, marginBottom: 4 } }, t('detail.trend')),
      view.history.length > 1
        ? React.createElement(TrendChart, { points: view.history, height: 84 })
        : React.createElement('div', { style: { fontSize: 11, color: V.caption, padding: '10px 0' } }, t('detail.trendEmpty')),
    ),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderTop: `1px solid ${V.border1}`,
          fontSize: 11,
          color: V.caption,
        },
      },
      React.createElement('span', { style: { flex: 1 } }, view.at ? `${t('detail.updated')} ${clockTime(view.at)}` : ''),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => view.refresh(true),
          style: {
            border: 'none',
            background: 'transparent',
            color: V.accent,
            font: 'inherit',
            cursor: 'pointer',
            padding: 0,
          },
        },
        t('detail.refresh'),
      ),
    ),
  )

  return React.createElement(React.Fragment, null, button, ReactDOM.createPortal(popover, document.body))
}

/* -------------------------------------------------------- settings page */

/** One labelled figure in the settings grid. */
function StatCard({ label, value, accent }) {
  return React.createElement(
    'div',
    {
      style: {
        flex: '1 1 0',
        minWidth: 0,
        padding: '12px 14px',
        borderRadius: 12,
        border: `1px solid ${V.border1}`,
        background: V.bgLayer,
      },
    },
    React.createElement('div', { style: { fontSize: 11, color: V.text3, marginBottom: 6 } }, label),
    React.createElement(
      'div',
      { style: { fontSize: 20, fontWeight: 600, color: accent ?? V.text1, fontVariantNumeric: 'tabular-nums' } },
      value,
    ),
  )
}

/** The settings section body. */
function BalanceSection() {
  const t = useMemo(makeT, [])
  const view = useBalanceView()
  const [busy, setBusy] = useState(false)

  const failed = view.total === null
  const symbol = symbolFor(view.currency)

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0 24px', font: `13px/1.55 ${FONT}`, color: V.text1 } },
    React.createElement('div', { style: { color: V.text2, fontSize: 12 } }, t('section.intro')),

    failed
      ? React.createElement(
          'div',
          {
            style: {
              padding: '14px 16px',
              borderRadius: 12,
              border: `1px solid ${V.border2}`,
              background: V.bgLayer,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            },
          },
          React.createElement('div', { style: { fontWeight: 600, color: V.danger } }, t('section.errorTitle')),
          view.error ? React.createElement('div', { style: { fontSize: 12, color: V.text2, wordBreak: 'break-word' } }, view.error) : null,
          React.createElement('div', { style: { fontSize: 11, color: V.text3 } }, t('section.keyHint')),
        )
      : React.createElement(
          'div',
          null,
          React.createElement('div', { style: { fontSize: 11, color: V.text3, marginBottom: 6 } }, t('section.estimate')),
          React.createElement(
            'div',
            { style: { fontSize: 34, fontWeight: 600, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' } },
            `${symbol}${amount(view.total)}`,
          ),
          React.createElement(
            'div',
            { style: { fontSize: 12, marginTop: 4, color: view.available ? V.success : V.danger } },
            view.available ? t('detail.available') : t('detail.unavailable'),
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 10, marginTop: 14 } },
            React.createElement(StatCard, { label: t('detail.granted'), value: `${symbol}${amount(view.granted)}`, accent: V.success }),
            React.createElement(StatCard, { label: t('detail.toppedUp'), value: `${symbol}${amount(view.toppedUp)}`, accent: V.accent }),
          ),
        ),

    view.rows.length > 1
      ? React.createElement(
          'div',
          null,
          React.createElement('div', { style: { fontSize: 11, color: V.text3, margin: '4px 0 8px' } }, t('section.detailTitle')),
          React.createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            view.rows.map((row) =>
              React.createElement(
                'div',
                { key: row.currency, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12 } },
                React.createElement('span', { style: { color: V.text2 } }, row.currency),
                React.createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, `${symbolFor(row.currency)}${amount(row.totalBalance)}`),
              ),
            ),
          ),
        )
      : null,

    React.createElement(
      'div',
      null,
      React.createElement(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
        React.createElement('span', { style: { fontSize: 11, color: V.text3 } }, t('section.trendTitle')),
        React.createElement('span', { style: { fontSize: 11, color: V.caption } }, t('section.trendHint')),
      ),
      view.history.length > 1
        ? React.createElement(TrendChart, { points: view.history, height: 140 })
        : React.createElement(
            'div',
            {
              style: {
                padding: '22px 16px',
                textAlign: 'center',
                fontSize: 12,
                color: V.text3,
                border: `1px dashed ${V.border2}`,
                borderRadius: 12,
              },
            },
            t('detail.trendEmpty'),
          ),
    ),

    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 10, borderTop: `1px solid ${V.border1}`, paddingTop: 12 } },
      React.createElement(
        'span',
        { style: { flex: 1, fontSize: 11, color: V.caption } },
        view.at ? `${t('section.updated')} ${clockTime(view.at)}` : '',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: busy,
          onClick: async () => {
            setBusy(true)
            try {
              await view.refresh(true)
            } finally {
              setBusy(false)
            }
          },
          style: {
            height: 30,
            padding: '0 12px',
            borderRadius: 8,
            border: `1px solid ${V.border2}`,
            background: 'transparent',
            color: busy ? V.text3 : V.text1,
            font: `500 12px/1 ${FONT}`,
            cursor: busy ? 'default' : 'pointer',
          },
        },
        busy ? t('detail.refreshing') : t('section.refresh'),
      ),
    ),
  )
}

/* ------------------------------------------------------------ plugin face */

/** Services this client half depends on. */
export const inject = ['slots', 'locale']

/**
 * Register the composer capsule and the settings section.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-balance: dictionaries')

  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.right',
        id: 'dsh-balance',
        order: 30,
        locale: NS,
      },
      BalanceCapsule,
    ),
  )

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-balance',
        order: 60,
        label: () => t('nav'),
        locale: NS,
      },
      BalanceSection,
    ),
  )
}
