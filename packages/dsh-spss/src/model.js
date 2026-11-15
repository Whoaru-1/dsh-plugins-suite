/**
 * dsh-spss — the domain model of the panel.
 *
 * Three things live here, none of them touching React:
 *
 *   1. The analysis catalogue: for each SPSS procedure the engine implements,
 *      how many variables it takes, which measure it accepts, and which extra
 *      options its row offers. The UI is built from this table, so adding a
 *      procedure is a one-entry change.
 *   2. Payload assembly: the dialog's state → the exact `POST /run` body.
 *   3. Defensive normalisation: the engine's result tables arrive as untrusted
 *      JSON, and one ragged row must never blank the whole slot.
 */

/** The six export formats the engine can produce, in display order. */
export const FORMATS = ['csv', 'xlsx', 'docx', 'png', 'json', 'sav']

/** Formats ticked when the panel first opens: a readable report and a table. */
export const DEFAULT_EXPORTS = ['docx', 'xlsx']

/**
 * `kind` — the shape of the variable picks:
 *   'list'  n or more variables
 *   'pair'  an even number of variables, taken two at a time
 *   'dep'   exactly one dependent variable plus one or more predictors
 * `measure` — which measure levels the picker offers.
 *   All SPSS procedures that average a variable need scale (numeric) data;
 *   crosstabs and frequencies accept anything.
 */
export const ANALYSIS_TYPES = [
  {
    type: 'freq',
    kind: 'list',
    min: 1,
    measure: 'any',
    options: ['order'],
  },
  {
    type: 'descriptives',
    kind: 'list',
    min: 1,
    measure: 'scale',
    options: [],
  },
  {
    type: 'crosstab',
    kind: 'list',
    min: 2,
    max: 2,
    measure: 'any',
    options: ['chiSquare'],
  },
  {
    type: 'ttest_one',
    kind: 'list',
    min: 1,
    measure: 'scale',
    options: ['testValue'],
  },
  {
    type: 'ttest_independent',
    kind: 'list',
    min: 2,
    max: 2,
    measure: 'scale',
    groupBy: true,
    options: ['equality'],
  },
  {
    type: 'paired_ttest',
    kind: 'pair',
    min: 2,
    measure: 'scale',
    options: ['pairsAuto'],
  },
  {
    type: 'anova',
    kind: 'list',
    min: 2,
    measure: 'scale',
    groupBy: true,
    options: ['posthoc'],
  },
  {
    type: 'corr',
    kind: 'list',
    min: 2,
    measure: 'scale',
    options: ['method'],
  },
  {
    type: 'regression',
    kind: 'dep',
    min: 1,
    measure: 'scale',
    options: ['intercept'],
  },
  {
    type: 'reliability',
    kind: 'list',
    min: 2,
    measure: 'scale',
    options: [],
  },
  {
    type: 'nonparametric',
    kind: 'list',
    min: 1,
    measure: 'any',
    options: ['test'],
  },
]

/** Look one procedure up by its engine name. */
export function analysisSpec(type) {
  return ANALYSIS_TYPES.find((entry) => entry.type === type) ?? ANALYSIS_TYPES[0]
}

/** Default option values for a freshly chosen procedure. */
export function defaultOptions(type) {
  switch (type) {
    case 'freq':
      return { order: 'desc' }
    case 'crosstab':
      return { chiSquare: true }
    case 'ttest_one':
      return { testValue: 0 }
    case 'ttest_independent':
      return { equality: 'auto' }
    case 'paired_ttest':
      return { pairsAuto: true }
    case 'anova':
      return { posthoc: 'none' }
    case 'corr':
      return { method: 'both' }
    case 'regression':
      return { intercept: true }
    case 'nonparametric':
      return { test: 'goodness_of_fit' }
    default:
      return {}
  }
}

/**
 * Which variables a picker may offer for a procedure.
 * @param spec - an entry of ANALYSIS_TYPES.
 * @param variables - the dataset variables (possibly empty).
 * @returns The offered variables, numeric first.
 */
export function offeredVariables(spec, variables) {
  const list = Array.isArray(variables) ? variables.filter(isVariable) : []
  if (spec?.measure !== 'scale') return list
  return list.filter((variable) => variable.measure === 'scale' || variable.type === 'numeric')
}

/** True when a value looks like one normalised variable descriptor. */
export function isVariable(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    value.name !== ''
  )
}

