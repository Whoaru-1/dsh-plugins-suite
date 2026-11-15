/**
 * dsh-spss — copy and language resolution.
 *
 * Chinese is the default, as the panel is written for Chinese-speaking
 * analysts first. The language is resolved once, at module load, from the
 * document language, then the harness locale, then the browser language.
 *
 * Keys are flat and dotted (`input.title`); every key must exist in both
 * tables so a language switch can never leave a blank label behind. The panel
 * renders `String` values only — a missing key falls back to its own name,
 * which is visible in review but never throws.
 */

const zh = {
  panel: 'SPSS 分析',

  'title': 'SPSS 统计分析',
  'subtitle': '选择本机数据文件，挑选分析方法，把结果写到你指定的位置。',
  'refresh': '刷新',
  'ariaPage': 'SPSS 统计分析',

  'status.checking': '正在检测 Python…',
  'status.ok': 'Python 就绪',
  'status.missing': '未找到 Python',
  'status.unverified': 'Python 状态未知',
  'status.blocked': '本机服务不可用',
  'status.version': 'Python {version}',
  'status.engineMissing': '引擎文件缺失',

  'section.input': '输入',
  'section.inputHint': '数据文件可以是 SPSS .sav、CSV / TSV，或 Excel 工作簿。',
  'section.analyses': '分析方法',
  'section.analysesHint': '先选分析类型，再从数据变量里挑字段。',
  'section.output': '输出',
  'section.outputHint': '勾选要生成的文件格式，并指定保存位置。',
  'section.results': '分析结果',
  'section.resultsHint': '结果在本页展示，同时写入你选择的位置。',
  'section.recent': '最近输出',

  'input.path': '数据文件',
  'input.pathPlaceholder': '点击「选择文件…」，或直接粘贴路径',
  'input.pickFile': '选择文件…',
  'input.load': '载入数据',
  'input.reload': '重新载入',
  'input.loading': '正在读取数据…',
  'input.empty': '还没有载入数据文件',
  'input.emptyBody': '点「选择文件…」打开系统的文件选择窗口，从这台电脑上挑一个数据文件。',
  'input.sample': '载入示例数据',
  'input.sampleLoading': '正在载入示例…',
  'input.sampleMissing': '没找到示例数据文件（engine/sample_data.csv）。可以直接选择一个你自己的文件。',
  'input.summary': '{rows} 行 · {columns} 列',
  'input.variables': '变量',
  'input.variablesCount': '{count} 个变量',
  'input.preview': '数据预览（前 {count} 行，共 {total} 行）',
  'input.previewEmpty': '文件里没有可预览的行。',
  'input.pickerUnsupported': '这台电脑上无法打开系统文件窗口，请在输入框里填写完整路径。',

  'analysis.type': '分析类型',
  'analysis.variables': '选择变量',
  'analysis.groupBy': '分组变量',
  'analysis.dependent': '因变量',
  'analysis.pickFirst': '先在「输入」里载入一个数据文件，变量会出现在这里。',
  'analysis.filterNumeric': '只看数值型',
  'analysis.selected': '已选 {count} 个',
  'analysis.clear': '清空',
  'analysis.needOne': '这个分析还需要至少 {count} 个变量。',
  'analysis.needGroup': '这个分析还需要指定分组变量。',
  'analysis.needDependent': '请选择一个因变量。',
  'analysis.test': '检验类型',
  'analysis.stat': '统计量',
  'analysis.posthoc': '事后检验',
  'analysis.posthocNone': '不做',
  'analysis.posthocTukey': 'Tukey HSD',
  'analysis.order': '排序方式',
  'analysis.orderDesc': '计数从多到少',
  'analysis.orderAsc': '计数从少到多',
  'analysis.orderValue': '按取值排列',
  'analysis.testValue': '检验值',
  'analysis.equality': '方差齐性',
  'analysis.equalityAuto': '按 Levene 检验自动选择',
  'analysis.equalityEqual': '假设方差齐',
  'analysis.equalityUnequal': '不假设方差齐（Welch）',
  'analysis.testGof': '卡方拟合优度',
  'analysis.testWilcoxon': 'Wilcoxon 符号秩',
  'analysis.ready': '准备就绪，可以开始分析。',

  'output.formats': '导出格式',
  'output.noFormats': '未勾选任何格式：结果只在本页显示，不会写入文件。',
  'output.dir': '输出目录',
  'output.dirPlaceholder': '点击「选择文件夹…」或「选择保存文件…」',
  'output.dirPick': '选择文件夹…',
  'output.saveAs': '选择保存文件…',
  'output.stem': '文件名',
  'output.stemPlaceholder': 'result',
  'output.stemHint': '生成文件会以这个名称加扩展名保存，例如 result.docx。',
  'output.willWrite': '将写入',
  'output.openInFinder': '在 Finder 中显示',
  'output.openInFinderWin': '在资源管理器中显示',
  'output.opening': '正在打开…',
  'output.produced': '生成的文件',
  'output.none': '这次没有生成文件（未勾选导出格式）。',

  'format.csv': 'CSV 表格',
  'format.xlsx': 'Excel 工作簿',
  'format.docx': 'Word 报告',
  'format.png': '图表 PNG',
  'format.json': '结果 JSON',
  'format.sav': 'SPSS 数据 .sav',

  'type.freq': '频数分析',
  'type.freqDesc': '每个取值的计数与百分比',
  'type.descriptives': '描述统计',
  'type.descriptivesDesc': '均值、标准差、偏度、峰度',
  'type.crosstab': '交叉表',
  'type.crosstabDesc': '两变量列联表与卡方检验',
  'type.ttest_one': '单样本 T 检验',
  'type.ttest_oneDesc': '均值与检验值比较',
  'type.ttest_independent': '独立样本 T 检验',
  'type.ttest_independentDesc': '两组均值比较',
  'type.paired_ttest': '配对样本 T 检验',
  'type.paired_ttestDesc': '同一组对象前后比较',
  'type.anova': '单因素方差分析',
  'type.anovaDesc': '三组以上均值比较',
  'type.corr': '相关分析',
  'type.corrDesc': 'Pearson 与 Spearman 相关',
  'type.regression': '线性回归',
  'type.regressionDesc': '用一个或多个变量预测因变量',
  'type.reliability': '信度分析',
  'type.reliabilityDesc': 'Cronbach α 与项目统计',
  'type.nonparametric': '非参数检验',
  'type.nonparametricDesc': '拟合优度、Mann-Whitney、Wilcoxon',

  'run.start': '开始分析',
  'run.running': '正在分析…',
  'run.runningHint': '正在这台电脑上运行统计引擎，稍等片刻。',
  'run.done': '分析完成',
  'run.failed': '分析失败',
  'run.noInput': '请先选择一个数据文件。',
  'run.noAnalysis': '请选择至少一个分析类型。',
  'run.noDir': '请为结果选择一个输出位置（文件夹或文件）。',

  'recent.title': '最近输出',
  'recent.loading': '正在读取…',
  'recent.empty': '这里还没有输出文件。分析完成后，结果会出现在这里。',
  'recent.dir': '{count} 个文件',
  'recent.refresh': '刷新列表',

  'error.title': '出错了',
  'error.network': '无法连接到本机服务，请确认 Harness 仍在运行。',

  'log.title': '运行日志',
  'table.empty': '（无数据）',
  'table.unsupported': '这个表格的格式无法显示。',

}

