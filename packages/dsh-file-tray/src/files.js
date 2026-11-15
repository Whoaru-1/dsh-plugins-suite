/**
 * dsh-file-tray — pure produced-file reading and address helpers.
 *
 * No React, no cordis, no host imports: this module is the whole decision about
 * *which* files a conversation produced, how they are ordered and de-duplicated,
 * and how they are named when opened. The React half and the offline harness
 * both consume it, so the behaviour stays identical in both.
 *
 * The vocabulary comes from the official `deliverables` Conversation Location
 * data — successful `write`, `edit`, and mutating `str_replace_editor` calls,
 * exactly the same source the built-in "本轮文件改动" row reads — so the tray
 * counts a file once and only when a tool actually wrote it.
 */

/** Windows path prefixes, matching the workspace-path helper's own test. */
const WINDOWS_PATH = /^[A-Za-z]:[/\\]/

/**
 * Whether a path is absolute in either spelling the Host accepts.
 * @param path - a `\`- or `/`-separated path.
 * @returns `true` for POSIX, Windows-drive, and UNC absolute paths.
 */
export function isAbsolutePath(path) {
  return typeof path === 'string' && (path.startsWith('/') || WINDOWS_PATH.test(path) || path.startsWith('\\\\'))
}

/**
 * Rewrite one path to the `/`-separated spelling the UI shows and the address
 * builder expects.
 * @param path - absolute or workspace-relative path in either separator.
 * @returns the normalized path, or an empty string for a non-path.
 */
export function normalizePath(path) {
  if (typeof path !== 'string') return ''
  return path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
}

/**
 * The final path segment of a normalized path.
 * @param path - a `/`-separated path.
 * @returns the basename, or the whole string when it has no separator.
 */
export function basenameOf(path) {
  const normalized = normalizePath(path)
  const cut = normalized.lastIndexOf('/')
  return cut === -1 ? normalized : normalized.slice(cut + 1)
}

/**
 * The directory part of a normalized path, for a row's secondary line.
 * @param path - a `/`-separated path.
 * @returns the directory, `./` for a bare filename, and '' for an empty path.
 */
export function dirnameOf(path) {
  const normalized = normalizePath(path)
  if (normalized === '') return ''
  const cut = normalized.lastIndexOf('/')
  if (cut === -1) return './'
  return normalized.slice(0, cut + 1)
}

/**
 * Drop a workspace-root prefix so a stored absolute path shows and opens as a
 * workspace-relative one.
 * @param path - the stored path.
 * @param root - the Session's workspace root, when known.
 * @returns the workspace-relative path, or the normalized path when it lies outside the root.
 */
export function relativeToRoot(path, root) {
  const normalized = normalizePath(path)
  const base = normalizePath(root ?? '').replace(/\/+$/, '')
  if (base === '' || normalized === base) return normalized === base ? '' : normalized
  if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1)
  return normalized
}

/**
 * Build the `dsh-resource://file/…` address of one workspace file.
 *
 * Kept local rather than importing the workspace-path package so the bundle
 * stays self-contained and the grammar stays testable offline. The grammar is
 * the documented one: every id and path segment is component-encoded, while
 * `:` stays literal so a drive letter reads as written.
 * @param sessionId - the Session whose Host workspace resolves the path.
 * @param cwd - that Session's workspace root, when known.
 * @param path - absolute or workspace-relative file path.
 * @returns the resource address.
 */
export function fileAddressFor(sessionId, cwd, path) {
  const normalized = normalizePath(path)
  const relative = isAbsolutePath(normalized) ? relativeToRoot(normalized, cwd) : normalized
  return `dsh-resource://file/session/${encodeSegment(String(sessionId))}/${encodePath(relative)}`
}

/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/** Encode a `/`-separated path segment by segment. */
function encodePath(path) {
  return path.split('/').map(encodeSegment).join('/')
}

/**
 * Read one turn's official `deliverables` projection state.
 * @param turn - turn model carried by the turn-tail slot props.
 * @returns the projection state, or `undefined` when this turn has none.
 */
export function readDeliverables(turn) {
  const data = turn?.data
  if (data === undefined || data === null || typeof data.get !== 'function') return undefined
  const value = data.get('deliverables')
  return value === undefined || value === null ? undefined : value
}

/**
 * Collect the paths one closing turn produced, oldest first and de-duplicated.
 *
 * Mirrors the official window: a produced path counts up to and including the
 * closing seq, while a presented declaration counts strictly before it. A turn
 * that wrote nothing contributes nothing.
 * @param turn - turn model carried by the turn-tail slot props.
 * @param seq - closing assistant sequence, when known.
 * @returns produced paths in first-seen order.
 */
export function collectProduced(turn, seq) {
  const data = readDeliverables(turn)
  if (data === undefined) return []
  const limit = typeof seq === 'number' ? seq : Number.POSITIVE_INFINITY
  const seen = new Set()
  const out = []
  const consider = (path, at, strict) => {
    if (typeof path !== 'string') return
    const normalized = normalizePath(path)
    // A blank or whitespace-only path names nothing; a tool call that carried
    // one must not reach the tray.
    if (normalized === '' || normalized.trim() === '') return
    if (typeof at === 'number') {
      if (at > limit) return
      if (strict && at >= limit) return
    }
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }
  for (const item of Array.isArray(data.produced) ? data.produced : []) {
    consider(item?.path, item?.seq, false)
  }
  for (const item of Array.isArray(data.presented) ? data.presented : []) {
    consider(item?.path, item?.seq, true)
  }
  return out
}

/**
 * Coarse file kind used to pick a row icon.
 * @param path - the file path.
 * @returns one of `image`, `document`, `data`, `archive`, `code`, `other`.
 */
export function fileKindOf(path) {
  const name = basenameOf(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot + 1)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif', 'tiff', 'tif'].includes(extension)) return 'image'
  if (['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'markdown', 'ppt', 'pptx', 'key', 'pages'].includes(extension)) return 'document'
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods', 'json', 'jsonl', 'yaml', 'yml', 'xml'].includes(extension)) return 'data'
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar', 'op'].includes(extension)) return 'archive'
  if (
    [
      'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h',
      'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'html', 'htm', 'css', 'scss', 'less',
      'vue', 'svelte', 'toml', 'ini', 'cfg', 'conf',
    ].includes(extension)
  ) {
    return 'code'
  }
  return 'other'
}

/**
 * A short human label for one file kind.
 * @param kind - a {@link fileKindOf} result.
 * @returns the localized-ish label used as the row icon's accessible name.
 */
export function kindLabel(kind) {
  switch (kind) {
    case 'image':
      return '图片'
    case 'document':
      return '文档'
    case 'data':
      return '数据表'
    case 'archive':
      return '压缩包'
    case 'code':
      return '代码'
    default:
      return '文件'
  }
}
