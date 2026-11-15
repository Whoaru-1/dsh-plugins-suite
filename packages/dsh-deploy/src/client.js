/**
 * dsh-deploy — client half.
 *
 * A sidebar row and one page: configuration, a big deploy button, live CLI log,
 * and a local-vs-remote version check. All work happens in the host half
 * (`/api/dsh-deploy/*`); this half only renders and posts.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'

export const name = 'dsh-deploy'
export const inject = ['slots']
export const PANEL_ID = 'deploy'

const STYLE_ID = 'dsh-deploy/styles'

const CSS = String.raw`
.dsd-page {
  --dsd-ink: var(--dsw-alias-label-primary, #1a1a1a);
  --dsd-ink-2: var(--dsw-alias-label-secondary, #555);
  --dsd-ink-3: var(--dsw-alias-label-tertiary, #888);
  --dsd-border: var(--dsw-alias-border-l2, rgba(0,0,0,.12));
  --dsd-border-soft: var(--dsw-alias-border-l1, rgba(0,0,0,.07));
  --dsd-layer: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.035));
  --dsd-accent: var(--dsw-alias-state-business-primary, #4d6bfe);
  --dsd-success: var(--dsw-alias-state-success-primary, #0f9d58);
  --dsd-danger: var(--dsw-alias-state-error-primary, #d33);
  --dsd-warn: var(--dsw-alias-state-warning-primary, #c77700);
  --dsd-font: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  --dsd-mono: var(--dsw-font-family-code, ui-monospace, "SF Mono", Menlo, monospace);
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 28px 32px 56px;
  color: var(--dsd-ink);
  background: var(--dsw-alias-bg-base, #fff);
  font: 14px/1.6 var(--dsd-font);
}
.dsd-wrap { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.dsd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dsd-title { margin: 0; font-size: 24px; line-height: 1.25; letter-spacing: -.02em; }
.dsd-sub { margin: 6px 0 0; color: var(--dsd-ink-3); font-size: 13px; }
.dsd-badge { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.dsd-badge.ok { background: color-mix(in srgb, var(--dsd-success) 12%, transparent); color: var(--dsd-success); }
.dsd-badge.warn { background: color-mix(in srgb, var(--dsd-warn) 14%, transparent); color: var(--dsd-warn); }
.dsd-badge.bad { background: color-mix(in srgb, var(--dsd-danger) 12%, transparent); color: var(--dsd-danger); }
.dsd-badge.plain { background: var(--dsd-layer); color: var(--dsd-ink-2); }
.dsd-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.dsd-card { border: 1px solid var(--dsd-border-soft); background: var(--dsd-layer); border-radius: 14px; padding: 14px 16px; min-width: 0; }
.dsd-card .k { color: var(--dsd-ink-3); font-size: 12px; }
.dsd-card .v { margin-top: 4px; font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsd-card .d { margin-top: 3px; color: var(--dsd-ink-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsd-panel { border: 1px solid var(--dsd-border-soft); border-radius: 16px; background: var(--dsw-alias-bg-base, #fff); overflow: hidden; }
.dsd-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--dsd-border-soft); }
.dsd-panel-title { font-size: 13px; font-weight: 650; color: var(--dsd-ink-2); }
.dsd-panel-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.dsd-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.dsd-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dsd-field.full { grid-column: 1 / -1; }
.dsd-field label { font-size: 12px; font-weight: 600; color: var(--dsd-ink-2); }
.dsd-field input {
  height: 36px; padding: 0 11px; border-radius: 10px; min-width: 0;
  border: 1px solid var(--dsd-border); background: var(--dsd-layer);
  color: var(--dsd-ink); font: 12.5px/1.4 var(--dsd-mono);
}
.dsd-field input:focus { outline: 2px solid color-mix(in srgb, var(--dsd-accent) 45%, transparent); outline-offset: 1px; border-color: var(--dsd-accent); }
.dsd-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.dsd-btn {
  height: 38px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--dsd-border);
  background: transparent; color: var(--dsd-ink); font: 600 13px/1 var(--dsd-font); cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px; transition: background .15s, border-color .15s, transform .1s;
}
.dsd-btn:hover { background: var(--dsd-layer); }
.dsd-btn:active { transform: translateY(1px); }
.dsd-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.dsd-btn.primary { background: var(--dsd-accent); border-color: var(--dsd-accent); color: #fff; }
.dsd-btn.primary:hover { filter: brightness(1.06); background: var(--dsd-accent); }
.dsd-btn.danger { color: var(--dsd-danger); border-color: color-mix(in srgb, var(--dsd-danger) 35%, transparent); }
.dsd-badge .dot, .dsd-btn .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .8; flex: 0 0 auto; }
.dsd-note { font-size: 12px; color: var(--dsd-ink-3); line-height: 1.7; }
.dsd-note code { font-family: var(--dsd-mono); font-size: 11.5px; background: var(--dsd-layer); padding: 1px 5px; border-radius: 5px; }
.dsd-log {
  margin: 0; max-height: 380px; overflow: auto; padding: 14px 16px;
  background: #0d1117; color: #d6deeb; border-radius: 0; font: 12px/1.65 var(--dsd-mono);
  white-space: pre-wrap; word-break: break-word;
}
.dsd-log .ok { color: #7ee787; }
.dsd-log .bad { color: #ff7b72; }
.dsd-log .info { color: #8b949e; }
.dsd-log .cmd { color: #79c0ff; }
.dsd-log .head { color: #e3b341; }
.dsd-empty { padding: 18px; color: var(--dsd-ink-3); font-size: 12.5px; }
.dsd-toast { font-size: 12.5px; color: var(--dsd-success); }
.dsd-toast.bad { color: var(--dsd-danger); }
@media (max-width: 760px) {
  .dsd-page { padding: 18px 16px 40px; }
  .dsd-grid { grid-template-columns: minmax(0, 1fr); }
  .dsd-fields { grid-template-columns: minmax(0, 1fr); }
}
`

/** Sidebar glyph: an upload tray with an arrow. */
function DeployIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15V4m0 0L8 8m4-4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function lineClass(line) {
  if (/^[✔✓]/.test(line)) return 'ok'
  if (/^[✗✘]|Error|error:|失败/.test(line)) return 'bad'
  if (/^[$▶]/.test(line)) return 'cmd'
  if (/^==|^—/.test(line)) return 'head'
  if (/^ℹ|提示|CDN/.test(line)) return 'info'
  return ''
}

