/**
 * dsh-spss — one consistent stroked icon set.
 *
 * Every glyph lives on the same 24-unit grid with the same stroke weight and
 * round joins, in `currentColor` only, so the panel inherits the harness ink
 * and the sidebar row can flip weight when it is active.
 */
import React from 'react'

/** One stroked SVG in a 24-unit grid. */
function Glyph({ size = 16, strokeWidth = 1.7, children, ...rest }) {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      ...rest,
    },
    children,
  )
}

/**
 * The sidebar mark: a histogram of three bars rising out of an axis, with a
 * fitted trend — the one picture everybody recognises as "statistics".
 */
export function StatsIcon({ size, strokeWidth, ...rest }) {
  return React.createElement(
    Glyph,
    { size: size ?? 17, strokeWidth: strokeWidth ?? 1.7, ...rest },
    React.createElement('path', { d: 'M3.6 20.4V4.6' }),
    React.createElement('path', { d: 'M3.6 20.4h16.8' }),
    React.createElement('path', { d: 'M7.1 20.4v-5.2' }),
    React.createElement('path', { d: 'M10.9 20.4v-9.1' }),
    React.createElement('path', { d: 'M14.7 20.4v-6.6' }),
    React.createElement('path', { d: 'M18.5 20.4V9.2' }),
    React.createElement('path', { d: 'M6.4 9.6 10.6 6l3.6 2.4 4.2-4.2', opacity: 0.55 }),
  )
}

/** A stroked document — the data file. */
export function FileIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', {
      d: 'M6 3.5h7.4L18.5 8.6V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z',
    }),
    React.createElement('path', { d: 'M13.2 3.5v5.3h5.3' }),
    React.createElement('path', { d: 'M7.8 12.6h7M7.8 15.8h5' }),
  )
}

/** A folder — the output directory. */
export function FolderIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', {
      d: 'M3.6 7.4A1.9 1.9 0 0 1 5.5 5.5h3.4l1.9 2.3h7.7a1.9 1.9 0 0 1 1.9 1.9v8.4a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9Z',
    }),
    React.createElement('path', { d: 'M3.6 10.4h16.8' }),
  )
}

/** A spreadsheet grid — the data preview. */
export function TableIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('rect', { x: 3.6, y: 4.6, width: 16.8, height: 14.8, rx: 2 }),
    React.createElement('path', { d: 'M3.6 9.4h16.8' }),
    React.createElement('path', { d: 'M9.2 9.4v10' }),
    React.createElement('path', { d: 'M14.8 9.4v10' }),
  )
}

/** A circular arrow — refresh. */
export function RefreshIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', { d: 'M20 12a8 8 0 1 1-2.6-5.9' }),
    React.createElement('path', { d: 'M20.4 4.2v4.4h-4.4' }),
  )
}

/** A play/run mark. */
export function PlayIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', { d: 'M7.6 4.9 19 12 7.6 19.1Z' }),
  )
}

/** A check mark. */
export function CheckIcon(props) {
  return React.createElement(Glyph, props, React.createElement('path', { d: 'm5 12.5 4.3 4.2L19 6.8' }))
}

/** An alert mark. */
export function AlertIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('circle', { cx: 12, cy: 12, r: 8.4 }),
    React.createElement('path', { d: 'M12 7.9v5.2' }),
    React.createElement('path', { d: 'M12 16.3h.01' }),
  )
}

/** A small close mark. */
export function CloseIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }),
  )
}

/** An external/reveal mark, for "show in Finder". */
export function RevealIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', { d: 'M13.4 4.8h5.8v5.8' }),
    React.createElement('path', { d: 'M19.2 4.8 10.9 13' }),
    React.createElement('path', { d: 'M17.6 14.4v3.9a1.5 1.5 0 0 1-1.5 1.5H5.6a1.5 1.5 0 0 1-1.5-1.5V7.6a1.5 1.5 0 0 1 1.5-1.5h3.9' }),
  )
}

/** A chevron, used by collapsible blocks. */
export function ChevronIcon({ size = 14, open = false, ...rest }) {
  return React.createElement(
    Glyph,
    { size, ...rest },
    React.createElement('path', { d: open ? 'm6.5 14.5 5.5-5.5 5.5 5.5' : 'm6.5 9.5 5.5 5.5 5.5-5.5' }),
  )
}

/** A quiet fallback glyph for the empty state. */
export function EmptyDataIcon(props) {
  return React.createElement(
    Glyph,
    { strokeWidth: 1.25, ...props },
    React.createElement('rect', { x: 3.4, y: 4.8, width: 17.2, height: 14.4, rx: 2.2 }),
    React.createElement('path', { d: 'M3.4 9.6h17.2' }),
    React.createElement('path', { d: 'M8.6 9.6v9.6' }),
    React.createElement('path', { d: 'M14 12.6h4' }),
    React.createElement('path', { d: 'M14 15.6h4' }),
  )
}

/** A clock, for the recent-output list. */
export function ClockIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('circle', { cx: 12, cy: 12, r: 8.2 }),
    React.createElement('path', { d: 'M12 7.6V12l3 1.8' }),
  )
}
