/**
 * dsh-office-preview — client half.
 *
 * Registers document renderers for the file types the official sidebar preview
 * cannot show, through the official extension points:
 *   ctx.documentPreviews.register(...)                   → metadata (extensions, loading mode)
 *   ctx.slots.inject('sidebar.right.tab.document', ...)  → the keyed body component
 *
 * Every renderer here needs complete bytes (`loading: 'bytes-complete'`), because
 * the panel's text reader rejects binary content with `workspace-file/not-text`.
 *
 * `react` / `react/jsx-runtime` arrive through the client-module table; the three
 * renderer libraries are bundled into `lib/client.js`.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import * as XLSX from 'xlsx'
import { init as initPptx } from 'pptx-preview'

/* ------------------------------------------------------------------ content */

const decoder = new TextDecoder('utf-8', { fatal: false })

/** @returns {Uint8Array|null} the complete bytes delivered to a bytes-complete body. */
function bytesOf(content) {
  if (!content || content.kind !== 'bytes' || !content.data) return null
  const data = content.data
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

/** Copy out an exact ArrayBuffer: the bundled readers must not share a larger buffer. */
function bufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/* ---------------------------------------------------------------- utilities */

/** @returns {string} the address's lowercase extension without the dot. */
function extensionOf(address) {
  const clean = String(address || '').split(/[?#]/)[0]
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  const name = slash >= 0 ? clean.slice(slash + 1) : clean
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** @returns {string} the address's basename, for messages. */
function basenameOf(address) {
  const clean = String(address || '').split(/[?#]/)[0]
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return slash >= 0 ? clean.slice(slash + 1) : clean
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/**
 * Parse delimited text with quoted fields, embedded newlines, and doubled quotes.
 * @returns {string[][]} rows of cells, unpadded.
 */
function parseDelimited(text, delimiter) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += character
      index += 1
      continue
    }
    if (character === '"' && field.length === 0) {
      quoted = true
      index += 1
      continue
    }
    if (character === delimiter) {
      row.push(field)
      field = ''
      index += 1
      continue
    }
    if (character === '\r') {
      index += 1
      continue
    }
    if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      index += 1
      continue
    }
    field += character
    index += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Sniff the delimiter from the first non-empty line of a delimited file. */
function guessDelimiter(text) {
  const line = text.slice(0, 65536).split('\n').find((candidate) => candidate.trim() !== '') || ''
  let best = ','
  let bestCount = 0
  for (const candidate of [',', '\t', ';', '|']) {
    const count = line.split(candidate).length - 1
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

/* ------------------------------------------------------------------ surface */

const IconDocument = () => (
  <svg className="dop-icon" width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M4 1.5h5L13 5.5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path d="M9 1.5V5.5H13" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
)

/** One renderer surface: it owns the inner scrollport and reports it to the owner. */
function Surface(props) {
  return (
    <div className="dop-root">
      {props.bar ? <div className="dop-bar">{props.bar}</div> : null}
      <div className={props.flush ? 'dop-body dop-body-flush' : 'dop-body'} ref={props.scrollportRef}>
        {props.children}
      </div>
    </div>
  )
}

function Notice(props) {
  return (
    <div className="dop-card">
      <div className="dop-card-icon">{props.icon || <IconDocument />}</div>
      <div className="dop-card-title">{props.title}</div>
      {props.detail ? <div className="dop-card-detail">{props.detail}</div> : null}
      {props.hint ? <div className="dop-card-hint">{props.hint}</div> : null}
    </div>
  )
}

/** The message every renderer shows when the owner handed it no complete content. */
function MissingBytes(props) {
  return (
    <Surface scrollportRef={props.scrollportRef}>
      <Notice
        title="未能读取文件内容"
        detail={basenameOf(props.resourceAddress)}
        hint="该视图需要完整文件字节。请点工具条上的重新载入；若文件大于 32 MB，读取会被上限拒绝。"
      />
    </Surface>
  )
}

function RenderFailure(props) {
  return (
    <Surface scrollportRef={props.scrollportRef}>
      <Notice title={props.title} detail={props.detail} hint={props.hint} />
    </Surface>
  )
}

/* --------------------------------------------------------------------- docx */

/**
 * Word documents render with docx-preview: it produces the real page layout,
 * including headers, footers, footnotes, lists, tables and embedded images.
 */
function DocxBody(props) {
  const hostRef = useRef(null)
  const [phase, setPhase] = useState('rendering')
  const [failure, setFailure] = useState('')
  const bytes = bytesOf(props.content)

  useEffect(() => {
    const host = hostRef.current
    if (!bytes || !host) return undefined
    let cancelled = false
    host.textContent = ''
    setPhase('rendering')
    setFailure('')
    renderAsync(bufferOf(bytes), host, undefined, {
      className: 'dop-docx',
      inWrapper: true,
      breakPages: true,
      ignoreWidth: false,
      ignoreHeight: true,
      ignoreFonts: false,
      experimental: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: false,
      renderChanges: false,
    })
      .then(() => {
        if (!cancelled) setPhase('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setFailure((error && error.message) || String(error))
        setPhase('failed')
      })
    return () => {
      cancelled = true
      try {
        host.textContent = ''
      } catch {
        /* the host may already be detached */
      }
    }
  }, [bytes])

  if (!bytes) return <MissingBytes resourceAddress={props.resourceAddress} scrollportRef={props.scrollportRef} />
  if (phase === 'failed') {
    return (
      <RenderFailure
        title="Word 文档渲染失败"
        detail={failure}
        hint="加密文档、损坏的包，或 .doc（旧版二进制格式）无法渲染。可以让模型把它另存为 .docx 再打开。"
        scrollportRef={props.scrollportRef}
      />
    )
  }
  return (
    <Surface
      scrollportRef={props.scrollportRef}
      bar={<span className="dop-bar-title">{phase === 'rendering' ? '正在排版…' : 'Word 文档'}</span>}
    >
      <div className="dop-docx-host" ref={hostRef} />
    </Surface>
  )
}

/* --------------------------------------------------------------------- xlsx */

const GRID_ROWS = 500
const GRID_COLS = 120

/** Convert one sheet into a rectangular display grid with merge spans. */
function sheetGrid(sheet, limits) {
  const reference = sheet['!ref']
  const empty = { rows: [], headerRows: new Set(), headerCols: new Set(), truncated: false }
  if (!reference) return empty
  const range = XLSX.utils.decode_range(reference)
  const lastRow = Math.min(range.e.r, range.s.r + limits.rows - 1)
  const lastCol = Math.min(range.e.c, range.s.c + limits.cols - 1)
  const merges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : []
  const anchors = new Map()
  const covered = new Set()
  for (const merge of merges) {
    anchors.set(`${merge.s.r}:${merge.s.c}`, {
      rowSpan: merge.e.r - merge.s.r + 1,
      colSpan: merge.e.c - merge.s.c + 1,
    })
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let column = merge.s.c; column <= merge.e.c; column += 1) {
        if (row !== merge.s.r || column !== merge.s.c) covered.add(`${row}:${column}`)
      }
    }
  }
  const rows = []
  for (let row = range.s.r; row <= lastRow; row += 1) {
    const cells = []
    let populated = false
    for (let column = range.s.c; column <= lastCol; column += 1) {
      const key = `${row}:${column}`
      if (covered.has(key)) continue
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]
      let text = ''
      if (cell !== undefined && cell !== null) {
        try {
          text = XLSX.utils.format_cell(cell)
        } catch {
          text = cell.w !== undefined ? String(cell.w) : String(cell.v ?? '')
        }
      }
      if (text !== '') populated = true
      const span = anchors.get(key)
      cells.push(
        <td
          key={column}
          className={cell && cell.t === 'n' ? 'dop-num' : undefined}
          rowSpan={span && span.rowSpan > 1 ? span.rowSpan : undefined}
          colSpan={span && span.colSpan > 1 ? span.colSpan : undefined}
          title={text.length > 60 ? text : undefined}
        >
          {text}
        </td>,
      )
    }
    if (populated || rows.length > 0) rows.push(cells)
  }
  const headerRows = rows.length > 0 ? new Set([0]) : new Set()
  return {
    rows,
    headerRows,
    headerCols: range.s.c === 0 && range.s.r === 0 ? new Set([0]) : new Set(),
    truncated: range.e.r > lastRow || range.e.c > lastCol,
  }
}

function GridTable(props) {
  const grid = props.grid
  return (
    <table className="dop-grid">
      <tbody>
        {grid.rows.map((row, rowIndex) => (
          <tr key={rowIndex} className={grid.headerRows.has(rowIndex) ? 'dop-grid-head' : undefined}>
            {row}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function WorkbookBody(props) {
  const bytes = bytesOf(props.content)
  const parsed = useMemo(() => {
    if (!bytes) return { failure: '', sheets: [] }
    try {
      const book = XLSX.read(bufferOf(bytes), { type: 'array', cellDates: true, cellNF: true, cellText: true })
      return {
        failure: '',
        sheets: book.SheetNames.map((sheetName) => ({ name: sheetName, sheet: book.Sheets[sheetName] })),
      }
    } catch (error) {
      return { failure: (error && error.message) || String(error), sheets: [] }
    }
  }, [bytes])
  const [active, setActive] = useState(0)

  if (!bytes) return <MissingBytes resourceAddress={props.resourceAddress} scrollportRef={props.scrollportRef} />
  if (parsed.failure) {
    return (
      <RenderFailure
        title="表格解析失败"
        detail={parsed.failure}
        hint="加密工作簿或损坏的文件无法解析。"
        scrollportRef={props.scrollportRef}
      />
    )
  }
  if (parsed.sheets.length === 0) {
    return (
      <Surface scrollportRef={props.scrollportRef}>
        <Notice title="工作簿里没有工作表" detail={basenameOf(props.resourceAddress)} />
      </Surface>
    )
  }
  const index = Math.min(active, parsed.sheets.length - 1)
  const current = parsed.sheets[index]
  const grid = sheetGrid(current.sheet, { rows: GRID_ROWS, cols: GRID_COLS })
  return (
    <Surface
      flush
      scrollportRef={props.scrollportRef}
      bar={
        <>
          <div className="dop-tabs" role="tablist">
            {parsed.sheets.map((sheet, sheetIndex) => (
              <button
                key={sheet.name}
                type="button"
                role="tab"
                aria-selected={sheetIndex === index}
                className={sheetIndex === index ? 'dop-tab dop-tab-on' : 'dop-tab'}
                onClick={() => setActive(sheetIndex)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
          <span className="dop-bar-meta">
            {grid.rows.length} 行{grid.truncated ? ` (仅前 ${GRID_ROWS}×${GRID_COLS})` : ''}
          </span>
        </>
      }
    >
      <div className="dop-sheet">
        <GridTable grid={grid} />
      </div>
    </Surface>
  )
}

/* ---------------------------------------------------------------------- csv */

function CsvBody(props) {
  const bytes = bytesOf(props.content)
  const rows = useMemo(() => {
    if (!bytes) return []
    const text = decoder.decode(bytes)
    const extension = extensionOf(props.resourceAddress)
    const delimiter = extension === 'tsv' || extension === 'tab' ? '\t' : guessDelimiter(text)
    return parseDelimited(text, delimiter)
  }, [bytes, props.resourceAddress])

  if (!bytes) return <MissingBytes resourceAddress={props.resourceAddress} scrollportRef={props.scrollportRef} />

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const clipped = rows.length > GRID_ROWS
  return (
    <Surface
      flush
      scrollportRef={props.scrollportRef}
      bar={
        <span className="dop-bar-meta">
          {rows.length} 行 × {width} 列{clipped ? ` (仅显示前 ${GRID_ROWS} 行)` : ''}
        </span>
      }
    >
      <div className="dop-sheet">
        <table className="dop-grid">
          <tbody>
            {rows.slice(0, GRID_ROWS).map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === 0 ? 'dop-grid-head' : undefined}>
                {Array.from({ length: width }, (_, column) => (
                  <td key={column} title={row[column] && row[column].length > 60 ? row[column] : undefined}>
                    {row[column] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  )
}

/* --------------------------------------------------------------------- pptx */

const SLIDE_WIDTH = 960
const SLIDE_HEIGHT = 540

function PptxBody(props) {
  const hostRef = useRef(null)
  const stageRef = useRef(null)
  const [phase, setPhase] = useState('rendering')
  const [failure, setFailure] = useState('')
  const bytes = bytesOf(props.content)

  // Scale the fixed-size slide column to the pane width; the renderer itself
  // lays every slide out at 960×540 CSS pixels.
  useEffect(() => {
    const stage = stageRef.current
    const host = hostRef.current
    if (!stage || !host) return undefined
    const fit = () => {
      stage.style.transform = 'none'
      const width = host.clientWidth
      if (!width || width >= SLIDE_WIDTH) {
        stage.style.transform = 'none'
        return
      }
      stage.style.transform = `scale(${(width / SLIDE_WIDTH).toFixed(4)})`
    }
    fit()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    return () => observer.disconnect()
  }, [bytes, phase])

  useEffect(() => {
    const host = hostRef.current
    if (!bytes || !host) return undefined
    let cancelled = false
    let previewer = null
    host.textContent = ''
    setPhase('rendering')
    setFailure('')
    try {
      previewer = initPptx(host, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT })
      Promise.resolve(previewer.preview(bufferOf(bytes)))
        .then(() => {
          if (!cancelled) setPhase('ready')
        })
        .catch((error) => {
          if (cancelled) return
          setFailure((error && error.message) || String(error))
          setPhase('failed')
        })
    } catch (error) {
      setFailure((error && error.message) || String(error))
      setPhase('failed')
    }
    return () => {
      cancelled = true
      try {
        if (previewer && typeof previewer.destroy === 'function') previewer.destroy()
      } catch {
        /* teardown is best-effort */
      }
      try {
        host.textContent = ''
      } catch {
        /* the host may already be detached */
      }
    }
  }, [bytes])

  if (!bytes) return <MissingBytes resourceAddress={props.resourceAddress} scrollportRef={props.scrollportRef} />
  if (phase === 'failed') {
    return (
      <RenderFailure
        title="演示文稿渲染失败"
        detail={failure}
        hint="加密文档或旧版 .ppt 格式无法预览。可以让模型把它另存为 .pptx。"
        scrollportRef={props.scrollportRef}
      />
    )
  }
  return (
    <Surface scrollportRef={props.scrollportRef} bar={<span className="dop-bar-title">PowerPoint 演示文稿</span>}>
      <div className="dop-pptx-fit" ref={hostRef}>
        <div className="dop-pptx-stage" ref={stageRef} />
      </div>
    </Surface>
  )
}

/* ------------------------------------------------------- unsupported binary */

function UnsupportedBody(props) {
  const bytes = bytesOf(props.content)
  const extension = extensionOf(props.resourceAddress)
  const name = basenameOf(props.resourceAddress)
  const size = bytes ? formatSize(bytes.byteLength) : ''
  return (
    <Surface scrollportRef={props.scrollportRef}>
      <Notice
        title={`${props.label} 无法在侧边栏内预览`}
        detail={[name, size].filter(Boolean).join(' · ')}
        hint={props.hint}
      />
    </Surface>
  )
}

const LEGACY_HINT =
  '旧版二进制 .doc、Rich Text、OpenDocument 与 EPUB 都没有浏览器渲染器。可以让模型把它转换成 .docx 或 Markdown，再从这个面板打开。'
const ARCHIVE_HINT = '压缩包需要解压后才能浏览内容。请下载文件，或用系统默认程序打开。'
const MEDIA_HINT = '这是音视频文件，预览面板不提供播放器。请下载后用系统播放器打开。'
const BINARY_HINT = '二进制文件不含可读文本，没有对应的浏览器渲染器。'

/* -------------------------------------------------------------- definitions */

const NS = 'dsh-office-preview'

const DEFINITIONS = [
  {
    id: `${NS}/docx`,
    label: 'Word 文档',
    extensions: ['docx', 'docm', 'dotx', 'dotm'],
    Body: DocxBody,
  },
  {
    id: `${NS}/xlsx`,
    label: 'Excel 表格',
    extensions: ['xlsx', 'xlsm', 'xltx', 'xltm', 'xls', 'xlsb'],
    Body: WorkbookBody,
  },
  {
    id: `${NS}/csv`,
    label: '分隔文本表格',
    extensions: ['csv', 'tsv', 'tab'],
    Body: CsvBody,
  },
  {
    id: `${NS}/pptx`,
    label: 'PowerPoint 演示文稿',
    extensions: ['pptx', 'pptm', 'potx', 'potm', 'ppsx'],
    Body: PptxBody,
  },
  {
    id: `${NS}/legacy-document`,
    label: '旧版或开放文档格式',
    extensions: ['doc', 'dot', 'rtf', 'odt', 'ott', 'ods', 'odp', 'odg', 'epub', 'pages', 'numbers', 'key'],
    hint: LEGACY_HINT,
    Body: UnsupportedBody,
  },
  {
    id: `${NS}/archive`,
    label: '压缩包',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'jar', 'apk', 'dmg', 'iso'],
    hint: ARCHIVE_HINT,
    Body: UnsupportedBody,
  },
  {
    id: `${NS}/media`,
    label: '音视频',
    extensions: [
      'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma',
      'mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', '3gp',
    ],
    hint: MEDIA_HINT,
    Body: UnsupportedBody,
  },
  {
    id: `${NS}/binary`,
    label: '二进制文件',
    extensions: [
      'exe', 'dll', 'so', 'dylib', 'bin', 'msi', 'deb', 'rpm', 'pkg', 'app',
      'ttf', 'otf', 'woff', 'woff2', 'eot', 'psd', 'ai', 'sketch', 'fig', 'blend',
      'sqlite', 'db', 'mdb', 'pyc', 'class', 'o', 'a', 'wasm',
    ],
    hint: BINARY_HINT,
    Body: UnsupportedBody,
  },
]

/* ------------------------------------------------------------------ styling */

const CSS = `
.dop-root { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.dop-bar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; min-height: 28px; box-sizing: border-box; border-bottom: 1px solid rgba(127,127,127,.22); font-size: 12px; color: var(--dsh-color-text-tertiary, #8a8a8a); }
.dop-bar-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dop-bar-meta { margin-left: auto; white-space: nowrap; }
.dop-tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: thin; }
.dop-tab { border: 0; background: transparent; color: inherit; font: inherit; padding: 3px 8px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
.dop-tab:hover { background: rgba(127,127,127,.14); }
.dop-tab-on { background: rgba(127,127,127,.2); font-weight: 600; }
.dop-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
.dop-body-flush { padding: 0; }
.dop-card { margin: 28px auto; max-width: 460px; padding: 0 20px; text-align: center; color: var(--dsh-color-text-secondary, #6b6b6b); }
.dop-card-icon { color: var(--dsh-color-text-tertiary, #9a9a9a); display: flex; justify-content: center; }
.dop-card-title { margin-top: 10px; font-size: 14px; font-weight: 600; color: var(--dsh-color-text, inherit); }
.dop-card-detail { margin-top: 6px; font-size: 12px; word-break: break-all; }
.dop-card-hint { margin-top: 10px; font-size: 12px; line-height: 1.65; }
.dop-docx-host { padding: 16px; }
/* docx-preview writes these as element styles, so the overrides need !important. */
.dop-docx-host .dop-docx-wrapper { background: transparent !important; padding: 0 !important; display: block !important; }
.dop-docx-host section.dop-docx { margin: 0 auto 16px !important; background: #fff; color: #000; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
.dop-docx-host section.dop-docx:last-child { margin-bottom: 0 !important; }
.dop-sheet { padding: 8px; }
.dop-grid { border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
.dop-grid td { border: 1px solid rgba(127,127,127,.28); padding: 2px 6px; vertical-align: top; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dop-grid-head td { font-weight: 600; background: rgba(127,127,127,.1); position: sticky; top: 0; z-index: 1; }
.dop-grid .dop-num { text-align: right; }
.dop-pptx-fit { padding: 12px; display: flex; justify-content: center; min-height: 0; }
.dop-pptx-stage { transform-origin: top center; }
/* The renderer fixes the wrapper to one slide box with its own scrollbar; the
   panel owns scrolling, so the wrapper must grow with its slide list instead. */
.dop-pptx-stage .pptx-preview-wrapper { height: auto !important; max-height: none !important; overflow: visible !important; }
`

function installStyles() {
  const id = 'dsh-office-preview-css'
  let tag = document.getElementById(id)
  if (!tag) {
    tag = document.createElement('style')
    tag.id = id
    tag.dataset.plugin = NS
    document.head.appendChild(tag)
  }
  tag.textContent = CSS
  return () => {
    try {
      tag.remove()
    } catch {
      /* the document may already be gone */
    }
  }
}

/* ---------------------------------------------------------------- lifecycle */

/**
 * Register the metadata and body of every renderer.
 * @param ctx - owning plugin context carrying `documentPreviews` and `slots`.
 * @param owned - collects every disposer produced by a successful pass.
 * @returns whether this call registered the renderers.
 */
function registerAll(ctx, owned) {
  let previews
  let slots
  try {
    previews = ctx.get('documentPreviews')
    slots = ctx.get('slots')
  } catch {
    return false
  }
  if (!previews || typeof previews.register !== 'function') return false
  if (!slots || typeof slots.inject !== 'function') return false

  const created = []
  try {
    for (const definition of DEFINITIONS) {
      const Body = definition.Body
      const Bound = (props) => <Body {...props} label={definition.label} hint={definition.hint} />
      created.push(
        previews.register({
          id: definition.id,
          extensions: definition.extensions,
          priority: 'extension',
          title: () => definition.label,
          loading: 'bytes-complete',
          wrap: false,
        }),
      )
      created.push(
        slots.inject('sidebar.right.tab.document', () =>
          slots.register({ name: 'sidebar.right.tab.document', key: definition.id }, Bound),
        ),
      )
    }
  } catch (error) {
    for (const disposer of created) {
      try {
        disposer()
      } catch {
        /* rollback is best-effort */
      }
    }
    console.warn('[dsh-office-preview] 渲染器注册失败：', (error && error.message) || error)
    return false
  }
  for (const disposer of created) owned.push(disposer)
  return true
}

export const name = NS
export const inject = []

export function apply(ctx) {
  const owned = []
  let registered = false
  let timer = null

  const attempt = () => {
    if (registered) return
    registered = registerAll(ctx, owned)
    if (registered && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  // The user may switch on more renderers at runtime, so this retries briefly
  // instead of failing once when the owning services are not composed yet.
  attempt()
  if (!registered) timer = setInterval(attempt, 200)

  const removeStyles = installStyles()

  ctx.effect(() => () => {
    if (timer) clearInterval(timer)
    for (let index = owned.length - 1; index >= 0; index -= 1) {
      try {
        owned[index]()
      } catch {
        /* a disposer that already ran is not an error */
      }
    }
    removeStyles()
  })
}

export const __test = { parseDelimited, guessDelimiter, extensionOf, basenameOf, formatSize, sheetGrid, DEFINITIONS }