const en = {
  panel: 'SPSS Analysis',

  'title': 'SPSS Statistical Analysis',
  'subtitle': 'Pick a data file on this machine, choose the analysis, and write the results where you want them.',
  'refresh': 'Refresh',
  'ariaPage': 'SPSS statistical analysis',

  'status.checking': 'Checking Python…',
  'status.ok': 'Python ready',
  'status.missing': 'Python not found',
  'status.unverified': 'Python status unknown',
  'status.blocked': 'Local service unavailable',
  'status.version': 'Python {version}',
  'status.engineMissing': 'Engine missing',

  'section.input': 'Input',
  'section.inputHint': 'SPSS .sav, CSV / TSV, or an Excel workbook.',
  'section.analyses': 'Analysis',
  'section.analysesHint': 'Choose an analysis first, then pick its variables.',
  'section.output': 'Output',
  'section.outputHint': 'Tick the formats to produce, then choose where they go.',
  'section.results': 'Results',
  'section.resultsHint': 'Results appear here and are written to the location you chose.',
  'section.recent': 'Recent output',

  'input.path': 'Data file',
  'input.pathPlaceholder': 'Use “Choose file…”, or paste a full path',
  'input.pickFile': 'Choose file…',
  'input.load': 'Load data',
  'input.reload': 'Reload',
  'input.loading': 'Reading the data…',
  'input.empty': 'No data file loaded',
  'input.emptyBody': 'Choose a file to open the native file dialog and pick a data file from this computer.',
  'input.sample': 'Load sample data',
  'input.sampleLoading': 'Loading the sample…',
  'input.sampleMissing': 'The sample file (engine/sample_data.csv) is not installed. Choose one of your own files instead.',
  'input.summary': '{rows} rows · {columns} columns',
  'input.variables': 'Variables',
  'input.variablesCount': '{count} variables',
  'input.preview': 'Data preview (first {count} of {total} rows)',
  'input.previewEmpty': 'This file has no rows to preview.',
  'input.pickerUnsupported': 'The native file dialog is not available here. Type the full path instead.',

  'analysis.type': 'Analysis type',
  'analysis.variables': 'Variables',
  'analysis.groupBy': 'Grouping variable',
  'analysis.dependent': 'Dependent variable',
  'analysis.pickFirst': 'Load a data file under Input and its variables will appear here.',
  'analysis.filterNumeric': 'Numeric only',
  'analysis.selected': '{count} selected',
  'analysis.clear': 'Clear',
  'analysis.needOne': 'This analysis needs at least {count} variable(s).',
  'analysis.needGroup': 'This analysis also needs a grouping variable.',
  'analysis.needDependent': 'Choose a dependent variable.',
  'analysis.test': 'Test',
  'analysis.stat': 'Statistic',
  'analysis.posthoc': 'Post-hoc',
  'analysis.posthocNone': 'None',
  'analysis.posthocTukey': 'Tukey HSD',
  'analysis.order': 'Order',
  'analysis.orderDesc': 'Most frequent first',
  'analysis.orderAsc': 'Least frequent first',
  'analysis.orderValue': 'By value',
  'analysis.testValue': 'Test value',
  'analysis.equality': 'Variances',
  'analysis.equalityAuto': 'Choose by Levene’s test',
  'analysis.equalityEqual': 'Assume equal variances',
  'analysis.equalityUnequal': 'Unequal variances (Welch)',
  'analysis.testGof': 'Chi-square goodness of fit',
  'analysis.testWilcoxon': 'Wilcoxon signed rank',
  'analysis.ready': 'Ready to analyse.',

  'output.formats': 'Formats',
  'output.noFormats': 'No formats ticked: results stay on this page and no file is written.',
  'output.dir': 'Output folder',
  'output.dirPlaceholder': 'Use “Choose folder…” or “Choose file name…”',
  'output.dirPick': 'Choose folder…',
  'output.saveAs': 'Choose file name…',
  'output.stem': 'File name',
  'output.stemPlaceholder': 'result',
  'output.stemHint': 'Files are saved under this name plus an extension, e.g. result.docx.',
  'output.willWrite': 'Will write',
  'output.openInFinder': 'Show in Finder',
  'output.openInFinderWin': 'Show in Explorer',
  'output.opening': 'Opening…',
  'output.produced': 'Files produced',
  'output.none': 'No files were written (no export format ticked).',

  'format.csv': 'CSV table',
  'format.xlsx': 'Excel workbook',
  'format.docx': 'Word report',
  'format.png': 'Chart PNG',
  'format.json': 'Result JSON',
  'format.sav': 'SPSS data .sav',

  'type.freq': 'Frequencies',
  'type.freqDesc': 'Counts and percentages per value',
  'type.descriptives': 'Descriptives',
  'type.descriptivesDesc': 'Mean, SD, skewness, kurtosis',
  'type.crosstab': 'Crosstabs',
  'type.crosstabDesc': 'Two-way table with chi-square',
  'type.ttest_one': 'One-Sample T Test',
  'type.ttest_oneDesc': 'Compare a mean to a test value',
  'type.ttest_independent': 'Independent-Samples T',
  'type.ttest_independentDesc': 'Compare two group means',
  'type.paired_ttest': 'Paired-Samples T',
  'type.paired_ttestDesc': 'Before and after, same subjects',
  'type.anova': 'One-Way ANOVA',
  'type.anovaDesc': 'Compare three or more means',
  'type.corr': 'Correlations',
  'type.corrDesc': 'Pearson and Spearman',
  'type.regression': 'Linear Regression',
  'type.regressionDesc': 'Predict a dependent variable',
  'type.reliability': 'Reliability',
  'type.reliabilityDesc': 'Cronbach’s alpha and items',
  'type.nonparametric': 'Nonparametric',
  'type.nonparametricDesc': 'Goodness of fit, Mann-Whitney, Wilcoxon',

  'run.start': 'Run analysis',
  'run.running': 'Running…',
  'run.runningHint': 'The statistics engine is running on this computer. One moment.',
  'run.done': 'Analysis complete',
  'run.failed': 'Analysis failed',
  'run.noInput': 'Choose a data file first.',
  'run.noAnalysis': 'Choose at least one analysis.',
  'run.noDir': 'Choose where the results should go (a folder or a file name).',

  'recent.title': 'Recent output',
  'recent.loading': 'Reading…',
  'recent.empty': 'No output files yet. Finished analyses appear here.',
  'recent.dir': '{count} files',
  'recent.refresh': 'Refresh list',

  'error.title': 'Something went wrong',
  'error.network': 'The local service is unreachable. Check that the Harness is still running.',

  'log.title': 'Run log',
  'table.empty': '(no data)',
  'table.unsupported': 'This table cannot be displayed.',

}

