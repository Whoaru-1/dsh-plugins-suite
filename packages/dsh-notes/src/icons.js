/**
 * dsh-notes — one consistent stroked icon set.
 *
 * Icons are authored here rather than borrowed from an icon font so every
 * glyph shares the same 24-grid, stroke weight, and round joins as the rest of
 * the panel.
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

/** A sticky note with a folded corner and two written lines. */
export function NotesIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', { d: 'M5 4.5h9.2L19.5 9.8V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V6A1.5 1.5 0 0 1 6 4.5Z' }),
    React.createElement('path', { d: 'M14.2 4.5v5.3h5.3' }),
    React.createElement('path', { d: 'M8 13.2h6.2M8 16.4h4.2' }),
  )
}

/** A magnifier. */
export function SearchIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('circle', { cx: 10.8, cy: 10.8, r: 6.3 }),
    React.createElement('path', { d: 'm15.5 15.5 4 4' }),
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

/** A pencil. */
export function PencilIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', { d: 'M14.8 5.3l3.9 3.9' }),
    React.createElement('path', { d: 'M5 19l1-4.5L16.7 3.8a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L9.5 18 5 19Z' }),
  )
}

/** A waste bin. */
export function TrashIcon(props) {
  return React.createElement(
    Glyph,
    props,
    React.createElement('path', { d: 'M4.8 7h14.4' }),
    React.createElement('path', { d: 'M9.4 7V5.2A1.2 1.2 0 0 1 10.6 4h2.8a1.2 1.2 0 0 1 1.2 1.2V7' }),
    React.createElement('path', { d: 'M6.5 7l.8 11.1A1.5 1.5 0 0 0 8.8 19.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7' }),
    React.createElement('path', { d: 'M10.2 10.6v5M13.8 10.6v5' }),
  )
}

/** A check mark for status punctuation. */
export function CheckIcon(props) {
  return React.createElement(Glyph, props, React.createElement('path', { d: 'm5 12.5 4.3 4.2L19 6.8' }))
}

/** A quiet fallback glyph for the empty wall. */
export function EmptyNoteIcon(props) {
  return React.createElement(
    Glyph,
    { strokeWidth: 1.25, ...props },
    React.createElement('path', { d: 'M5.5 4h9l5 5v11a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5.5A1.5 1.5 0 0 1 6 4Z' }),
    React.createElement('path', { d: 'M14.3 4v5.2h5.2' }),
    React.createElement('path', { d: 'M8.2 12.6h7.6M8.2 16h6' }),
  )
}
