# DSH Plugins Suite

A personal collection of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugins, built and used on macOS.

Each package under [`packages/`](packages) is a self-contained DSH bundle: a Host half (`index.js`) that registers routes, tools and services, and usually a Client half (`client.js`) that renders into the Web UI through slots.

## Plugins

| Package | What it does | Where it appears |
|---|---|---|
| **[dsh-spss](packages/dsh-spss)** | SPSS-style statistical analysis (11 procedures) with a native macOS file picker for every input **and** output path. Reads `.sav/.zsav/.csv/.tsv/.xlsx/.xls/.dta`, writes `csv/xlsx/docx/png/json/sav`. | Sidebar entry → full analysis page |
| **[dsh-notes](packages/dsh-notes)** | Daily sticky-note wall, grouped by the day a note was written. | Sidebar |
| **[dsh-deploy](packages/dsh-deploy)** | One-click deploy of a static site to CloudBase hosting, with live logs and post-deploy version verification. | Sidebar |
| **[dsh-office-preview](packages/dsh-office-preview)** | Document previews the bundled viewer cannot show: Word, Excel, PowerPoint and delimited tables. | Right sidebar document tab |
| **[dsh-file-tray](packages/dsh-file-tray)** | Tray listing every file the current conversation has written; click to open. | Conversation header |
| **[dsh-vocab-preview](packages/dsh-vocab-preview)** | Auto-opens a produced 剧有词 learning page in the right-side preview. | Right-side preview |
| **[dsh-balance](packages/dsh-balance)** | DeepSeek account balance, read through a key-holding Host proxy. | Composer capsule + Settings |

## Install a plugin

DSH profiles are composed from `link:` dependencies plus a patch row. To use one of these:

```bash
# 1. link the package into your profile
cd ~/.dsh/profiles/<profile>
npm install --save "dsh-spss@link:/absolute/path/to/packages/dsh-spss"
```

```yaml
# 2. mount it in the profile's cordis.patch.yml
- insert:
    - id: dsh-spss
      name: 'dsh-spss'
```

Then **fully restart DSH**. The desktop profile is startup-only (`patchReload` is not `live`), so a row added after launch does not take effect until restart.

## Requirements

- **Node.js** `^22.19.0 || >=24.0.0`
- **Docker** none; everything runs locally
- **dsh-spss** additionally needs Python 3 with `numpy`, `pandas`, `scipy`; `pyreadstat`, `matplotlib`, `openpyxl` and `python-docx` enable `.sav` I/O, charts and Word export. Override the interpreter with the plugin's `pythonPath` config or `DSH_SPSS_PYTHON`.

```bash
python3 -m pip install numpy pandas scipy pyreadstat matplotlib openpyxl python-docx
```

## Development

Each package builds and tests on its own:

```bash
cd packages/dsh-spss
npm install            # dev deps: esbuild, react, jsdom
npm run build          # where a build script exists
npm test
```

Client halves are plain JavaScript bundled by esbuild into `client.js`, which calls `window.__ModuleLoader__.load({ id, factory })`. React stays external and is provided by the host module table.

### Test status

All suites pass without network access. A few checks that need sample documents or a live site report themselves as skipped rather than failing:

| Package | Checks |
|---|---|
| dsh-spss | 94 host + 74 route + 117 engine |
| dsh-office-preview | 56 |
| dsh-file-tray | model + wiring + open + real-React end-to-end |
| dsh-notes | model + host |
| dsh-vocab-preview | 19 |
| dsh-deploy | 16 |

## Notes

- These are personal tools, not published npm packages. Versions are `1.0.0` unless stated.
- No credentials are stored in this repository. `dsh-deploy` ships empty placeholders; fill in your own project directory and CloudBase environment in the panel.
- SPSS is a trademark of IBM. `dsh-spss` is an independent implementation of common SPSS statistical procedures; it does not include or require IBM SPSS Statistics.

## License

MIT — see [LICENSE](LICENSE).

### Third-party code inside bundled output

`client.js` files are generated bundles. Some inline third-party libraries, each keeping its own license notice in the file header:

- `dsh-office-preview/lib/client.js` — docx-preview (Apache-2.0), SheetJS xlsx (Apache-2.0), pptx-preview (ISC)
- `dsh-notes`, `dsh-file-tray`, `dsh-spss`, `dsh-deploy`, `dsh-vocab-preview` — React is **not** bundled; it is provided by the host module table.