/** BCP-47-ish tag the panel is rendered in; resolved once per page load. */
let cachedLocale = null

/** The language the page is rendered in: zh-* → Chinese, otherwise English. */
export function resolveLocale() {
  if (cachedLocale !== null) return cachedLocale
  let candidate = ''
  try {
    if (typeof document !== 'undefined' && document.documentElement.lang) {
      candidate = document.documentElement.lang
    }
  } catch {
    candidate = ''
  }
  if (candidate === '') {
    try {
      if (typeof navigator !== 'undefined') {
        candidate = navigator.language || (navigator.languages && navigator.languages[0]) || ''
      }
    } catch {
      candidate = ''
    }
  }
  // An empty tag means the harness has not stated a language; Chinese is the
  // default for this panel.
  cachedLocale = candidate === '' || /^zh/i.test(candidate) ? 'zh' : 'en'
  return cachedLocale
}

/** True when the panel renders Chinese copy. */
export function isChinese() {
  return resolveLocale() === 'zh'
}

/**
 * Copy resolver for the current language.
 * @returns `(key, values?) => string` — never throws, never returns undefined.
 */
export function makeT() {
  const table = resolveLocale() === 'zh' ? zh : en
  return function t(key, values) {
    const name = typeof key === 'string' ? key : String(key)
    let raw = table[name]
    if (typeof raw !== 'string') raw = en[name]
    if (typeof raw !== 'string') raw = name
    if (values === undefined || values === null) return raw
    return raw.replace(/\{(\w+)\}/g, (match, keyName) => {
      const replacement = values[keyName]
      return replacement === undefined || replacement === null ? match : String(replacement)
    })
  }
}

/** Offline surface: the dictionaries, for a locale-coverage test. */
export const __test = { zh, en }
