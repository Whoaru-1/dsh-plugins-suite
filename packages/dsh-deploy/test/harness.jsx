import React from 'react'
import { createRoot } from 'react-dom/client'
import { apply, DeployPage } from '../src/client.js'

const fixture = {
  ok: true,
  config: {
    projectDir: '/Users/you/projects/my-site',
    envId: 'your-env-id',
    cloudPath: 'ielts',
    siteUrl: 'https://your-env-id-1234567890.tcloudbaseapp.com',
    proxyUrl: ''
  },
  run: {
    id: 't1', action: 'deploy', running: false, startedAt: '2026-11-05T01:00:00Z',
    finishedAt: '2026-11-05T01:00:12Z', exitCode: 0,
    log: [
      '▶ deploy  /Users/you/projects/my-site',
      '$ bash scripts/deploy-cloudbase.sh',
      '== 生成干净的部署目录（只含站点文件）==',
      '[uploadFiles] 准备上传 51 个文件',
      '[uploadFiles] 全部完成！共处理 51 个文件',
      '✔ 文件上传完成',
      '✔ 部署完成 https://example.tcloudbaseapp.com/ielts/',
      '✔ 已完成发布后一致性校验',
      '== 线上版本校验 ==',
      '本地版本   v1.1.0 · 2026-11-05',
      '线上版本   v1.1.0 · 2026-11-05',
      '✓ 线上与本地版本一致，已同步。',
      '✔ 完成'
    ]
  },
  versions: {
    local: { version: '1.1.0', build: '2026-11-05' },
    remote: { version: '1.1.0', build: '2026-11-05' },
    remoteError: null, checkedAt: Date.now()
  },
  detected: { projectExists: true, hasIndex: true, hasDeployScript: true, cloudbaseCli: true, gitHead: '076b2e3' }
}

window.__calls = []
window.fetch = async (url, opts = {}) => {
  const u = String(url)
  window.__calls.push(`${opts.method || 'GET'} ${u}`)
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  if (u.includes('/api/dsh-deploy/state')) return json(fixture)
  if (u.includes('/api/dsh-deploy/config')) return json({ ok: true, config: fixture.config })
  if (u.includes('/api/dsh-deploy/run')) return json({ ok: true })
  if (u.includes('/api/dsh-deploy/stop')) return json({ ok: true })
  return json({ ok: false, error: 'not mocked' }, 404)
}

const slots = []
apply({
  effect(fn) { fn() },
  slots: {
    inject(_name, fn) { return fn() },
    register(def, comp) { slots.push({ def, comp }); return () => {} }
  }
})
window.__slots = slots.map((s) => `${s.def.name}:${s.def.id || s.def.key}`)

createRoot(document.getElementById('root')).render(<DeployPage />)
