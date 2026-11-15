/**
 * dsh-notes — panel styles.
 *
 * One scoped stylesheet, attached to the document while the plugin is mounted.
 * Every neutral colour comes from the design system's `--dsw-alias-*` tokens so
 * the page follows the active light/dark theme; the five paper colours are the
 * plugin's own material and carry their own light/dark pairs.
 */

export const STYLE_ID = 'dsh-notes/styles'

export const CSS = String.raw`
.dsh-notes-page {
  --dn-page-bg: var(--dsw-alias-bg-base, #fff);
  --dn-ink: var(--dsw-alias-label-primary, #1a1a1a);
  --dn-ink-2: var(--dsw-alias-label-secondary, #555);
  --dn-ink-3: var(--dsw-alias-label-tertiary, #888);
  --dn-caption: var(--dsw-alias-label-caption, #aaa);
  --dn-border: var(--dsw-alias-border-l2, rgba(0,0,0,.12));
  --dn-border-soft: var(--dsw-alias-border-l1, rgba(0,0,0,.07));
  --dn-layer: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.035));
  --dn-hover: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));
  --dn-accent: var(--dsw-alias-state-business-primary, #4d6bfe);
  --dn-danger: var(--dsw-alias-state-error-primary, #d33);
  --dn-font: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  --dn-mono: var(--dsw-font-family-code, ui-monospace, "SF Mono", Menlo, monospace);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--dn-ink);
  background-color: var(--dn-page-bg);
  background-image: radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--dn-ink) 7%, transparent) 1px, transparent 0);
  background-size: 22px 22px;
  font: 14px/1.6 var(--dn-font);
  overflow: hidden;
}

body[data-ds-dark-theme] .dsh-notes-page {
  background-image: radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--dn-ink) 5%, transparent) 1px, transparent 0);
}

.dsh-notes-page *,
.dsh-notes-page *::before,
.dsh-notes-page *::after {
  box-sizing: border-box;
}

.dsh-notes-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  --dsh-scrollbar-width: 9px;
  --dsh-scrollbar-thumb-border: 2px;
}

.dsh-notes-scroll::-webkit-scrollbar {
  width: 11px;
  height: 11px;
}

.dsh-notes-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(0,0,0,.18));
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.dsh-notes-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(0,0,0,.3));
  border: 3px solid transparent;
  background-clip: padding-box;
}

.dsh-notes-doc {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 clamp(20px, 4vw, 44px) 76px;
}

.dsh-notes-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-top: calc(26px + var(--dsh-frame-top-clearance, 0px));
}

.dsh-notes-heading h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.025em;
}

.dsh-notes-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 7px 0 0;
  color: var(--dn-ink-3);
  font-size: 13px;
  line-height: 1.4;
}

.dsh-notes-sub .dsh-notes-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--dn-caption);
  flex: none;
}

.dsh-notes-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding-top: 3px;
}

.dsh-notes-search {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 214px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--dn-border-soft);
  border-radius: 999px;
  background: var(--dn-layer);
  color: var(--dn-ink-3);
  transition: border-color .15s ease, background .15s ease;
}

.dsh-notes-search:focus-within {
  border-color: color-mix(in srgb, var(--dn-accent) 55%, var(--dn-border));
  background: var(--dn-page-bg);
}

.dsh-notes-search svg {
  flex: none;
}

.dsh-notes-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--dn-ink);
  font: inherit;
  font-size: 13px;
  line-height: 1;
}

.dsh-notes-search input::placeholder {
  color: var(--dn-ink-3);
  opacity: 1;
}

.dsh-notes-search-clear {
  width: 20px;
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dn-ink-3);
  cursor: pointer;
}

.dsh-notes-search-clear:hover {
  background: var(--dn-hover);
  color: var(--dn-ink);
}

.dsh-notes-save {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--dn-ink-3);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.dsh-notes-save::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, #2f9e63);
  flex: none;
}

.dsh-notes-save[data-state="saving"]::before {
  background: var(--dn-accent);
  animation: dsh-notes-pulse 1.1s ease-in-out infinite;
}

.dsh-notes-save[data-state="error"]::before,
.dsh-notes-save[data-state="local"]::before {
  background: var(--dsh-alias-state-warning-primary, #cf8a1f);
}

.dsh-notes-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--dsh-alias-state-warning-primary, #cf8a1f) 35%, var(--dn-border-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsh-alias-state-warning-primary, #cf8a1f) 8%, var(--dn-page-bg));
  color: var(--dn-ink-2);
  font-size: 12.5px;
  line-height: 1.5;
}

.dsh-notes-banner p {
  flex: 1;
  min-width: 200px;
  margin: 0;
}

.dsh-notes-banner button {
  border: 0;
  background: transparent;
  color: var(--dn-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 5px;
}

.dsh-notes-banner button:hover {
  background: var(--dn-hover);
}

/* ------------------------------------------------------------- composer */

.dsh-notes-composer,
.dsh-notes-note {
  --dn-note-bg: #fff5c9;
  --dn-note-ink: #3a3216;
  --dn-note-muted: #746327;
  --dn-note-line: rgba(58, 50, 22, .13);
  --dn-note-shadow: rgba(70, 57, 16, .18);
}

.dsh-notes-composer[data-color="yellow"],
.dsh-notes-note[data-color="yellow"] {
  --dn-note-bg: #fff5c9;
  --dn-note-ink: #3a3216;
  --dn-note-muted: #746327;
  --dn-note-line: rgba(58, 50, 22, .14);
  --dn-note-shadow: rgba(70, 57, 16, .2);
}

.dsh-notes-composer[data-color="rose"],
.dsh-notes-note[data-color="rose"] {
  --dn-note-bg: #ffe4e8;
  --dn-note-ink: #421f27;
  --dn-note-muted: #7c4954;
  --dn-note-line: rgba(66, 31, 39, .13);
  --dn-note-shadow: rgba(84, 31, 43, .18);
}

.dsh-notes-composer[data-color="sky"],
.dsh-notes-note[data-color="sky"] {
  --dn-note-bg: #e2efff;
  --dn-note-ink: #102f4b;
  --dn-note-muted: #456179;
  --dn-note-line: rgba(16, 47, 75, .13);
  --dn-note-shadow: rgba(20, 55, 84, .18);
}

.dsh-notes-composer[data-color="mint"],
.dsh-notes-note[data-color="mint"] {
  --dn-note-bg: #e0f4e8;
  --dn-note-ink: #123828;
  --dn-note-muted: #466b59;
  --dn-note-line: rgba(18, 56, 40, .13);
  --dn-note-shadow: rgba(18, 61, 43, .18);
}

.dsh-notes-composer[data-color="lilac"],
.dsh-notes-note[data-color="lilac"] {
  --dn-note-bg: #eee6ff;
  --dn-note-ink: #2d2346;
  --dn-note-muted: #635280;
  --dn-note-line: rgba(45, 35, 70, .13);
  --dn-note-shadow: rgba(50, 36, 80, .18);
}

body[data-ds-dark-theme] .dsh-notes-composer,
body[data-ds-dark-theme] .dsh-notes-note {
  --dn-note-bg: #3b3420;
  --dn-note-ink: #f7efce;
  --dn-note-muted: #bdaf82;
  --dn-note-line: rgba(247, 239, 206, .14);
  --dn-note-shadow: rgba(0, 0, 0, .5);
}

body[data-ds-dark-theme] .dsh-notes-composer[data-color="yellow"],
body[data-ds-dark-theme] .dsh-notes-note[data-color="yellow"] {
  --dn-note-bg: #3b3420;
  --dn-note-ink: #f7efce;
  --dn-note-muted: #bdaf82;
  --dn-note-line: rgba(247, 239, 206, .14);
}

body[data-ds-dark-theme] .dsh-notes-composer[data-color="rose"],
body[data-ds-dark-theme] .dsh-notes-note[data-color="rose"] {
  --dn-note-bg: #3d252a;
  --dn-note-ink: #ffe7ea;
  --dn-note-muted: #c69ca4;
  --dn-note-line: rgba(255, 231, 234, .15);
}

body[data-ds-dark-theme] .dsh-notes-composer[data-color="sky"],
body[data-ds-dark-theme] .dsh-notes-note[data-color="sky"] {
  --dn-note-bg: #1f303f;
  --dn-note-ink: #dceeff;
  --dn-note-muted: #94aec4;
  --dn-note-line: rgba(220, 238, 255, .15);
}

body[data-ds-dark-theme] .dsh-notes-composer[data-color="mint"],
body[data-ds-dark-theme] .dsh-notes-note[data-color="mint"] {
  --dn-note-bg: #1e3529;
  --dn-note-ink: #ddf6e6;
  --dn-note-muted: #93b6a1;
  --dn-note-line: rgba(221, 246, 230, .15);
}

body[data-ds-dark-theme] .dsh-notes-composer[data-color="lilac"],
body[data-ds-dark-theme] .dsh-notes-note[data-color="lilac"] {
  --dn-note-bg: #2d2640;
  --dn-note-ink: #f0e8ff;
  --dn-note-muted: #b0a2c7;
  --dn-note-line: rgba(240, 232, 255, .15);
}

.dsh-notes-composer {
  position: relative;
  margin-top: 28px;
  padding: 15px 18px 12px;
  border: 1px solid color-mix(in srgb, var(--dn-note-ink) 10%, transparent);
  border-radius: 18px;
  background: var(--dn-note-bg);
  color: var(--dn-note-ink);
  box-shadow:
    0 1px 1px color-mix(in srgb, var(--dn-note-shadow) 40%, transparent),
    0 14px 30px -20px var(--dn-note-shadow);
  transition: box-shadow .2s ease, transform .2s ease;
}

.dsh-notes-composer:focus-within {
  box-shadow:
    0 1px 1px color-mix(in srgb, var(--dn-note-shadow) 40%, transparent),
    0 18px 40px -22px var(--dn-note-shadow);
}

.dsh-notes-composer[data-editing="true"] {
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--dn-accent) 34%, transparent),
    0 18px 40px -22px var(--dn-note-shadow);
}

.dsh-notes-composer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dsh-notes-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dn-note-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .02em;
}

.dsh-notes-swatches {
  display: flex;
  align-items: center;
  gap: 7px;
}

.dsh-notes-swatch {
  width: 17px;
  height: 17px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--dn-note-ink) 24%, transparent);
  border-radius: 50%;
  background: var(--swatch);
  cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease;
}

.dsh-notes-swatch:hover {
  transform: scale(1.12);
}

.dsh-notes-swatch[aria-pressed="true"] {
  box-shadow:
    0 0 0 2px var(--dn-note-bg),
    0 0 0 3.5px var(--dn-note-ink);
}

.dsh-notes-swatch[data-color="yellow"] { --swatch: #f5d76e; }
.dsh-notes-swatch[data-color="rose"] { --swatch: #f3a9b4; }
.dsh-notes-swatch[data-color="sky"] { --swatch: #9cc7f2; }
.dsh-notes-swatch[data-color="mint"] { --swatch: #9fd9ba; }
.dsh-notes-swatch[data-color="lilac"] { --swatch: #c3aef0; }

.dsh-notes-input {
  display: block;
  width: 100%;
  min-height: 56px;
  max-height: 260px;
  margin: 8px 0 2px;
  padding: 2px 0 6px;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 15px;
  line-height: 1.75;
  field-sizing: content;
}

.dsh-notes-input::placeholder {
  color: var(--dn-note-muted);
  opacity: 1;
}

.dsh-notes-composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
  padding-top: 9px;
  border-top: 1px dashed var(--dn-note-line);
}

.dsh-notes-hint {
  color: var(--dn-note-muted);
  font-size: 11.5px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}

.dsh-notes-counter {
  margin-left: 8px;
  color: var(--dn-note-muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.dsh-notes-counter[data-over="true"] {
  color: var(--dn-danger);
  font-weight: 600;
}

.dsh-notes-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.dsh-notes-btn {
  height: 31px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 999px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background .14s ease, color .14s ease, border-color .14s ease, transform .14s ease;
}

.dsh-notes-btn:disabled {
  cursor: default;
  opacity: .55;
}

.dsh-notes-btn-primary {
  background: var(--dn-note-ink);
  color: var(--dn-note-bg);
}

.dsh-notes-btn-primary:not(:disabled):hover {
  transform: translateY(-1px);
}

.dsh-notes-btn-ghost {
  border-color: color-mix(in srgb, var(--dn-note-ink) 24%, transparent);
  background: transparent;
  color: var(--dn-note-ink);
}

.dsh-notes-btn-ghost:not(:disabled):hover {
  background: color-mix(in srgb, var(--dn-note-ink) 9%, transparent);
}

/* ----------------------------------------------------------------- wall */

.dsh-notes-wall {
  display: flex;
  flex-direction: column;
  gap: 34px;
  margin-top: 32px;
}

.dsh-notes-day-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 13px;
  color: var(--dn-ink-2);
}

.dsh-notes-day-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .01em;
  white-space: nowrap;
}

.dsh-notes-day-count {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dn-layer);
  color: var(--dn-ink-2);
  font-size: 11px;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dsh-notes-day-rule {
  flex: 1;
  height: 1px;
  min-width: 20px;
  background: var(--dn-border-soft);
}

.dsh-notes-grid {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.dsh-notes-column {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
}

.dsh-notes-note {
  position: relative;
  display: block;
  width: 100%;
  margin: 0 0 14px;
  padding: 15px 16px 11px;
  border: 1px solid color-mix(in srgb, var(--dn-note-ink) 9%, transparent);
  border-radius: 16px;
  background: var(--dn-note-bg);
  color: var(--dn-note-ink);
  box-shadow:
    0 1px 1px color-mix(in srgb, var(--dn-note-shadow) 35%, transparent),
    0 10px 24px -18px var(--dn-note-shadow);
  transition: transform .16s ease, box-shadow .16s ease;
  animation: dsh-notes-rise .24s cubic-bezier(.2,.75,.3,1) both;
}

.dsh-notes-note:hover,
.dsh-notes-note:focus-within {
  transform: translateY(-2px);
  box-shadow:
    0 1px 1px color-mix(in srgb, var(--dn-note-shadow) 35%, transparent),
    0 16px 30px -18px var(--dn-note-shadow);
}

.dsh-notes-note:focus-visible {
  outline: 2px solid var(--dn-accent);
  outline-offset: 2px;
}

.dsh-notes-note-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14.5px;
  line-height: 1.72;
  cursor: text;
}

.dsh-notes-note-text[data-clamped="true"] {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 13;
  line-clamp: 13;
  overflow: hidden;
}

.dsh-notes-expand {
  margin: 8px 0 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dn-note-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.dsh-notes-expand:hover {
  color: var(--dn-note-ink);
}

.dsh-notes-note-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 26px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--dn-note-line);
}

.dsh-notes-note-time {
  color: var(--dn-note-muted);
  font-size: 11.5px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.dsh-notes-note-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity .14s ease;
}

.dsh-notes-note:hover .dsh-notes-note-actions,
.dsh-notes-note:focus-within .dsh-notes-note-actions {
  opacity: 1;
}

.dsh-notes-icon-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dn-note-muted);
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}

.dsh-notes-icon-btn:hover {
  background: color-mix(in srgb, var(--dn-note-ink) 10%, transparent);
  color: var(--dn-note-ink);
}

.dsh-notes-icon-btn[data-danger="true"]:hover {
  background: color-mix(in srgb, var(--dn-danger) 16%, transparent);
  color: var(--dn-danger);
}

/* ---------------------------------------------------------------- empty */

.dsh-notes-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 30px;
  padding: 54px 24px 58px;
  border: 1px dashed var(--dn-border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--dn-layer) 55%, transparent);
  text-align: center;
}

.dsh-notes-empty-icon {
  display: inline-flex;
  margin-bottom: 10px;
  color: var(--dn-caption);
}

.dsh-notes-empty h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

.dsh-notes-empty p {
  max-width: 36ch;
  margin: 5px 0 0;
  color: var(--dn-ink-3);
  font-size: 13px;
  line-height: 1.6;
}

.dsh-notes-empty button {
  margin-top: 16px;
}

.dsh-notes-loading {
  padding: 64px 0;
  color: var(--dn-ink-3);
  text-align: center;
  font-size: 13px;
}

/* ---------------------------------------------------------------- toast */

.dsh-notes-toast {
  position: fixed;
  left: 50%;
  bottom: 30px;
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  padding: 8px 10px 8px 16px;
  border: 1px solid var(--dn-border);
  border-radius: 999px;
  background: var(--dsw-specific-menu, rgba(250,250,250,.9));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(24px) saturate(150%));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(24px) saturate(150%));
  box-shadow: 0 8px 28px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.08);
  color: var(--dn-ink);
  font: 13px/1.4 var(--dn-font);
  transform: translateX(-50%);
  animation: dsh-notes-toast-in .22s cubic-bezier(.2,.75,.3,1) both;
}

.dsh-notes-toast button {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dn-accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.dsh-notes-toast button:hover {
  background: var(--dn-hover);
}

/* -------------------------------------------------------------- focus */

.dsh-notes-page :focus-visible {
  outline: 2px solid var(--dn-accent);
  outline-offset: 2px;
}

.dsh-notes-page .dsh-notes-input:focus-visible,
.dsh-notes-page .dsh-notes-search input:focus-visible {
  outline: none;
}

.dsh-notes-page ::selection {
  background: color-mix(in srgb, var(--dn-accent) 24%, transparent);
}

/* --------------------------------------------------------- responsive */

@media (max-width: 760px) {
  .dsh-notes-topbar {
    flex-direction: column;
    gap: 14px;
  }

  .dsh-notes-tools {
    width: 100%;
    padding-top: 0;
  }

  .dsh-notes-search {
    width: auto;
    flex: 1;
  }

  .dsh-notes-note-actions {
    opacity: 1;
  }
}

@media (max-width: 520px) {
  .dsh-notes-doc {
    padding: 0 16px 56px;
  }

  .dsh-notes-heading h1 {
    font-size: 23px;
  }

  .dsh-notes-composer {
    padding: 14px 14px 10px;
    border-radius: 16px;
  }

  .dsh-notes-hint {
    display: none;
  }

  .dsh-notes-day-head {
    margin-bottom: 10px;
  }
}

@keyframes dsh-notes-rise {
  from {
    opacity: 0;
    transform: translateY(7px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes dsh-notes-toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@keyframes dsh-notes-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}

@media (hover: none) {
  .dsh-notes-note-actions {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-notes-page *,
  .dsh-notes-page *::before,
  .dsh-notes-page *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
}
`

/** Attach the stylesheet once; returns a disposer for the plugin lifecycle. */
export function installStyles() {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) existing.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => {
    style.remove()
  }
}
