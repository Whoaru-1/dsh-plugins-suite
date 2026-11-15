/**
 * dsh-spss — client half.
 *
 * Two registrations make the plugin visible in the Harness:
 *
 *   sidebar.panellist   the "SPSS 分析" row, id `spss`, order 26
 *   main                the analysis page, keyed by the same id
 *
 * The page is one long form in the order an analyst works: pick a data file,
 * choose an analysis and its variables, choose where the results go, run.
 * Every path the page shows — the data in and the results out — was chosen by
 * the person through a native dialog on the host machine; nothing is invented
 * here. A run without export formats is allowed and simply reports in the page.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { isChinese, makeT, resolveLocale } from './copy.js'
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  EmptyDataIcon,
  FileIcon,
  FolderIcon,
  PlayIcon,
  RefreshIcon,
  RevealIcon,
  StatsIcon,
  TableIcon,
} from './icons.js'
import {
  ANALYSIS_TYPES,
  DEFAULT_EXPORTS,
  FORMATS,
  analysisSpec,
  buildRunPayload,
  cleanStem,
  defaultOptions,
  formatBytes,
  formatTime,
  groupVariables,
  isNumericVariable,
  measureBadge,
  normalizeAnalysis,
  normalizeDataset,
  normalizeOutput,
  normalizeOutputs,
  offeredVariables,
  previewOutputPaths,
  splitSavePath,
  variableTitle,
} from './model.js'
import {
  describeError,
  fetchOutputs,
  fetchStatus,
  openPath,
  pickDirectory,
  pickPath,
  readData,
  runAnalysis,
} from './api.js'
import { installStyles } from './styles.js'

export const name = 'dsh-spss'
export const inject = ['slots']

/** The id shared by the sidebar row and the main-slot key. */
export const PANEL_ID = 'spss'

/** How many data rows the preview asks the host for. */
const PREVIEW_ROWS = 50

/** The filter offered to the native open dialog. */
const DATA_FILTERS = [
  { name: '数据文件', extensions: ['sav', 'csv', 'tsv', 'xlsx', 'xls'] },
  { name: 'SPSS', extensions: ['sav'] },
  { name: 'CSV', extensions: ['csv', 'tsv'] },
  { name: 'Excel', extensions: ['xlsx', 'xls'] },
  { name: 'All files', extensions: ['*'] },
]

/** The harness platform string, used only to word the "reveal" button. */
function isWindows() {
  try {
    return typeof navigator !== 'undefined' && /Win/i.test(navigator.platform ?? '')
  } catch {
    return false
  }
}

/** True when the host half says the native picker is unavailable. */
function isUnsupported(error) {
  return error?.unsupported === true || error?.code === 'unsupported'
}

/** True when the person closed the dialog; that is not an error to report. */
function isCancelled(error) {
  return error?.cancelled === true
}