/** A one-line description of a variable, for a chip tooltip. */
export function variableTitle(variable) {
  if (!isVariable(variable)) return ''
  const parts = [variable.name]
  if (typeof variable.label === 'string' && variable.label !== '' && variable.label !== variable.name) {
    parts.push(variable.label)
  }
  if (typeof variable.type === 'string') parts.push(variable.type)
  if (typeof variable.measure === 'string') parts.push(variable.measure)
  return parts.join(' · ')
}

/** A measure label short enough for a chip. */
export function measureBadge(variable) {
  if (!isVariable(variable)) return ''
  if (variable.measure === 'nominal') return 'N'
  if (variable.measure === 'ordinal') return 'O'
  if (variable.measure === 'scale') return 'S'
  return variable.type === 'numeric' ? 'S' : '?'
}

/**
 * Normalise the `read-data` answer into the shape the page renders.
 * @returns `{ path, totalRows, shownRows, variables, rows }` — never throws.
 */
export function normalizeDataset(body) {
  const source = body !== null && typeof body === 'object' ? body : {}
  const variables = Array.isArray(source.variables) ? source.variables.filter(isVariable) : []
  const columns = Array.isArray(source.columns)
    ? source.columns.filter((name) => typeof name === 'string' && name !== '')
    : []
  const rows = Array.isArray(source.rows) ? source.rows.filter((row) => Array.isArray(row)) : []
  const totalRows = toCount(source.totalRows ?? source.rows ?? source.n, rows.length)
  return {
    path: typeof source.path === 'string' ? source.path : '',
    totalRows,
    shownRows: rows.length,
    columns: columns.length > 0 ? columns : variables.map((variable) => variable.name),
    variables: variables.length > 0 ? variables : columns.map(nameOnlyVariable),
    rows,
    log: Array.isArray(source.log) ? source.log.filter((line) => typeof line === 'string') : [],
    error: typeof source.error === 'string' ? source.error : null,
  }
}

