# dsh-spss

SPSS-style statistical analysis inside DSH, with **complete input/output path
control** — every data path comes in through a **native OS file dialog** on the
machine running the Host, and every result goes to a folder the user chose.

Two halves in one bundle:

| half | file | owns |
| --- | --- | --- |
| host | `index.js` (+ `engine-bridge.js`) | `/api/dsh-spss/*` routes, the two tools, the native picker, the Python child process |
| client | `lib/client.js` (built from `src/`) | the analysis panel UI (`dsh.client` → `./lib/client.js`) |

The analysis itself is `engine/analyze.py`, invoked as a child process. The host
never imports Python code and the engine never touches the UI.

## Install (directory / `link:` install)

```jsonc
// <profile>/package.json
"dependencies": { "dsh-spss": "link:/absolute/path/to/dsh-spss" },
"dsh": { "profile": { "bundles": [ /* …, */ "dsh-spss" ] } }
```

The bundle layer `cordis.patch.yml` inserts the `dsh-spss` row; the browser half
is discovered from `package.json`'s `dsh.client`. The desktop profile is not
`patchReload: live`, so **restart the app** to pick the row up, then check
`~/.dsh/dsh-spss.boot.json` (written by `apply()`) to confirm the running server
mounted it.

## Config

| key | default | meaning |
| --- | --- | --- |
| `pythonPath` | `''` | interpreter for the engine. Empty → probe `DSH_SPSS_PYTHON`, `python3`, `/usr/local/bin/python3`, `/opt/homebrew/bin/python3`, first that works, cached. |
| `timeoutMs` | `300000` | hard ceiling for one analysis; the child is `SIGKILL`ed on expiry. |
| `outputsDir` | `''` | where results go. Empty → **`<dsh home>/dsh-spss/outputs`** (`~/.dsh/dsh-spss/outputs`). |
| `allowNativePicker` | `true` | `false` → picker routes answer `unsupported` and the UI uses its path field. |

### Why `<dsh home>/dsh-spss/outputs` is the default

Results are the plugin's data, not the project's source: a workspace-relative
folder would move with the workspace, and a `~/Documents/SPSS输出` folder
assumes a locale the user may not want. `<dsh home>` is the one directory DSH
always owns and can create. The UI pre-fills this absolute path (from `/status`)
and the user is free to pick any other folder with the native picker, so the
default is a starting point, not a constraint.

## Routes

All under `/api/dsh-spss`, all behind `connection.requestRejection(req)` (the
Host/Origin check plus the browser-session cookie: 401/403 before any work) and
all answering `application/json; charset=utf-8` with `cache-control: no-store`.

| method | path | body | answers |
| --- | --- | --- | --- |
| `GET` | `/status` | — | `{ ok, python:{path,version,ok,executable,tried}, enginePath, engineExists, hasPyreadstat, hasScipy, hasPandas, hasNumpy, hasDocx, hasMatplotlib, homeDir, outputsDir, defaultOutBaseName, platform, arch, picker, config, pluginDir, version }` |
| `POST` | `/pick` | `{ kind:'open'\|'save', title?, defaultName?, filters?:[{name,extensions}], defaultDir? }` | `{ ok:true, path, kind }` · `{ ok:false, cancelled:true }` · `{ ok:false, unsupported:true, error, hint }` |
| `POST` | `/pick-dir` | same, folder dialog | same as `/pick` |
| `POST` | `/run` | engine payload (below) | the engine result **verbatim**, plus `elapsedMs`; `{ ok:false, error, stderr? }` on failure |
| `POST` | `/open-path` | `{ path }` | `{ ok, path }` — reveals it in Finder/Explorer |
| `POST` | `/read-data` | `{ path, sheet?, csvOptions? }` | `{ ok, variables:[{name,label,type,measure}], rows, totalRows }` |
| `GET` | `/outputs` | `?dir=&limit=` | `{ ok, dir, files:[{name,size,mtime,path}] }` |

`outputsDir`, `homeDir`, `defaultOutBaseName` and `enginePath` in `/status` are
**fully expanded and absolute** — the UI can bind a path field to them directly.

### The picker contract

* Only a path the **user chose in the dialog** is ever returned. On cancel,
  timeout, or failure there is no `path` in the response.
* A user cancel is **not an error**: `{ ok:false, cancelled:true }`.
* `unsupported` is a *normal* answer (headless session, `DSH_SPSS_PICKER=off`,
  `allowNativePicker:false`). It always carries a `hint`; the UI's typed path
  field is the fallback and must not block.