/** The page: every section, in work order. */
export function SpssPage() {
  const t = useMemo(makeT, [])
  const locale = useMemo(resolveLocale, [])

  // ---- host status ------------------------------------------------------
  const [status, setStatus] = useState({ phase: 'idle', body: null, error: null })

  // ---- input ------------------------------------------------------------
  const [pathDraft, setPathDraft] = useState('')
  const [dataset, setDataset] = useState(null)
  const [load, setLoad] = useState({ phase: 'idle', error: null })
  const [picking, setPicking] = useState(false)
  const [sample, setSample] = useState({ phase: 'idle', error: null })

  // ---- analysis ---------------------------------------------------------
  const [type, setType] = useState('descriptives')
  const [picked, setPicked] = useState([])
  const [groupBy, setGroupBy] = useState('')
  const [dependent, setDependent] = useState('')
  const [options, setOptions] = useState(() => defaultOptions('descriptives'))
  const [numericOnly, setNumericOnly] = useState(false)

  // ---- output -----------------------------------------------------------
  const [exports, setExports] = useState(DEFAULT_EXPORTS)
  const [outDir, setOutDir] = useState('')
  const [stem, setStem] = useState('')

  // ---- run --------------------------------------------------------------
  const [run, setRun] = useState({ phase: 'idle', result: null, error: null })
  const [opening, setOpening] = useState(null)
  const [toast, setToast] = useState(null)

  // ---- recent -----------------------------------------------------------
  const [recent, setRecent] = useState({ phase: 'idle', dir: '', files: [], error: null })

  const mounted = useRef(true)
  const toastTimer = useRef(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    }
  }, [])

  /** Show one short toast; the next one replaces it. */
  const showToast = useCallback((message) => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    setToast({ message, key: Date.now() })
    toastTimer.current = setTimeout(() => {
      if (mounted.current) setToast(null)
      toastTimer.current = null
    }, 3200)
  }, [])

  /** Read the host status: python, engine, default output folder. */
  const refreshStatus = useCallback(async () => {
    setStatus((current) => ({ ...current, phase: 'loading', error: null }))
    try {
      const body = await fetchStatus()
      if (!mounted.current) return
      if (body.ok === false) {
        setStatus({ phase: 'error', body, error: describeError(body.error ?? body, t) })
        return
      }
      setStatus({ phase: 'ready', body, error: null })
      // The default output folder is a suggestion, never a substitute for a
      // choice: it is filled in only while the person has not picked one.
      const suggested = typeof body.outputsDir === 'string' ? body.outputsDir : ''
      if (suggested !== '') setOutDir((current) => (current === '' ? suggested : current))
      // The host suggests a dated stem (spss-YYYY-MM-DD); it only fills an
      // empty field, so a name the person typed is never overwritten.
      const suggestedStem = typeof body.defaultOutBaseName === 'string' ? body.defaultOutBaseName : ''
      if (suggestedStem !== '') setStem((current) => (current === '' ? cleanStem(suggestedStem) : current))
    } catch (error) {
      if (!mounted.current) return
      setStatus({ phase: 'error', body: null, error: describeError(error, t) })
    }
  }, [t])

  /** Read the recent-output list. */
  const refreshRecent = useCallback(async () => {
    setRecent((current) => ({ ...current, phase: 'loading' }))
    try {
      const body = await fetchOutputs()
      if (!mounted.current) return
      if (body.ok === false) {
        setRecent({ phase: 'error', dir: '', files: [], error: describeError(body.error ?? '', t) })
        return
      }
      const normalized = normalizeOutputs(body)
      setRecent({ phase: 'ready', dir: normalized.dir, files: normalized.files, error: null })
    } catch (error) {
      if (!mounted.current) return
      setRecent({ phase: 'error', dir: '', files: [], error: describeError(error, t) })
    }
  }, [t])

  useEffect(() => {
    void refreshStatus()
    void refreshRecent()
  }, [refreshStatus, refreshRecent])

  /**
   * Load one data file: variables plus a preview. The path is always taken
   * verbatim from the caller — the picker, the sample, or the typed field.
   */
  const loadDataset = useCallback(
    async (path) => {
      const target = typeof path === 'string' ? path.trim() : ''
      if (target === '') return
      setPathDraft(target)
      setLoad({ phase: 'loading', error: null })
      setDataset(null)
      try {
        const body = await readData({ path: target })
        if (!mounted.current) return
        if (body.ok === false || typeof body.error === 'string') {
          setLoad({ phase: 'error', error: describeError(body.error ?? body, t) })
          return
        }
        const next = normalizeDataset({ ...body, path: body.path ?? target })
        setDataset(next)
        setLoad({ phase: 'ready', error: null })
        // A fresh dataset invalidates every variable pick that came before it.
        setPicked([])
        setGroupBy('')
        setDependent('')
      } catch (error) {
        if (!mounted.current) return
        setLoad({ phase: 'error', error: describeError(error, t) })
      }
    },
    [t],
  )

  /** Choose the data file through the native dialog. */
  const chooseFile = useCallback(async () => {
    setPicking(true)
    try {
      const body = await pickPath({
        kind: 'open',
        title: isChinese() ? '选择数据文件' : 'Choose a data file',
        filters: DATA_FILTERS,
      })
      if (!mounted.current) return
      if (body.ok === true && typeof body.path === 'string' && body.path !== '') {
        await loadDataset(body.path)
        return
      }
      if (body.cancelled === true) return
      if (body.unsupported === true) {
        showToast(t('input.pickerUnsupported'))
        return
      }
      showToast(describeError(body.error ?? body, t))
    } catch (error) {
      if (!mounted.current) return
      if (isCancelled(error)) return
      if (isUnsupported(error)) {
        showToast(t('input.pickerUnsupported'))
        return
      }
      showToast(describeError(error, t))
    } finally {
      if (mounted.current) setPicking(false)
    }
  }, [loadDataset, showToast, t])

  /** Load the shipped demonstration dataset, if the engine ships one. */
  const loadSample = useCallback(async () => {
    setSample({ phase: 'loading', error: null })
    const enginePath = status.body?.enginePath
    if (typeof enginePath !== 'string' || enginePath === '') {
      setSample({ phase: 'error', error: t('input.sampleMissing') })
      return
    }
    const dir = enginePath.replace(/[\\/][^\\/]*$/, '')
    const samplePath = `${dir}/sample_data.csv`
    try {
      const body = await readData({ path: samplePath })
      if (!mounted.current) return
      if (body.ok === false || typeof body.error === 'string') {
        setSample({ phase: 'error', error: t('input.sampleMissing') })
        return
      }
      const next = normalizeDataset({ ...body, path: samplePath })
      setPathDraft(samplePath)
      setDataset(next)
      setLoad({ phase: 'ready', error: null })
      setSample({ phase: 'ready', error: null })
      setPicked([])
      setGroupBy('')
      setDependent('')
    } catch {
      if (!mounted.current) return
      setSample({ phase: 'error', error: t('input.sampleMissing') })
    }
  }, [status.body, t])

  /** Change the analysis type, resetting the picks that no longer apply. */
  const chooseType = useCallback((nextType) => {
    setType(nextType)
    setOptions(defaultOptions(nextType))
    setGroupBy('')
    setDependent('')
    setNumericOnly(false)
  }, [])

  /** Toggle one variable in the picker's selection. */
  const toggleVariable = useCallback((variableName) => {
    setPicked((current) =>
      current.includes(variableName)
        ? current.filter((entry) => entry !== variableName)
        : [...current, variableName],
    )
  }, [])

  /** Toggle one export format. */
  const toggleFormat = useCallback((format) => {
    setExports((current) =>
      current.includes(format) ? current.filter((entry) => entry !== format) : [...current, format],
    )
  }, [])

  /** Choose the output folder through the native dialog. */
  const chooseFolder = useCallback(async () => {
    setPicking(true)
    try {
      const body = await pickDirectory({
        title: isChinese() ? '选择结果输出文件夹' : 'Choose a folder for the results',
      })
      if (!mounted.current) return
      if (body.ok === true && typeof body.path === 'string' && body.path !== '') {
        setOutDir(body.path)
        return
      }
      if (body.cancelled === true) return
      if (body.unsupported === true) {
        showToast(t('input.pickerUnsupported'))
        return
      }
      showToast(describeError(body.error ?? body, t))
    } catch (error) {
      if (!mounted.current) return
      if (isCancelled(error)) return
      if (isUnsupported(error)) {
        showToast(t('input.pickerUnsupported'))
        return
      }
      showToast(describeError(error, t))
    } finally {
      if (mounted.current) setPicking(false)
    }
  }, [showToast, t])

  /** Choose the exact output file through the native save dialog. */
  const chooseSaveFile = useCallback(async () => {
    setPicking(true)
    try {
      const defaultName = cleanStem(stem) || 'result'
      const body = await pickPath({
        kind: 'save',
        title: isChinese() ? '选择结果保存位置' : 'Choose where to save the results',
        defaultName,
      })
      if (!mounted.current) return
      if (body.ok === true && typeof body.path === 'string' && body.path !== '') {
        const split = splitSavePath(body.path)
        if (split.outDir !== '') setOutDir(split.outDir)
        if (split.outBaseName !== '') setStem(split.outBaseName)
        return
      }
      if (body.cancelled === true) return
      if (body.unsupported === true) {
        showToast(t('input.pickerUnsupported'))
        return
      }
      showToast(describeError(body.error ?? body, t))
    } catch (error) {
      if (!mounted.current) return
      if (isCancelled(error)) return
      if (isUnsupported(error)) {
        showToast(t('input.pickerUnsupported'))
        return
      }
      showToast(describeError(error, t))
    } finally {
      if (mounted.current) setPicking(false)
    }
  }, [showToast, stem, t])

  /** Reveal one produced file in the OS file browser. */
  const reveal = useCallback(
    async (path) => {
      setOpening(path)
      try {
        const body = await openPath(path)
        if (!mounted.current) return
        if (body.ok === false) showToast(describeError(body.error ?? body, t))
      } catch (error) {
        if (mounted.current) showToast(describeError(error, t))
      } finally {
        if (mounted.current) setOpening(null)
      }
    },
    [showToast, t],
  )

  const spec = analysisSpec(type)
  const variables = dataset?.variables ?? []
  const planned = useMemo(
    () =>
      buildRunPayload({
        inputPath: pathDraft,
        type,
        variables: picked,
        groupBy,
        dependent,
        options,
        exports,
        outDir,
        outBaseName: stem,
      }),
    [pathDraft, type, picked, groupBy, dependent, options, exports, outDir, stem],
  )

  /** Run the analysis with the assembled payload. */
  const startRun = useCallback(async () => {
    if (planned.problems.length > 0) {
      showToast(t(planned.problems[0]))
      return
    }
    setRun({ phase: 'running', result: null, error: null })
    try {
      const body = await runAnalysis(planned.payload)
      if (!mounted.current) return
      if (body.ok === false) {
        setRun({
          phase: 'error',
          result: body,
          error: describeError(body.error ?? t('run.failed'), t),
        })
        return
      }
      const analyses = Array.isArray(body.analyses)
        ? body.analyses.map((entry, index) => normalizeAnalysis(entry, index))
        : []
      const outputs = Array.isArray(body.outputs)
        ? body.outputs.map(normalizeOutput).filter(Boolean)
        : []
      setRun({
        phase: 'done',
        result: {
          analyses,
          outputs,
          log: Array.isArray(body.log) ? body.log.filter((line) => typeof line === 'string') : [],
          dataset: body.dataset ?? null,
        },
        error: null,
      })
      void refreshRecent()
    } catch (error) {
      if (!mounted.current) return
      setRun({ phase: 'error', result: null, error: describeError(error, t) })
    }
  }, [planned, refreshRecent, showToast, t])

  const busy = run.phase === 'running'
  const pythonState = useMemo(() => describePython(status, t), [status, t])
  const canRun = planned.problems.length === 0 && !busy
  const willWrite = useMemo(
    () => previewOutputPaths({ outDir, outBaseName: stem, exports }),
    [outDir, stem, exports],
  )

  return (
    <section className="dsh-spss-page" aria-label={t('ariaPage')} data-locale={locale}>
      <div className="dsh-spss-scroll">
        <div className="dsh-spss-doc">
          <header className="dsh-spss-topbar">
            <div className="dsh-spss-heading">
              <h1>
                <StatsIcon size={22} strokeWidth={1.8} />
                {t('title')}
              </h1>
              <p className="dsh-spss-sub">{t('subtitle')}</p>
            </div>
            <div className="dsh-spss-tools">
              <span className="dsh-spss-chip" data-state={pythonState.state} title={pythonState.title}>
                {pythonState.label}
              </span>
              <button
                type="button"
                className="dsh-spss-icon-btn"
                title={t('refresh')}
                aria-label={t('refresh')}
                disabled={status.phase === 'loading'}
                onClick={() => {
                  void refreshStatus()
                  void refreshRecent()
                }}
              >
                <RefreshIcon size={15} className={status.phase === 'loading' ? 'dsh-spss-spin' : undefined} />
              </button>
            </div>
          </header>

          <InputSection
            t={t}
            status={status}
            pathDraft={pathDraft}
            onPathDraft={setPathDraft}
            dataset={dataset}
            load={load}
            sample={sample}
            picking={picking}
            onChooseFile={chooseFile}
            onLoad={() => void loadDataset(pathDraft)}
            onSample={() => void loadSample()}
          />

          <AnalysisSection
            t={t}
            spec={spec}
            type={type}
            onType={chooseType}
            variables={variables}
            picked={picked}
            onToggle={toggleVariable}
            onClear={() => setPicked([])}
            groupBy={groupBy}
            onGroupBy={setGroupBy}
            dependent={dependent}
            onDependent={setDependent}
            options={options}
            onOptions={setOptions}
            numericOnly={numericOnly}
            onNumericOnly={setNumericOnly}
            datasetReady={dataset !== null}
          />

          <OutputSection
            t={t}
            exports={exports}
            onToggleFormat={toggleFormat}
            outDir={outDir}
            onOutDir={setOutDir}
            stem={stem}
            onStem={setStem}
            onChooseFolder={chooseFolder}
            onChooseSaveFile={chooseSaveFile}
            picking={picking}
            willWrite={willWrite}
          />

          <div className="dsh-spss-runbar">
            <div
              className="dsh-spss-runbar-state"
              data-tone={run.phase === 'error' ? 'error' : 'normal'}
              aria-live="polite"
            >
              {busy ? (
                <>
                  <RefreshIcon size={14} className="dsh-spss-spin" />
                  {t('run.runningHint')}
                </>
              ) : run.phase === 'error' ? (
                <>
                  <AlertIcon size={14} />
                  {run.error}
                </>
              ) : run.phase === 'done' ? (
                <>
                  <CheckIcon size={14} />
                  {t('run.done')}
                </>
              ) : planned.problems.length === 0 ? (
                <>
                  <CheckIcon size={14} />
                  {t('analysis.ready')}
                </>
              ) : (
                t(planned.problems[0])
              )}
            </div>
            <button
              type="button"
              className="dsh-spss-btn dsh-spss-btn-primary dsh-spss-btn-lg"
              disabled={!canRun}
              onClick={() => void startRun()}
            >
              {busy ? <RefreshIcon size={15} className="dsh-spss-spin" /> : <PlayIcon size={14} />}
              {busy ? t('run.running') : t('run.start')}
            </button>
          </div>

          <ResultsSection t={t} run={run} opening={opening} onReveal={reveal} />

          <RecentSection
            t={t}
            recent={recent}
            opening={opening}
            onReveal={reveal}
            onRefresh={() => void refreshRecent()}
          />
        </div>
      </div>

      {toast !== null
        ? ReactDOM.createPortal(
            <div className="dsh-spss-toast" role="status" key={toast.key}>
              {toast.message}
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}

/** A worded summary of the host status chip. */
function describePython(status, t) {
  if (status.phase === 'loading' || status.phase === 'idle') {
    return { state: 'pending', label: t('status.checking'), title: '' }
  }
  if (status.phase === 'error' || status.body === null) {
    // The host itself is unreachable: the whole local service, not just python.
    return { state: 'error', label: t('status.blocked'), title: status.error ?? '' }
  }
  const body = status.body
  const python = body.python
  // Only an explicit object can vouch for the interpreter. A missing or
  // malformed `python` field is an unverified state, not a green light.
  if (python === null || typeof python !== 'object' || python.ok !== true) {
    if (python !== null && typeof python === 'object' && python.ok === false) {
      return {
        state: 'error',
        label: t('status.missing'),
        title: typeof python.error === 'string' ? python.error : typeof python.path === 'string' ? python.path : '',
      }
    }
    return { state: 'warn', label: t('status.unverified'), title: '' }
  }
  const version = typeof python?.version === 'string' && python.version !== '' ? python.version : ''
  return {
    state: 'ok',
    label: version === '' ? t('status.ok') : t('status.version', { version }),
    title: typeof python?.path === 'string' ? python.path : '',
  }
}

/** Section heading with its step number and the one-line explanation. */
function SectionHead({ step, title, note }) {
  return (
    <div className="dsh-spss-section-head">
      <span className="dsh-spss-step">{step}</span>
      <h2>{title}</h2>
      {note ? <span className="dsh-spss-section-note">{note}</span> : null}
    </div>
  )
}

/** Step 1 — choose and load the data file. */
function InputSection({ t, status, pathDraft, onPathDraft, dataset, load, sample, picking, onChooseFile, onLoad, onSample }) {
  const loading = load.phase === 'loading'
  // The host reports the engine file separately from python: `engineExists`
  // is false when engine/analyze.py is missing from the install.
  const engineMissing = status.body !== null && status.body.engineExists === false
  // `picker.available === false` means the native dialog is off by config or
  // because the host is headless; the path field is the only way in then.
  const pickerOff = status.body?.picker?.available === false
  const pickerHint = pickerOff
    ? typeof status.body?.picker?.hint === 'string'
      ? status.body.picker.hint
      : t('input.pickerUnsupported')
    : ''

  return (
    <section className="dsh-spss-section">
      <SectionHead step="1" title={t('section.input')} note={t('section.inputHint')} />
      <div className="dsh-spss-section-body">
        <div className="dsh-spss-field">
          <label className="dsh-spss-label" htmlFor="dsh-spss-path">
            {t('input.path')}
          </label>
          <div className="dsh-spss-row">
            <input
              id="dsh-spss-path"
              className="dsh-spss-input"
              data-mono="true"
              type="text"
              spellCheck={false}
              autoComplete="off"
              readOnly={loading}
              value={pathDraft}
              placeholder={t('input.pathPlaceholder')}
              onChange={(event) => onPathDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onLoad()
                }
              }}
            />
            <button
              type="button"
              className="dsh-spss-btn"
              disabled={picking || loading || pickerOff}
              title={pickerOff ? pickerHint : undefined}
              onClick={onChooseFile}
            >
              <FileIcon size={14} />
              {t('input.pickFile')}
            </button>
            <button
              type="button"
              className="dsh-spss-btn dsh-spss-btn-primary"
              disabled={pathDraft.trim() === '' || loading}
              onClick={onLoad}
            >
              {loading ? <RefreshIcon size={14} className="dsh-spss-spin" /> : <TableIcon size={14} />}
              {dataset === null ? t('input.load') : t('input.reload')}
            </button>
          </div>
          {engineMissing ? (
            <p className="dsh-spss-hint" data-tone="warn">
              <AlertIcon size={13} />
              {t('status.engineMissing')}
            </p>
          ) : null}
          {pickerOff ? (
            <p className="dsh-spss-hint" data-tone="warn">
              <AlertIcon size={13} />
              {pickerHint} {t('input.pickerUnsupported')}
            </p>
          ) : null}
        </div>

        {load.phase === 'error' ? (
          <div className="dsh-spss-banner" data-tone="error" role="alert">
            <AlertIcon size={14} />
            <p>{load.error}</p>
          </div>
        ) : null}

        {loading ? (
          <>
            <p className="dsh-spss-hint">{t('input.loading')}</p>
            <div className="dsh-spss-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </>
        ) : dataset === null ? (
          <div className="dsh-spss-empty">
            <span className="dsh-spss-empty-icon">
              <EmptyDataIcon size={40} />
            </span>
            <h3>{t('input.empty')}</h3>
            <p>{t('input.emptyBody')}</p>
            <div className="dsh-spss-empty-actions">
              <button type="button" className="dsh-spss-btn" onClick={onChooseFile} disabled={picking}>
                <FileIcon size={14} />
                {t('input.pickFile')}
              </button>
              <button
                type="button"
                className="dsh-spss-btn"
                disabled={sample.phase === 'loading'}
                onClick={onSample}
              >
                {sample.phase === 'loading' ? (
                  <RefreshIcon size={14} className="dsh-spss-spin" />
                ) : (
                  <TableIcon size={14} />
                )}
                {sample.phase === 'loading' ? t('input.sampleLoading') : t('input.sample')}
              </button>
            </div>
            {sample.phase === 'error' ? (
              <p className="dsh-spss-hint" data-tone="warn">
                <AlertIcon size={13} />
                {sample.error}
              </p>
            ) : null}
          </div>
        ) : (
          <DatasetSummary t={t} dataset={dataset} />
        )}
      </div>
    </section>
  )
}

