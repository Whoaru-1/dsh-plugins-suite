/**
 * dsh-office-preview — host half.
 *
 * The plugin is browser-only: its client half registers Office document
 * renderers through the official `documentPreviews` registry and the
 * `sidebar.right.tab.document` slot. This host half exists so the loader has a
 * real plugin row to mount; it injects no service and registers no tool.
 *
 * Because a newly installed client plugin only reaches the browser boot graph
 * when `dsh web` starts, `apply` also leaves a boot proof under `$DSH_HOME`:
 * its timestamp tells you whether the running server has this row mounted
 * (present) or is still on the previous boot (absent).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-office-preview'

const PROOF = 'dsh-office-preview.boot.json'

/** Record that the running server mounted this row. Never fatal. */
function writeBootProof() {
  try {
    const home = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
    mkdirSync(home, { recursive: true })
    writeFileSync(
      path.join(home, PROOF),
      `${JSON.stringify(
        {
          plugin: name,
          pid: process.pid,
          mountedAt: new Date().toISOString(),
          node: process.version,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  } catch {
    // A missing proof only costs a diagnostic, never the plugin.
  }
}

export function apply() {
  // The browser half owns every rendered behaviour.
  writeBootProof()
}