* `DSH_SPSS_PICKER=off` in the Host environment makes both picker routes return
  `unsupported` immediately — useful for tests and for headless runs.
* `save` enforces the extension: `choose file name` cannot type-filter, so a
  name with no wanted extension gets the first `filters[].extensions[0]`
  appended. The chosen folder and base name are otherwise untouched.

### Engine payload

```jsonc
{
  "inputPath": "/abs/path/data.sav",      // required, absolute
  "variables": ["age", "score"],
  "analyses": [                            // required, ≥1, {type} mandatory
    { "type": "descriptives", "variables": ["age"] },
    { "type": "ttest", "variables": ["score"], "groupBy": "group" }
  ],
  "exports": ["csv", "xlsx", "docx", "png", "json", "sav"],  // default csv,xlsx,json
  "outDir": "/abs/output/folder",           // default: config outputsDir
  "outBaseName": "report"                   // default: spss-<ISO timestamp>
}
```

The host normalises this, writes it to a temp JSON, runs

```
<python> <bundle>/engine/analyze.py --payload <tmp-in.json> --out-json <tmp-out.json>
```

with `timeoutMs` as a hard limit, reads the result back, and returns it
**verbatim** — the engine owns its response schema.

## Tools

| tool | purpose |
| --- | --- |
| `spss_analyze` | the same run as `POST /run`. Params: `inputPath` (required), `analyses` (required), `variables`, `exports` (enum csv/xlsx/docx/png/json/sav), `outDir`, `outBaseName`. Returns the engine result plus a `summary` naming every absolute output path, which is what `output.render` shows. |
| `spss_list_outputs` | the same listing as `GET /outputs`. Params: `dir?`, `limit?`. |

Both use the contract `ToolDefinition` shape: a JSON-Schema `parameters` with a
sibling `required` array, and `output: { schema, render(args, value) → ContentBlock[] }`.

## Security model

* **No shell, ever.** Every external program (osascript, PowerShell, zenity,
  python) is started with `execFile`/`spawn` and an **argv array**. No request
  value is concatenated into a command string anywhere.
* **Untrusted paths.** `safePath()` makes every request path absolute and
  refuses a NUL byte or an over-long value before it reaches the OS.
* **AppleScript injection.** Prompts and default names are escaped
  (`\` → `\\`, `"` → `\"`, newlines folded) before becoming AppleScript string
  literals. The script itself is written to a temp **file** and run as
  `osascript <file>`, so none of it appears on a command line.
* **Default names cannot traverse.** `../../etc/passwd` becomes `passwd`.
* **No Automation permission needed.** The scripts use only plain
  `choose file` / `choose file name` / `choose folder` — no
  `tell application` block. (`System Events` *does* need an Automation
  permission, and is verified to fail with `-1743` on this machine.)
* **A stuck dialog cannot wedge the Host.** Every child carries a hard timeout
  and is killed with **`SIGKILL`** — during verification a `SIGTERM`'d
  `osascript` kept the process and its modal window alive, so `SIGTERM` is not
  sufficient here. Children are detached into their own process group so one
  kill takes the whole subtree.
* **Temp files always cleaned**: the script, the payload and the result file
  live in a `mkdtemp` directory removed in a `finally`.

## How the picker was verified (macOS, this machine)

Observed, not assumed:

1. GUI session present: `launchctl managername` → `Aqua`, `/dev/console` owner
   is the same user as the Host.
2. Generated `choose file` / `choose file name` / `choose folder` scripts
   **compile** with `osacompile` (including a deliberately hostile prompt
   containing `" & (do shell script "id") & "`, which stays inert inside the
   string literal).
3. Driving a dialog through `pickNativePath()` **blocked for the full timeout
   and killed cleanly**, leaving no process behind — i.e. the dialog really
   appeared and the kill works.
4. A real cancel maps to exit code **1** with `(-128)` on stderr; the script's
   own `errNumber is -128` branch returns the sentinel first.
5. `System Events` automation fails here with **-1743**, which is why the scripts
   never use it.

A test run **cannot click the dialog for you**. To see the success path
end-to-end, a human must pick a file — run:

```bash
cd dsh-spss && npm run test:dialog
```

## Tests

```bash
node scripts/test.mjs          # 94 checks: pure helpers, AppleScript, python, engine
node scripts/test-routes.mjs   # 68 checks: routes over real HTTP, fence, tools, lifecycle
npm test                       # both
```

Neither needs a DSH runtime: `engine-bridge.js` and the pure helpers in
`index.js` are imported directly, and `test-routes.mjs` boots `apply()` in a
stub context with a real `node:http` server.