/** The loaded dataset: counts, variable chips, and the first rows. */
function DatasetSummary({ t, dataset }) {
  const [showAll, setShowAll] = useState(false)
  const chips = showAll ? dataset.variables : dataset.variables.slice(0, 24)
  const hidden = dataset.variables.length - chips.length

  return (
    <div>
      <div className="dsh-spss-summary">
        <span className="dsh-spss-chip" data-state="ok">
          {t('input.summary', { rows: dataset.totalRows, columns: dataset.columns.length })}
        </span>
        <span className="dsh-spss-chip">{t('input.variablesCount', { count: dataset.variables.length })}</span>
      </div>

      <div className="dsh-spss-varchips" aria-label={t('input.variables')}>
        {chips.map((variable) => (
          <span className="dsh-spss-varchip" key={variable.name} title={variableTitle(variable)}>
            {variable.name}
            <em>{measureBadge(variable)}</em>
          </span>
        ))}
        {hidden > 0 ? (
          <button type="button" className="dsh-spss-varchip dsh-spss-btn-quiet" onClick={() => setShowAll(true)}>
            +{hidden}
          </button>
        ) : null}
      </div>

      {dataset.rows.length === 0 ? (
        <p className="dsh-spss-hint">{t('input.previewEmpty')}</p>
      ) : (
        <>
          <p className="dsh-spss-tabtitle">
            {t('input.preview', { count: dataset.rows.length, total: dataset.totalRows })}
          </p>
          <DataTable
            columns={dataset.columns}
            rows={dataset.rows}
            emptyLabel={t('table.empty')}
            unsupportedLabel={t('table.unsupported')}
          />
        </>
      )}
    </div>
  )
}

