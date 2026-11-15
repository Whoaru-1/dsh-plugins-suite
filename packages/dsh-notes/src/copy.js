/**
 * dsh-notes — copy and language resolution.
 *
 * The harness ships Chinese and English UI dictionaries; this plugin keeps one
 * small table and follows the document language, the same resolution the other
 * local plugins use.
 */

const zh = {
  panel: '便签',
  title: '便签',
  subtitle: '记录每天的想法',
  count: '{count} 条',
  countNotes: '{count} 条便签',
  countToday: '今天 {count} 条',
  countFiltered: '找到 {count} 条',
  loading: '正在读取便签…',
  search: '搜索便签',
  searchClear: '清空搜索',
  composerNew: '新便签',
  composerEdit: '编辑便签',
  composerPlaceholder: '此刻在想什么？写下来，留给今天的自己。',
  composerPlaceholderEdit: '修改这条便签…',
  composerSave: '保存',
  composerUpdate: '更新',
  composerSaving: '保存中…',
  composerCancel: '取消',
  composerHint: '⌘↵ 保存 · Esc 取消',
  composerHintWin: 'Ctrl↵ 保存 · Esc 取消',
  composerLimit: '{count}/5000',
  colorLabel: '便签颜色',
  colorYellow: '鹅黄',
  colorRose: '浅粉',
  colorSky: '天蓝',
  colorMint: '薄荷',
  colorLilac: '丁香',
  noteEdit: '编辑',
  noteDelete: '删除',
  noteExpand: '展开全文',
  noteCollapse: '收起',
  dayToday: '今天',
  dayYesterday: '昨天',
  emptyTitle: '还没有便签',
  emptyBody: '把今天的一个念头写下来，它会按日期留在这里。',
  emptySearchTitle: '没有找到便签',
  emptySearchBody: '换个关键词试试，或者清空搜索。',
  statusSaved: '已保存',
  statusSaving: '保存中…',
  statusLocal: '仅保存在本机',
  errorBanner: '无法写入本地便签文件，改动暂存在浏览器里。',
  errorRetry: '重试',
  noticeRecovered: '便签文件损坏，已从上一份备份恢复。',
  noticeDismiss: '知道了',
  toastSaved: '已保存',
  toastDeleted: '已删除',
  toastUndo: '撤销',
  ariaNotes: '便签列表',
}

const en = {
  panel: 'Notes',
  title: 'Notes',
  subtitle: 'Thoughts, kept by the day.',
  count: '{count}',
  countNotes: '{count} notes',
  countToday: '{count} today',
  countFiltered: '{count} found',
  loading: 'Reading your notes…',
  search: 'Search notes',
  searchClear: 'Clear search',
  composerNew: 'New note',
  composerEdit: 'Editing note',
  composerPlaceholder: 'What is on your mind? Write it down for today.',
  composerPlaceholderEdit: 'Change this note…',
  composerSave: 'Save',
  composerUpdate: 'Update',
  composerSaving: 'Saving…',
  composerCancel: 'Cancel',
  composerHint: '⌘↵ save · Esc cancel',
  composerHintWin: 'Ctrl↵ save · Esc cancel',
  composerLimit: '{count}/5000',
  colorLabel: 'Note colour',
  colorYellow: 'Butter',
  colorRose: 'Rose',
  colorSky: 'Sky',
  colorMint: 'Mint',
  colorLilac: 'Lilac',
  noteEdit: 'Edit',
  noteDelete: 'Delete',
  noteExpand: 'Read more',
  noteCollapse: 'Show less',
  dayToday: 'Today',
  dayYesterday: 'Yesterday',
  emptyTitle: 'No notes yet',
  emptyBody: 'Write down one thought from today. It will stay here, filed by the day.',
  emptySearchTitle: 'No notes match',
  emptySearchBody: 'Try another word, or clear the search.',
  statusSaved: 'Saved',
  statusSaving: 'Saving…',
  statusLocal: 'Saved in this browser',
  errorBanner: 'The local notes file could not be written. Changes are kept in this browser for now.',
  errorRetry: 'Retry',
  noticeRecovered: 'The notes file was damaged; the previous backup was restored.',
  noticeDismiss: 'Dismiss',
  toastSaved: 'Saved',
  toastDeleted: 'Deleted',
  toastUndo: 'Undo',
  ariaNotes: 'Notes',
}

/** The language the page is rendered in. */
export function resolveLocale() {
  try {
    const documentLang = typeof document !== 'undefined' ? document.documentElement.lang : ''
    if (documentLang !== '') return documentLang
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  } catch {
    // A missing document keeps the English copy.
  }
  return 'en'
}

/** Copy resolver for the current document language. */
export function makeT() {
  const table = /^zh/i.test(resolveLocale()) ? zh : en
  return (key, values) => {
    const raw = table[key] ?? en[key] ?? key
    if (values === undefined) return raw
    return raw.replace(/\{(\w+)\}/g, (match, name) =>
      values[name] === undefined ? match : String(values[name]),
    )
  }
}