async function getState() {
  const res = await fetch('/api/dsh-deploy/state', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

function VersionBadge({ local, remote }) {
  if (!remote) return <span className="dsd-badge plain">线上版本未知</span>
  const same = local && local.version === remote.version && local.build === remote.build
  return same
    ? <span className="dsd-badge ok"><span className="dot" />已同步</span>
    : <span className="dsd-badge warn"><span className="dot" />线上不是最新</span>
}

export function DeployPage() {
  const [snapshot, setSnapshot] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef(null)
  const timerRef = useRef(null)
  const formTouched = useRef(false)

  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const data = await getState()
        if (!alive) return
        setSnapshot(data)
        setError('')
        if (!formTouched.current && data.config) setForm({ ...data.config })
      } catch (err) {
        if (alive) setError(`无法连接部署服务：${String(err?.message ?? err)}`)
      }
    }
    tick()
    timerRef.current = setInterval(tick, 2000)
    return () => {
      alive = false
      if (timerRef.current !== null) clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [snapshot?.run?.log?.length])

  const local = snapshot?.versions?.local
  const remote = snapshot?.versions?.remote
  const running = Boolean(snapshot?.run?.running)
  const config = form ?? snapshot?.config ?? null
  const siteHref = config ? `${config.siteUrl.replace(/\/+$/, '')}/${config.cloudPath.replace(/^\/+/, '')}/`.replace(/([^:])\/+/g, '$1/') : '#'

  const logLines = useMemo(() => snapshot?.run?.log ?? [], [snapshot?.run?.log])

  function edit(key, value) {
    formTouched.current = true
    setForm((prev) => ({ ...(prev ?? {}), [key]: value }))
  }

  async function saveConfig() {
    setNotice('')
    setBusy(true)
    try {
      const data = await postJSON('/api/dsh-deploy/config', config)
      setForm({ ...data.config })
      formTouched.current = false
      setNotice('配置已保存')
    } catch (err) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  async function run(action) {
    setNotice('')
    setError('')
    setBusy(true)
    try {
      await postJSON('/api/dsh-deploy/run', { action, config })
      const data = await getState()
      setSnapshot(data)
    } catch (err) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      await postJSON('/api/dsh-deploy/stop', {})
    } catch (err) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dsd-page">
      <div className="dsd-wrap">
        <header className="dsd-head">
          <div>
            <h1 className="dsd-title">一键部署</h1>
            <p className="dsd-sub">把这个站点上传到 CloudBase 静态托管，并在部署后核对线上版本。</p>
          </div>
          <VersionBadge local={local} remote={remote} />
        </header>

        <div className="dsd-grid">
          <div className="dsd-card">
            <div className="k">本地版本</div>
            <div className="v">{local ? `v${local.version}` : '未读取'}</div>
            <div className="d">{local?.build ?? '项目里没有 version.json'}</div>
          </div>
          <div className="dsd-card">
            <div className="k">线上版本</div>
            <div className="v">{remote ? `v${remote.version}` : '未读取'}</div>
            <div className="d">{remote?.build ?? (snapshot?.versions?.remoteError || '默认域名需要先在外网验证')}</div>
          </div>
          <div className="dsd-card">
            <div className="k">本地提交</div>
            <div className="v">{snapshot?.detected?.gitHead ?? '—'}</div>
            <div className="d">{snapshot?.detected?.cloudbaseCli ? 'cloudbase CLI 已安装' : '未找到 cloudbase CLI'}</div>
          </div>
        </div>

        <section className="dsd-panel">
          <div className="dsd-panel-head">
            <span className="dsd-panel-title">部署配置</span>
            <button className="dsd-btn" type="button" onClick={saveConfig} disabled={busy || !config}>保存配置</button>
          </div>
          <div className="dsd-panel-body">
            <div className="dsd-fields">
              <div className="dsd-field full">
                <label htmlFor="dsd-project">项目路径（含 index.html 的目录）</label>
                <input id="dsd-project" value={config?.projectDir ?? ''} onChange={(e) => edit('projectDir', e.target.value)} spellCheck={false} />
              </div>
              <div className="dsd-field">
                <label htmlFor="dsd-env">CloudBase 环境 ID</label>
                <input id="dsd-env" value={config?.envId ?? ''} onChange={(e) => edit('envId', e.target.value)} spellCheck={false} />
              </div>
              <div className="dsd-field">
                <label htmlFor="dsd-path">云路径</label>
                <input id="dsd-path" value={config?.cloudPath ?? ''} onChange={(e) => edit('cloudPath', e.target.value)} spellCheck={false} />
              </div>
              <div className="dsd-field full">
                <label htmlFor="dsd-site">站点地址（CloudBase 默认域名）</label>
                <input id="dsd-site" value={config?.siteUrl ?? ''} onChange={(e) => edit('siteUrl', e.target.value)} spellCheck={false} />
              </div>
              <div className="dsd-field full">
                <label htmlFor="dsd-proxy">代理地址（可选，仅 git push 使用）</label>
                <input id="dsd-proxy" value={config?.proxyUrl ?? ''} onChange={(e) => edit('proxyUrl', e.target.value)} placeholder="http://127.0.0.1:7890" spellCheck={false} />
              </div>
            </div>
          </div>
        </section>

        <section className="dsd-panel">
          <div className="dsd-panel-head">
            <span className="dsd-panel-title">操作</span>
            <span className="dsd-note">{snapshot?.detected?.hasDeployScript ? 'deploy-cloudbase.sh 已就绪' : '项目缺少部署脚本'}</span>
          </div>
          <div className="dsd-panel-body">
            <div className="dsd-actions">
              <button className="dsd-btn primary" type="button" onClick={() => run('deploy')} disabled={busy || running}>
                <span className="dot" />
                {running ? '部署中…' : '部署到 CloudBase'}
              </button>
              <button className="dsd-btn" type="button" onClick={() => run('check')} disabled={busy || running}>校验线上版本</button>
              <button className="dsd-btn" type="button" onClick={() => run('push')} disabled={busy || running}>Push GitHub</button>
              <button className="dsd-btn" type="button" onClick={() => window.open(siteHref, '_blank', 'noopener')}>打开站点</button>
              {running ? <button className="dsd-btn danger" type="button" onClick={stop} disabled={busy}>停止</button> : null}
            </div>
            {notice ? <div className="dsd-toast">{notice}</div> : null}
            {error ? <div className="dsd-toast bad">{error}</div> : null}
            <p className="dsd-note">
              部署走本机 <code>cloudbase</code> CLI（登录凭据在 <code>~/.config/.cloudbase</code>，不会经过浏览器）。
              CloudBase 默认域名首次打开会显示腾讯云的「风险提醒」中间页，点「确定访问」即可进入。
            </p>
          </div>
        </section>

        <section className="dsd-panel">
          <div className="dsd-panel-head">
            <span className="dsd-panel-title">运行日志</span>
            <span className="dsd-note">
              {snapshot?.run?.action ? `${snapshot.run.action} · ${snapshot.run.running ? '运行中' : `退出码 ${snapshot.run.exitCode ?? '—'}`}` : '尚未运行'}
            </span>
          </div>
          {logLines.length === 0 ? (
            <div className="dsd-empty">点击「部署到 CloudBase」，这里会实时显示上传与校验日志。</div>
          ) : (
            <pre className="dsd-log" ref={logRef}>
              {logLines.map((line, i) => (
                <div key={i} className={lineClass(line)}>{line}</div>
              ))}
            </pre>
          )}
        </section>
      </div>
    </div>
  )
}

/** Mount styles, the sidebar row, and the main page. */
export function apply(ctx) {
  ctx.effect(() => {
    let el = document.getElementById(STYLE_ID)
    if (el === null) {
      el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = CSS
      document.head.append(el)
    }
    return () => {
      el?.remove()
    }
  }, 'dsh-deploy: styles')

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 32, label: () => '部署' },
      DeployIcon
    )
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, DeployPage)
  )
}