/** Coerce an unknown count into a non-negative integer. */
function toCount(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

/** A bare variable descriptor for a name-only column. */
function nameOnlyVariable(name) {
  return { name, label: '', type: 'unknown', measure: 'unknown' }
}

/**
 * Did a variable list look numeric enough for a scale procedure? The engine
 * still decides for real; this only softens the picker.
 */
export function isNumericVariable(variable) {
  return isVariable(variable) && (variable.measure === 'scale' || variable.type === 'numeric')
}

/**
 * Build the engine payload for `POST /run`.
 *
 * The dialog is permissive — it offers a picker that filters, not one that
 * hides — so this is the single place that turns picks and options into the
 * engine's request shape, dropping anything empty rather than sending a
 * half-filled analysis.
 *
 * @param state - `{ inputPath, type, variables, groupBy, dependent, options,
 *                   exports, outDir, outBaseName }`.
 * @returns `{ payload, problems }` — problems are copy keys, empty when valid.
 */
export function buildRunPayload(state) {
  const problems = []
  const inputPath = typeof state?.inputPath === 'string' ? state.inputPath.trim() : ''
  if (inputPath === '') problems.push('run.noInput')

  const spec = analysisSpec(state?.type)
  const variables = cleanNames(state?.variables)
  const groupBy = typeof state?.groupBy === 'string' && state.groupBy !== '' ? state.groupBy : null
  const dependent =
    typeof state?.dependent === 'string' && state.dependent !== '' ? state.dependent : null
  const options = sanitizeOptions(spec, state?.options)

  let analysis = null
  if (spec.kind === 'dep') {
    if (dependent === null) {
      problems.push('analysis.needDependent')
    } else {
      const predictors = variables.filter((name) => name !== dependent)
      if (predictors.length < 1) {
        problems.push('analysis.needOne')
      } else {
        analysis = { type: spec.type, variables: predictors, options: { ...options, dependent } }
      }
    }
  } else {
    // A grouping variable is a second real column in the run, so it counts
    // toward the minimum: one ANOVA outcome plus one group is a valid split.
    const grouped = spec.groupBy === true && groupBy !== null
    const counted = grouped && !variables.includes(groupBy) ? variables.length + 1 : variables.length
    if (counted < spec.min) {
      problems.push('analysis.needOne')
    } else if (spec.groupBy === true && groupBy === null) {
      problems.push('analysis.needGroup')
    } else {
      analysis = { type: spec.type, variables }
      if (grouped) analysis.groupBy = groupBy
      if (Object.keys(options).length > 0) analysis.options = options
    }
  }

  if (analysis === null) problems.push('run.noAnalysis')

  const exports = cleanFormats(state?.exports)
  const outDir = typeof state?.outDir === 'string' ? state.outDir.trim() : ''
  // A run can be exploratory with no files written; only an explicit export
  // needs somewhere to go.
  if (exports.length > 0 && outDir === '') problems.push('run.noDir')

  return {
    payload: {
      inputPath,
      variables: allDataVariables(analysis),
      analyses: analysis === null ? [] : [analysis],
      exports,
      outDir,
      outBaseName: cleanStem(state?.outBaseName),
    },
    problems: unique(problems),
  }
}

/** Keep only non-empty strings, de-duplicated in order. */
function cleanNames(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const names = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/** Keep only known formats, in canonical order. */
export function cleanFormats(value) {
  if (!Array.isArray(value)) return []
  const wanted = new Set(value.filter((entry) => typeof entry === 'string'))
  return FORMATS.filter((format) => wanted.has(format))
}

/** The file stem, with the separators and extension the engine adds itself. */
export function cleanStem(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw === '') return ''
  // A stem may not contain a path separator or a NUL; strip anything that
  // would let a name escape the chosen folder.
  const cleaned = raw.replace(/[/\\\u0000]/g, '-').replace(/^\.+/, '').trim()
  return cleaned.slice(0, 120)
}

/** Drop empty option values so the engine sees only real choices. */
function sanitizeOptions(spec, values) {
  const source = values !== null && typeof values === 'object' ? values : {}
  const allowed = Array.isArray(spec?.options) ? spec.options : []
  const result = {}
  for (const key of allowed) {
    const value = source[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    result[key] = value
  }
  return result
}

/** Every data column the run needs to touch, for the engine's subset read. */
function allDataVariables(analysis) {
  if (analysis === null) return []
  const names = new Set(cleanNames(analysis.variables))
  if (typeof analysis.groupBy === 'string' && analysis.groupBy !== '') names.add(analysis.groupBy)
  if (analysis.options && typeof analysis.options.dependent === 'string') {
    names.add(analysis.options.dependent)
  }
  return [...names]
}

/** Preserve order while removing duplicates. */
function unique(list) {
  return [...new Set(list)]
}

/** Split a picked save path into the folder and the stem the engine wants. */
export function splitSavePath(path) {
  const raw = typeof path === 'string' ? path.trim() : ''
  if (raw === '') return { outDir: '', outBaseName: '' }
  const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  if (cut <= 0) return { outDir: '', outBaseName: cleanStem(raw) }
  const dir = raw.slice(0, cut) || '/'
  const base = raw.slice(cut + 1)
  const stem = cleanStem(base.replace(/\.[A-Za-z0-9]{1,8}$/, ''))
  return { outDir: dir, outBaseName: stem }
}

/** The files a run will produce, for the "will write" preview. */
export function previewOutputPaths({ outDir, outBaseName, exports }) {
  const formats = cleanFormats(exports)
  const dir = typeof outDir === 'string' ? outDir.trim().replace(/[/\\]+$/, '') : ''
  if (dir === '' || formats.length === 0) return []
  const stem = cleanStem(outBaseName) || 'result'
  return formats.map((format) => ({
    format,
    // Charts and tables are numbered by the engine; only the stem is predictable.
    path: `${dir}/${stem}.${format}`,
  }))
}

/**
 * Normalise one analysis result from the engine.
 *
 * A result with no usable tables is still an honest result: it is kept, and
 * the page shows the note in place of the table rather than a blank card.
 *
 * @returns `{ type, title, tables, note, error }`.
 */
export function normalizeAnalysis(raw, index) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const tables = Array.isArray(source.tables)
    ? source.tables.map((table, tableIndex) => normalizeTable(table, tableIndex)).filter(Boolean)
    : []
  return {
    type: typeof source.type === 'string' ? source.type : '',
    title:
      typeof source.title === 'string' && source.title !== ''
        ? source.title
        : typeof source.type === 'string'
          ? source.type
          : `#${index + 1}`,
    tables,
    note: typeof source.note === 'string' ? source.note : '',
    error: typeof source.error === 'string' ? source.error : '',
    // The engine names a generated chart file beside the analysis that drew it.
    chart: typeof source.chart === 'string' ? source.chart : '',
  }
}

/**
 * Normalise one table into `{ title, columns, rows }` with every row padded to
 * the header width. A header-less table gets positional column names.
 * @returns The table, or null when there is nothing to draw.
 */
export function normalizeTable(raw, index) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const columns = Array.isArray(source.columns)
    ? source.columns.map((name, columnIndex) =>
        name === null || name === undefined || String(name).trim() === ''
          ? `#${columnIndex + 1}`
          : String(name),
      )
    : []
  const rawRows = Array.isArray(source.rows) ? source.rows : []
  const width = columns.length > 0 ? columns.length : maxWidth(rawRows)
  if (width === 0) return null
  const header = columns.length > 0 ? columns : Array.from({ length: width }, (_, i) => `#${i + 1}`)
  const rows = rawRows.map((row) => {
    const cells = Array.isArray(row) ? row : [row]
    const padded = cells.slice(0, width).map(cellValue)
    while (padded.length < width) padded.push('')
    return padded
  })
  return {
    title:
      typeof source.title === 'string' && source.title !== ''
        ? source.title
        : columns.length > 0
          ? ''
          : `#${index + 1}`,
    columns: header,
    rows,
  }
}

