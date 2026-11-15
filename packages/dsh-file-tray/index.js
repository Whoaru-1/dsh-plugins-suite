/**
 * dsh-file-tray — host half.
 *
 * The plugin is browser-only: its client half seats a produced-files tray in
 * the conversation header's top-right corner and teaches the workspace
 * document preview to fit images into the pane. The host half exists so the
 * loader has a real plugin row to mount; it injects no service, registers no
 * tool, and serves no route.
 *
 * Because a newly inserted plugin row only reaches the browser boot graph when
 * the loader reconciles it, `apply` also leaves a boot proof under `$DSH_HOME`:
 * its timestamp tells you whether the running server has this row mounted
 * (present) or is still on the previous boot (absent).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-file-tray'

const PROOF = 'dsh-file-tray.boot.json'

/**
 * Inspect what the browser was told to load, from inside the process that
 * serves it.
 *
 * A client half reaches the browser through the platform's client-module
 * registry; when that registry is not this process's carrier (a newer runtime
 * may deliver client code some other way), the report says so instead of
 * guessing. Every probe is defensive: a missing service or a shape change must
 * degrade to a note, never to a throw.
 * @param ctx - the host plugin context.
 * @returns a plain, JSON-serializable report.
 */
function inspectClientDelivery(ctx) {
  const report = { delivery: 'unavailable', note: '' }
  try {
    const registry = typeof ctx?.get === 'function' ? ctx.get('clientModules') : undefined
    if (registry === undefined) {
      report.note = 'no clientModules service on this context'
      return report
    }
    const graph = typeof registry.graph === 'function' ? registry.graph() : undefined
    const entries = Array.isArray(graph?.entries) ? graph.entries : []
    const own = entries.find((entry) => entry?.id === name)
    const clientPath = typeof registry.clientPath === 'function' ? registry.clientPath(name) : undefined
    report.delivery = 'clientModules'
    report.registeredInGraph = own !== undefined
    report.clientPath = clientPath ?? null
    report.entryCount = entries.length
    report.entry = own === undefined ? null : { id: own.id, phase: own.phase ?? null }
    // The batches are what the browser actually fetches: their `url` is the
    // only authoritative answer to "is this bundle reachable, and at what
    // address". Record the ones that carry this package, plus the graph
    // revision, so the address can be re-requested verbatim.
    const batches = Array.isArray(graph?.batches) ? graph.batches : []
    report.rev = graph?.rev ?? null
    report.batchCount = batches.length
    report.ownBatches = batches
      .filter((batch) => Array.isArray(batch?.ids) && batch.ids.includes(name))
      .map((batch) => ({ phase: batch.phase ?? null, url: batch.url ?? null, ids: batch.ids }))
    report.observedIds = entries.slice(0, 12).map((entry) => entry?.id ?? null)
    return report
  } catch (error) {
    report.note = `probe failed: ${String(error?.message ?? error)}`
    return report
  }
}

/** Record that the running server mounted this row, plus what it advertises. Never fatal. */
function writeBootProof(ctx) {
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
          client: inspectClientDelivery(ctx),
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

export function apply(ctx) {
  // The browser half owns every rendered behaviour.
  writeBootProof(ctx)
}