/** One sticky-headed table, tolerant of ragged or missing cells. */
function DataTable({ columns, rows, emptyLabel, unsupportedLabel, mono }) {
  const header = Array.isArray(columns) ? columns : []
  const body = Array.isArray(rows) ? rows : []
  if (header.length === 0) return <p className="dsh-spss-table-note">{unsupportedLabel}</p>
  return (
    <div className="dsh-spss-tablewrap">
      <table className="dsh-spss-table">
        <thead>
          <tr>
            {header.map((name, index) => (
              <th key={`${name}-${index}`} scope="col" data-sticky={index === 0 ? 'true' : 'false'}>
                {String(name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.length === 0 ? (
            <tr>
              <td colSpan={header.length} data-mono="true">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            body.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {header.map((name, columnIndex) => (
                  <td
                    key={`${rowIndex}-${columnIndex}`}
                    data-sticky={columnIndex === 0 ? 'true' : 'false'}
                    data-mono={mono && columnIndex === 0 ? 'true' : undefined}
                  >
                    {cellText(row, columnIndex)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

/** One cell as text, never throwing on an unexpected value. */
function cellText(row, index) {
  if (!Array.isArray(row)) return ''
  const value = row[index]
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/** Step 2 — choose the procedure and its variables. */
function AnalysisSection({
  t,
  spec,
  type,
  onType,
  variables,
  picked,
  onToggle,
  onClear,
  groupBy,
  onGroupBy,
  dependent,
  onDependent,
  options,
  onOptions,
  numericOnly,
  onNumericOnly,
  datasetReady,
}) {
  const offered = offeredVariables(spec, variables)
  const visible = numericOnly ? offered.filter(isNumericVariable) : offered
  const groups = groupVariables(visible)
  const maxed = typeof spec.max === 'number' && picked.length >= spec.max

  return (
    <section className="dsh-spss-section">
      <SectionHead step="2" title={t('section.analyses')} note={t('section.analysesHint')} />
      <div className="dsh-spss-section-body">
        <div className="dsh-spss-label">{t('analysis.type')}</div>
        <div className="dsh-spss-types" role="group" aria-label={t('analysis.type')}>
          {ANALYSIS_TYPES.map((entry) => (
            <button
              key={entry.type}
              type="button"
              className="dsh-spss-type"
              aria-pressed={entry.type === type}
              onClick={() => onType(entry.type)}
            >
              <span className="dsh-spss-type-name">
                <CheckIcon size={12} strokeWidth={2.3} />
                {t(`type.${entry.type}`)}
              </span>
              <span className="dsh-spss-type-desc">{t(`type.${entry.type}Desc`)}</span>
            </button>
          ))}
        </div>

        <div className="dsh-spss-field">
          <div className="dsh-spss-vars-head">
            <span className="dsh-spss-label" style={{ margin: 0 }}>
              {t('analysis.variables')}
            </span>
            <span className="dsh-spss-vars-meta">
              {picked.length > 0 ? t('analysis.selected', { count: picked.length }) : ''}
              {picked.length > 0 ? (
                <button type="button" className="dsh-spss-btn dsh-spss-btn-quiet" onClick={onClear}>
                  {t('analysis.clear')}
                </button>
              ) : null}
            </span>
          </div>

          {!datasetReady ? (
            <div className="dsh-spss-vars-empty">{t('analysis.pickFirst')}</div>
          ) : groups.length === 0 ? (
            <div className="dsh-spss-vars-empty">{t('analysis.pickFirst')}</div>
          ) : (
            <div className="dsh-spss-vargroups">
              {groups.map((group) => (
                <div key={group.measure}>
                  <div className="dsh-spss-vargroup-head">
                    {group.measure}
                    <span className="dsh-spss-vargroup-rule" aria-hidden="true" />
                  </div>
                  <div className="dsh-spss-varlist">
                    {group.items.map((variable) => {
                      const selected = picked.includes(variable.name)
                      return (
                        <button
                          key={variable.name}
                          type="button"
                          className="dsh-spss-var"
                          aria-pressed={selected}
                          disabled={!selected && maxed}
                          title={variableTitle(variable)}
                          onClick={() => onToggle(variable.name)}
                        >
                          <span className="dsh-spss-var-badge">{measureBadge(variable)}</span>
                          <span className="dsh-spss-var-name">{variable.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <OptionRow
            t={t}
            spec={spec}
            variables={variables}
            groupBy={groupBy}
            onGroupBy={onGroupBy}
            dependent={dependent}
            onDependent={onDependent}
            options={options}
            onOptions={onOptions}
            numericOnly={numericOnly}
            onNumericOnly={onNumericOnly}
          />
        </div>
      </div>
    </section>
  )
}

/** The controls a particular procedure needs beside its variable list. */
function OptionRow({
  t,
  spec,
  variables,
  groupBy,
  onGroupBy,
  dependent,
  onDependent,
  options,
  onOptions,
  numericOnly,
  onNumericOnly,
}) {
  const offered = offeredVariables(spec, variables)
  const has = (key) => spec.options.includes(key)
  const set = (key) => (value) => onOptions({ ...options, [key]: value })

  return (
    <div className="dsh-spss-options">
      {has('order') ? (
        <label className="dsh-spss-opt">
          <span className="dsh-spss-opt-label">{t('analysis.order')}</span>
          <select className="dsh-spss-select" value={options.order ?? 'desc'} onChange={(e) => set('order')(e.target.value)}>
            <option value="desc">{t('analysis.orderDesc')}</option>
            <option value="asc">{t('analysis.orderAsc')}</option>
            <option value="value">{t('analysis.orderValue')}</option>
          </select>
        </label>
      ) : null}

      {has('testValue') ? (
        <label className="dsh-spss-opt">
          <span className="dsh-spss-opt-label">{t('analysis.testValue')}</span>
          <input
            className="dsh-spss-input dsh-spss-num"
            type="number"
            step="any"
            value={options.testValue ?? 0}
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value)
              set('testValue')(Number.isFinite(parsed) ? parsed : 0)
            }}
          />
        </label>
      ) : null}

      {has('equality') ? (
        <label className="dsh-spss-opt">
          <span className="dsh-spss-opt-label">{t('analysis.equality')}</span>
          <select
            className="dsh-spss-select"
            value={options.equality ?? 'auto'}
            onChange={(e) => set('equality')(e.target.value)}
          >
            <option value="auto">{t('analysis.equalityAuto')}</option>
            <option value="equal">{t('analysis.equalityEqual')}</option>
            <option value="unequal">{t('analysis.equalityUnequal')}</option>
          </select>
        </label>
      ) : null}

      {has('posthoc') ? (
        <label className="dsh-spss-opt">
          <span className="dsh-spss-opt-label">{t('analysis.posthoc')}</span>
          <select
            className="dsh-spss-select"
            value={options.posthoc ?? 'none'}
            onChange={(e) => set('posthoc')(e.target.value)}
          >
            <option value="none">{t('analysis.posthocNone')}</option>
            <option value="tukey">{t('analysis.posthocTukey')}</option>
          </select>
        </label>
      ) : null}

      {has('method') ? (
        <label className="dsh-spss-opt">
          <span className="dsh-spss-opt-label">{t('analysis.stat')}</span>
          <select className="dsh-spss-select" value={options.method ?? 'both'} onChange={(e) => set('method')(e.target.value)}>
            <option value="both">Pearson + Spearman</option>
            <option value="pearson">Pearson</option>
            <option value="spearman">Spearman</option>
          </select>
        </label>
      ) : null}

      {has('test') ? (
        <label className="dsh-spss-opt">
          <span className="dsh-spss-opt-label">{t('analysis.test')}</span>
          <select
            className="dsh-spss-select"
            value={options.test ?? 'goodness_of_fit'}
            onChange={(e) => set('test')(e.target.value)}
          >
            <option value="goodness_of_fit">{t('analysis.testGof')}</option>
            <option value="mann_whitney">Mann-Whitney U</option>
            <option value="wilcoxon">{t('analysis.testWilcoxon')}</option>
          </select>
        </label>
      ) : null}

      {spec.groupBy === true ? (
        <label className="dsh-spss-opt">
          <span className="dsh-spss-opt-label">{t('analysis.groupBy')}</span>
          <select className="dsh-spss-select" value={groupBy} onChange={(e) => onGroupBy(e.target.value)}>
            <option value="">—</option>
            {variables.map((variable) => (
              <option key={variable.name} value={variable.name}>
                {variable.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {spec.kind === 'dep' ? (
        <label className="dsh-spss-opt">
          <span className="dsh-spss-opt-label">{t('analysis.dependent')}</span>
          <select className="dsh-spss-select" value={dependent} onChange={(e) => onDependent(e.target.value)}>
            <option value="">—</option>
            {offered.map((variable) => (
              <option key={variable.name} value={variable.name}>
                {variable.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {spec.measure === 'scale' ? (
        <label className="dsh-spss-check" data-checked={numericOnly ? 'true' : 'false'}>
          <input type="checkbox" checked={numericOnly} onChange={(e) => onNumericOnly(e.target.checked)} />
          <span className="dsh-spss-tick" aria-hidden="true">
            <CheckIcon size={10} strokeWidth={2.6} />
          </span>
          {t('analysis.filterNumeric')}
        </label>
      ) : null}
    </div>
  )
}

/** Step 3 — formats and the chosen destination. */
function OutputSection({ t, exports, onToggleFormat, outDir, onOutDir, stem, onStem, onChooseFolder, onChooseSaveFile, picking, willWrite }) {
  return (
    <section className="dsh-spss-section">
      <SectionHead step="3" title={t('section.output')} note={t('section.outputHint')} />
      <div className="dsh-spss-section-body">
        <div className="dsh-spss-label">{t('output.formats')}</div>
        <div className="dsh-spss-checks">
          {FORMATS.map((format) => {
            const checked = exports.includes(format)
            return (
              <label
                key={format}
                className="dsh-spss-check"
                data-checked={checked ? 'true' : 'false'}
                data-disabled={picking ? 'true' : 'false'}
              >
                <input type="checkbox" checked={checked} onChange={() => onToggleFormat(format)} />
                <span className="dsh-spss-tick" aria-hidden="true">
                  <CheckIcon size={10} strokeWidth={2.6} />
                </span>
                {t(`format.${format}`)}
              </label>
            )
          })}
        </div>
        {exports.length === 0 ? <p className="dsh-spss-hint">{t('output.noFormats')}</p> : null}

        <div className="dsh-spss-field">
          <label className="dsh-spss-label" htmlFor="dsh-spss-outdir">
            {t('output.dir')}
          </label>
          <div className="dsh-spss-row">
            <input
              id="dsh-spss-outdir"
              className="dsh-spss-input"
              data-mono="true"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={outDir}
              placeholder={t('output.dirPlaceholder')}
              onChange={(event) => onOutDir(event.target.value)}
            />
            <button type="button" className="dsh-spss-btn" disabled={picking} onClick={onChooseFolder}>
              <FolderIcon size={14} />
              {t('output.dirPick')}
            </button>
            <button type="button" className="dsh-spss-btn" disabled={picking} onClick={onChooseSaveFile}>
              <FileIcon size={14} />
              {t('output.saveAs')}
            </button>
          </div>
        </div>

        <div className="dsh-spss-field">
          <label className="dsh-spss-label" htmlFor="dsh-spss-stem">
            {t('output.stem')}
          </label>
          <input
            id="dsh-spss-stem"
            className="dsh-spss-input dsh-spss-num"
            style={{ width: 220 }}
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={stem}
            placeholder={t('output.stemPlaceholder')}
            onChange={(event) => onStem(event.target.value)}
          />
          <p className="dsh-spss-hint">{t('output.stemHint')}</p>
        </div>

        {willWrite.length > 0 ? (
          <div className="dsh-spss-field">
            <span className="dsh-spss-label">{t('output.willWrite')}</span>
            <div className="dsh-spss-willwrite">
              {willWrite.map((item) => (
                <code key={item.format}>{item.path}</code>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** Step 4 — the run's analyses, tables, and files. */
function ResultsSection({ t, run, opening, onReveal }) {
  const win = useMemo(isWindows, [])
  if (run.phase === 'idle') return null
  if (run.phase === 'running') {
    return (
      <section className="dsh-spss-section">
        <SectionHead step="4" title={t('section.results')} note={t('section.resultsHint')} />
        <div className="dsh-spss-section-body">
          <p className="dsh-spss-hint">{t('run.runningHint')}</p>
          <div className="dsh-spss-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>
    )
  }
  if (run.phase === 'error') {
    return (
      <section className="dsh-spss-section">
        <SectionHead step="4" title={t('section.results')} note={t('run.failed')} />
        <div className="dsh-spss-section-body">
          <div className="dsh-spss-banner" data-tone="error" role="alert">
            <AlertIcon size={14} />
            <p>{run.error}</p>
          </div>
          {run.result && typeof run.result.traceback === 'string' && run.result.traceback !== '' ? (
            <details className="dsh-spss-details">
              <summary>
                <ChevronIcon size={12} />
                traceback
              </summary>
              <pre className="dsh-spss-log">{run.result.traceback}</pre>
            </details>
          ) : null}
        </div>
      </section>
    )
  }

  const result = run.result
  const analyses = result?.analyses ?? []
  const outputs = result?.outputs ?? []
  const log = result?.log ?? []

  return (
    <section className="dsh-spss-section">
      <SectionHead step="4" title={t('section.results')} note={t('section.resultsHint')} />
      <div className="dsh-spss-section-body">
        {analyses.length === 0 ? (
          <p className="dsh-spss-hint">{t('table.empty')}</p>
        ) : (
          analyses.map((analysis, index) => (
            <AnalysisCard key={`${analysis.type}-${index}`} t={t} analysis={analysis} />
          ))
        )}

        <div className="dsh-spss-field">
          <span className="dsh-spss-label">{t('output.produced')}</span>
          {outputs.length === 0 ? (
            <p className="dsh-spss-hint">{t('output.none')}</p>
          ) : (
            <ul className="dsh-spss-files">
              {outputs.map((file) => (
                <OutputFile
                  key={file.path}
                  file={file}
                  win={win}
                  t={t}
                  opening={opening === file.path}
                  onReveal={() => onReveal(file.path)}
                />
              ))}
            </ul>
          )}
        </div>

        {log.length > 0 ? (
          <details className="dsh-spss-details">
            <summary>
              <ChevronIcon size={12} />
              {t('log.title')}
            </summary>
            <pre className="dsh-spss-log">{log.join('\n')}</pre>
          </details>
        ) : null}
      </div>
    </section>
  )
}

/** One analysis result: its tables, note, and optional chart. */
function AnalysisCard({ t, analysis }) {
  const hasContent = analysis.tables.length > 0 || analysis.note !== '' || analysis.error !== ''
  return (
    <article className="dsh-spss-analysis">
      <div className="dsh-spss-analysis-head">
        <h3>{analysis.title}</h3>
        {analysis.type !== '' ? <span className="dsh-spss-analysis-type">{analysis.type}</span> : null}
      </div>

      {analysis.tables.map((table, index) => (
        <div key={index}>
          {table.title !== '' ? <p className="dsh-spss-tabtitle">{table.title}</p> : null}
          <DataTable
            columns={table.columns}
            rows={table.rows}
            emptyLabel={t('table.empty')}
            unsupportedLabel={t('table.unsupported')}
          />
        </div>
      ))}

      {analysis.error !== '' ? (
        <p className="dsh-spss-analysis-note" data-tone="error">
          {analysis.error}
        </p>
      ) : null}

      {analysis.note !== '' ? <p className="dsh-spss-analysis-note">{analysis.note}</p> : null}

      {analysis.chart !== '' ? (
        <p className="dsh-spss-table-note">
          <TableIcon size={12} /> {analysis.chart}
        </p>
      ) : null}

      {!hasContent && analysis.chart === '' ? (
        <p className="dsh-spss-analysis-note">{t('table.empty')}</p>
      ) : null}
    </article>
  )
}

/** One produced file with a reveal button and its full path. */
function OutputFile({ file, win, t, opening, onReveal }) {
  return (
    <li className="dsh-spss-file">
      <span className="dsh-spss-file-kind">{file.kind || 'file'}</span>
      <span className="dsh-spss-file-main">
        <span className="dsh-spss-file-name" title={file.label}>
          {file.label}
        </span>
        <span className="dsh-spss-file-path" title={file.path}>
          {file.path}
        </span>
      </span>
      <button type="button" className="dsh-spss-btn" disabled={opening} onClick={onReveal}>
        {opening ? <RefreshIcon size={13} className="dsh-spss-spin" /> : <RevealIcon size={13} />}
        {opening ? t('output.opening') : win ? t('output.openInFinderWin') : t('output.openInFinder')}
      </button>
    </li>
  )
}

/** The default output folder's recent files. */
function RecentSection({ t, recent, opening, onReveal, onRefresh }) {
  const win = useMemo(isWindows, [])
  const files = recent.files.slice(0, 12)
  return (
    <section className="dsh-spss-section">
      <div className="dsh-spss-section-body">
        <div className="dsh-spss-recent-head">
          <div className="dsh-spss-row">
            <ClockIcon size={15} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{t('recent.title')}</h2>
            {recent.phase === 'ready' ? (
              <span className="dsh-spss-vars-meta">{t('recent.dir', { count: recent.files.length })}</span>
            ) : null}
          </div>
          <button
            type="button"
            className="dsh-spss-icon-btn"
            title={t('recent.refresh')}
            aria-label={t('recent.refresh')}
            disabled={recent.phase === 'loading'}
            onClick={onRefresh}
          >
            <RefreshIcon size={14} className={recent.phase === 'loading' ? 'dsh-spss-spin' : undefined} />
          </button>
        </div>
        {recent.dir !== '' ? <p className="dsh-spss-recent-dir">{recent.dir}</p> : null}

        {recent.phase === 'error' ? (
          <div className="dsh-spss-banner" data-tone="error">
            <AlertIcon size={14} />
            <p>{recent.error}</p>
          </div>
        ) : files.length === 0 ? (
          <p className="dsh-spss-hint">{recent.phase === 'loading' ? t('recent.loading') : t('recent.empty')}</p>
        ) : (
          <ul className="dsh-spss-files">
            {files.map((file) => (
              <li className="dsh-spss-file" key={file.path}>
                <span className="dsh-spss-file-kind">{file.kind || 'file'}</span>
                <span className="dsh-spss-file-main">
                  <span className="dsh-spss-file-name" title={file.path}>
                    {file.name}
                  </span>
                  <span className="dsh-spss-file-path" title={file.path}>
                    {formatTime(file.mtime)}
                    {file.size > 0 ? ` · ${formatBytes(file.size)}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="dsh-spss-icon-btn"
                  title={win ? t('output.openInFinderWin') : t('output.openInFinder')}
                  aria-label={win ? t('output.openInFinderWin') : t('output.openInFinder')}
                  disabled={opening === file.path}
                  onClick={() => onReveal(file.path)}
                >
                  <RevealIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** The sidebar mark: the statistics glyph, heavier when the row is active. */
function SpssPanelIcon({ size, active }) {
  return <StatsIcon size={size ?? 17} strokeWidth={active ? 2.05 : 1.7} />
}

/** Mount the sidebar row and the page. */
export function apply(ctx) {
  ctx.effect(() => installStyles(), 'dsh-spss: styles')

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 26,
        label: () => makeT()('panel'),
      },
      SpssPanelIcon,
    ),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
      },
      SpssPage,
    ),
  )
}

/** Offline harness surface; the loader reads only `name`, `inject`, `apply`. */
export const __test = { SpssPage, SpssPanelIcon, DataTable, PANEL_ID }