/** The widest row an unknown-shaped table has. */
function maxWidth(rows) {
  let width = 0
  for (const row of rows) {
    if (Array.isArray(row)) width = Math.max(width, row.length)
    else width = Math.max(width, 1)
  }
  return width
}

/** Render one cell as display text; null becomes an em dash-free empty cell. */
export function cellValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    // Round the long floats the engine may hand back (6 sig figs requested,
    // but a stray 0.30000000000000004 must not reach the page).
    return String(Number(value.toPrecision(6)))
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Normalise one produced file from `POST /run`.
 * @returns `{ kind, path, label }` or null.
 */
export function normalizeOutput(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  if (typeof source.path !== 'string' || source.path === '') return null
  return {
    kind: typeof source.kind === 'string' ? source.kind : extensionOf(source.path),
    path: source.path,
    label: typeof source.label === 'string' && source.label !== '' ? source.label : fileNameOf(source.path),
  }
}

/** The trailing extension of a path, lowercased, without the dot. */
export function extensionOf(path) {
  const name = fileNameOf(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The last segment of a path, tolerating both separators. */
export function fileNameOf(path) {
  const raw = typeof path === 'string' ? path : ''
  const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  return cut >= 0 ? raw.slice(cut + 1) : raw
}

/** The folder part of a path, or '' when there is none. */
export function dirNameOf(path) {
  const raw = typeof path === 'string' ? path : ''
  const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  return cut > 0 ? raw.slice(0, cut) : ''
}

/**
 * Group the picker's variables by measure so the chips read as a scale sheet
 * rather than an alphabetical dump. Empty groups are omitted.
 */
export function groupVariables(variables) {
  const groups = [
    { measure: 'scale', label: 'scale', items: [] },
    { measure: 'ordinal', label: 'ordinal', items: [] },
    { measure: 'nominal', label: 'nominal', items: [] },
    { measure: 'unknown', label: 'unknown', items: [] },
  ]
  for (const variable of Array.isArray(variables) ? variables : []) {
    if (!isVariable(variable)) continue
    const measure =
      variable.measure === 'scale' || variable.measure === 'ordinal' || variable.measure === 'nominal'
        ? variable.measure
        : 'unknown'
    const group = groups.find((entry) => entry.measure === measure)
    if (group) group.items.push(variable)
  }
  return groups.filter((group) => group.items.length > 0)
}

/** Format a byte count for a file row. */
export function formatBytes(bytes) {
  const value = typeof bytes === 'number' ? bytes : Number(bytes)
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[index]}`
}

/** Format a millisecond timestamp as a short local date and time. */
export function formatTime(value) {
  const stamp = typeof value === 'number' ? value : Date.parse(String(value ?? ''))
  if (!Number.isFinite(stamp)) return ''
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Normalise the `GET /outputs` answer into the recent-files list. */
export function normalizeOutputs(body) {
  const source = body !== null && typeof body === 'object' ? body : {}
  const list = Array.isArray(source.outputs)
    ? source.outputs
    : Array.isArray(source.files)
      ? source.files
      : []
  const files = []
  for (const entry of list) {
    const raw = entry !== null && typeof entry === 'object' ? entry : null
    if (raw === null || typeof raw.path !== 'string' || raw.path === '') continue
    files.push({
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : fileNameOf(raw.path),
      path: raw.path,
      size: typeof raw.size === 'number' ? raw.size : Number(raw.size) || 0,
      mtime: typeof raw.mtime === 'number' ? raw.mtime : Date.parse(String(raw.mtime ?? '')) || 0,
      kind: typeof raw.kind === 'string' ? raw.kind : extensionOf(raw.path),
    })
  }
  files.sort((a, b) => b.mtime - a.mtime)
  return {
    dir: typeof source.dir === 'string' ? source.dir : typeof source.outputsDir === 'string' ? source.outputsDir : '',
    files,
  }
}
