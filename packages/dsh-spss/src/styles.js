/**
 * dsh-spss — panel styles.
 *
 * One scoped stylesheet, attached while the plugin is mounted and removed on
 * dispose. Every colour is a `--dsw-alias-*` theme token (with a light-mode
 * fallback only, for the case where a token is missing), so the page follows
 * the harness light/dark theme without a single `body[data-ds-dark-theme]`
 * override for chrome; the two dark-only rules below are for artwork shading
 * that a token cannot express.
 *
 * Nothing here writes to the DOM: `installStyles` is the only function that
 * touches the document, and it owns exactly one `<style>` element.
 */

export const STYLE_ID = 'dsh-spss/styles'

export const CSS = String.raw`
.dsh-spss-page {
  --sp-bg: var(--dsw-alias-bg-base, #fff);
  --sp-surface: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, .028));
  --sp-surface-2: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, .05));
  --sp-ink: var(--dsw-alias-label-primary, #1a1a1a);
  --sp-ink-2: var(--dsw-alias-label-secondary, #4d4d4d);
  --sp-ink-3: var(--dsw-alias-label-tertiary, #7a7a7a);
  --sp-caption: var(--dsw-alias-label-caption, #a3a3a3);
  --sp-border: var(--dsw-alias-border-l2, rgba(0, 0, 0, .12));
  --sp-border-soft: var(--dsw-alias-border-l1, rgba(0, 0, 0, .07));
  --sp-hover: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05));
  --sp-active: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, .08));
  --sp-accent: var(--dsw-alias-state-business-primary, #4d6bfe);
  --sp-danger: var(--dsw-alias-state-error-primary, #d33);
  --sp-success: var(--dsw-alias-state-success-primary, #2f9e63);
  --sp-warning: var(--dsw-alias-state-warning-primary, #cf8a1f);
  --sp-font: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  --sp-mono: var(--dsw-font-family-code, ui-monospace, "SF Mono", Menlo, monospace);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--sp-ink);
  background: var(--sp-bg);
  font: 14px/1.6 var(--sp-font);
}

.dsh-spss-page *,
.dsh-spss-page *::before,
.dsh-spss-page *::after {
  box-sizing: border-box;
}

.dsh-spss-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.dsh-spss-scroll::-webkit-scrollbar {
  width: 11px;
  height: 11px;
}

.dsh-spss-scroll::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, .18));
  background-clip: padding-box;
}

.dsh-spss-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(0, 0, 0, .3));
  background-clip: padding-box;
}

.dsh-spss-doc {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 clamp(18px, 4vw, 44px) 84px;
}

/* --------------------------------------------------------------- header */

.dsh-spss-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-top: calc(26px + var(--dsh-frame-top-clearance, 0px));
}

.dsh-spss-heading {
  min-width: 0;
}

.dsh-spss-heading h1 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 25px;
  font-weight: 600;
  line-height: 1.22;
  letter-spacing: -.025em;
}

.dsh-spss-heading h1 svg {
  flex: none;
  color: var(--sp-accent);
}

.dsh-spss-sub {
  margin: 7px 0 0;
  max-width: 64ch;
  color: var(--sp-ink-3);
  font-size: 13px;
  line-height: 1.55;
}

.dsh-spss-tools {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: none;
  padding-top: 3px;
}

/* ---------------------------------------------------------------- chips */

.dsh-spss-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 999px;
  background: var(--sp-surface);
  color: var(--sp-ink-2);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.dsh-spss-chip::before {
  content: "";
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--sp-caption);
}

.dsh-spss-chip[data-state="ok"]::before {
  background: var(--sp-success);
}

.dsh-spss-chip[data-state="error"]::before {
  background: var(--sp-danger);
}

.dsh-spss-chip[data-state="warn"]::before {
  background: var(--sp-warning);
}

.dsh-spss-chip[data-state="pending"]::before {
  background: var(--sp-accent);
  animation: dsh-spss-pulse 1.1s ease-in-out infinite;
}

.dsh-spss-chip[data-mono="true"] {
  font-family: var(--sp-mono);
  font-size: 11.5px;
}

/* -------------------------------------------------------------- buttons */

.dsh-spss-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 9px;
  background: transparent;
  color: var(--sp-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
}

.dsh-spss-btn svg {
  flex: none;
}

.dsh-spss-btn:not(:disabled):hover {
  background: var(--sp-hover);
}

.dsh-spss-btn:not(:disabled):active {
  background: var(--sp-active);
}

.dsh-spss-btn:disabled {
  cursor: default;
  opacity: .5;
}

.dsh-spss-btn-primary {
  border-color: transparent;
  background: var(--sp-accent);
  color: #fff;
  font-weight: 600;
}

.dsh-spss-btn-primary:not(:disabled):hover {
  background: var(--sp-accent);
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.dsh-spss-btn-primary:not(:disabled):active {
  background: var(--sp-accent);
  filter: brightness(.96);
}

.dsh-spss-btn-lg {
  min-height: 40px;
  padding: 0 22px;
  border-radius: 11px;
  font-size: 13.5px;
}

.dsh-spss-btn-quiet {
  border-color: transparent;
  color: var(--sp-ink-3);
  padding: 0 10px;
}

.dsh-spss-btn-quiet:not(:disabled):hover {
  color: var(--sp-ink);
}

.dsh-spss-icon-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--sp-ink-3);
  cursor: pointer;
  flex: none;
  transition: background .14s ease, color .14s ease;
}

.dsh-spss-icon-btn:not(:disabled):hover {
  background: var(--sp-hover);
  color: var(--sp-ink);
}

.dsh-spss-icon-btn:disabled {
  cursor: default;
  opacity: .5;
}

.dsh-spss-spin {
  animation: dsh-spss-spin .9s linear infinite;
}

/* ------------------------------------------------------------- sections */

.dsh-spss-section {
  margin-top: 26px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 16px;
  background: var(--sp-bg);
  overflow: hidden;
}

.dsh-spss-section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 15px 20px 0;
}

.dsh-spss-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 21px;
  height: 21px;
  flex: none;
  border-radius: 50%;
  background: var(--sp-surface-2);
  color: var(--sp-ink-2);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  align-self: center;
}

.dsh-spss-section-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -.01em;
  align-self: center;
}

.dsh-spss-section-note {
  color: var(--sp-ink-3);
  font-size: 12.5px;
  line-height: 1.5;
}

.dsh-spss-section-body {
  padding: 16px 20px 20px;
}

.dsh-spss-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dsh-spss-row-grow {
  flex: 1;
  min-width: 0;
}

.dsh-spss-label {
  display: block;
  margin: 0 0 6px;
  color: var(--sp-ink-2);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.dsh-spss-field {
  margin-top: 4px;
}

.dsh-spss-field + .dsh-spss-field {
  margin-top: 14px;
}

/* --------------------------------------------------------------- inputs */

.dsh-spss-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--sp-border);
  border-radius: 9px;
  background: var(--sp-bg);
  color: var(--sp-ink);
  font: inherit;
  font-size: 12.5px;
  line-height: 1;
  transition: border-color .14s ease, box-shadow .14s ease;
}

.dsh-spss-input::placeholder {
  color: var(--sp-caption);
  opacity: 1;
}

.dsh-spss-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--sp-accent) 60%, var(--sp-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sp-accent) 16%, transparent);
}

.dsh-spss-input[data-mono="true"] {
  font-family: var(--sp-mono);
  font-size: 12px;
  letter-spacing: -.01em;
}

.dsh-spss-input:disabled {
  background: var(--sp-surface);
  color: var(--sp-ink-3);
  cursor: default;
}

.dsh-spss-select {
  height: 34px;
  max-width: 100%;
  padding: 0 30px 0 11px;
  border: 1px solid var(--sp-border);
  border-radius: 9px;
  background-color: var(--sp-bg);
  background-image: linear-gradient(45deg, transparent 50%, var(--sp-ink-3) 50%),
    linear-gradient(135deg, var(--sp-ink-3) 50%, transparent 50%);
  background-position: calc(100% - 15px) 14px, calc(100% - 10px) 14px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  color: var(--sp-ink);
  font: inherit;
  font-size: 12.5px;
  appearance: none;
  cursor: pointer;
}

.dsh-spss-select:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--sp-accent) 60%, var(--sp-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sp-accent) 16%, transparent);
}

.dsh-spss-select:disabled {
  opacity: .55;
  cursor: default;
}

.dsh-spss-num {
  width: 92px;
  flex: none;
  font-variant-numeric: tabular-nums;
}

/* ----------------------------------------------------------- form rows */

.dsh-spss-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dsh-spss-check {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 11px 0 9px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 9px;
  background: var(--sp-surface);
  color: var(--sp-ink-2);
  font-size: 12.5px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: border-color .14s ease, background .14s ease, color .14s ease;
}

.dsh-spss-check:hover {
  background: var(--sp-hover);
  color: var(--sp-ink);
}

.dsh-spss-check[data-checked="true"] {
  border-color: color-mix(in srgb, var(--sp-accent) 45%, transparent);
  background: color-mix(in srgb, var(--sp-accent) 10%, var(--sp-bg));
  color: var(--sp-ink);
}

/* The real checkbox drives state and keyboard access, but must never paint or
 * take layout. It is pinned inside its own label, which is position: relative,
 * so it cannot escape to an outer scroll container and drag the viewport with
 * it when focused — that escape scrolled the whole panel out of view. */
.dsh-spss-check input {
  position: absolute;
  inset: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.dsh-spss-tick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex: none;
  border: 1.5px solid var(--sp-caption);
  border-radius: 4.5px;
  color: transparent;
  transition: background .12s ease, border-color .12s ease, color .12s ease;
}

.dsh-spss-check[data-checked="true"] .dsh-spss-tick {
  border-color: var(--sp-accent);
  background: var(--sp-accent);
  color: #fff;
}

.dsh-spss-check:has(input:focus-visible) .dsh-spss-tick {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sp-accent) 26%, transparent);
}

.dsh-spss-check[data-disabled="true"] {
  cursor: default;
  opacity: .5;
}

/* ------------------------------------------------------- type chooser */

.dsh-spss-types {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
  gap: 8px;
}

.dsh-spss-type {
  position: relative;
  display: block;
  padding: 9px 11px 10px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 11px;
  background: var(--sp-bg);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .14s ease, background .14s ease, box-shadow .14s ease;
}

.dsh-spss-type:hover {
  background: var(--sp-hover);
}

.dsh-spss-type[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--sp-accent) 55%, transparent);
  background: color-mix(in srgb, var(--sp-accent) 9%, var(--sp-bg));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sp-accent) 30%, transparent);
}

.dsh-spss-type-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--sp-ink);
}

.dsh-spss-type-name svg {
  flex: none;
  color: var(--sp-accent);
  opacity: 0;
  transition: opacity .14s ease;
}

.dsh-spss-type[aria-pressed="true"] .dsh-spss-type-name svg {
  opacity: 1;
}

.dsh-spss-type-desc {
  margin: 3px 0 0;
  color: var(--sp-ink-3);
  font-size: 11.5px;
  line-height: 1.45;
}

/* ------------------------------------------------------ variable chips */

.dsh-spss-vars-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.dsh-spss-vars-meta {
  color: var(--sp-ink-3);
  font-size: 11.5px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}

.dsh-spss-vargroups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 236px;
  overflow: auto;
  padding: 10px 11px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 11px;
  background: var(--sp-surface);
  scrollbar-width: thin;
}

.dsh-spss-vargroup-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 6px;
  color: var(--sp-caption);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.dsh-spss-vargroup-rule {
  flex: 1;
  height: 1px;
  background: var(--sp-border-soft);
}

.dsh-spss-varlist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dsh-spss-var {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 27px;
  padding: 0 9px 0 7px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 999px;
  background: var(--sp-bg);
  color: var(--sp-ink-2);
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
  transition: border-color .12s ease, background .12s ease, color .12s ease;
}

.dsh-spss-var:hover {
  background: var(--sp-hover);
  color: var(--sp-ink);
}

.dsh-spss-var[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--sp-accent) 50%, transparent);
  background: color-mix(in srgb, var(--sp-accent) 12%, var(--sp-bg));
  color: var(--sp-ink);
  font-weight: 500;
}

.dsh-spss-var[disabled] {
  cursor: default;
  opacity: .42;
}

.dsh-spss-var-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  flex: none;
  border-radius: 4px;
  background: var(--sp-surface-2);
  color: var(--sp-ink-3);
  font-family: var(--sp-mono);
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1;
}

.dsh-spss-var[aria-pressed="true"] .dsh-spss-var-badge {
  background: color-mix(in srgb, var(--sp-accent) 22%, transparent);
  color: var(--sp-accent);
}

.dsh-spss-var-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-spss-vars-empty {
  padding: 22px 14px;
  color: var(--sp-ink-3);
  font-size: 12.5px;
  line-height: 1.6;
  text-align: center;
}

/* -------------------------------------------------------------- options */

.dsh-spss-options {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--sp-border-soft);
}

.dsh-spss-opt {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.dsh-spss-opt-label {
  color: var(--sp-ink-3);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.3;
}

/* --------------------------------------------------------------- hints */

.dsh-spss-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 10px 0 0;
  color: var(--sp-ink-3);
  font-size: 12px;
  line-height: 1.5;
}

.dsh-spss-hint svg {
  flex: none;
  margin-top: 2px;
}

.dsh-spss-hint[data-tone="warn"] {
  color: color-mix(in srgb, var(--sp-warning) 78%, var(--sp-ink));
}

.dsh-spss-hint[data-tone="error"] {
  color: var(--sp-danger);
}

.dsh-spss-path {
  font-family: var(--sp-mono);
  font-size: 11.5px;
  word-break: break-all;
  line-height: 1.55;
}

.dsh-spss-muted {
  color: var(--sp-ink-3);
}

.dsh-spss-banner {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 14px;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--sp-warning) 34%, var(--sp-border-soft));
  border-radius: 11px;
  background: color-mix(in srgb, var(--sp-warning) 7%, var(--sp-bg));
  color: var(--sp-ink-2);
  font-size: 12.5px;
  line-height: 1.55;
}

.dsh-spss-banner svg {
  flex: none;
  margin-top: 2px;
  color: var(--sp-warning);
}

.dsh-spss-banner[data-tone="error"] {
  border-color: color-mix(in srgb, var(--sp-danger) 32%, var(--sp-border-soft));
  background: color-mix(in srgb, var(--sp-danger) 6%, var(--sp-bg));
}

.dsh-spss-banner[data-tone="error"] svg {
  color: var(--sp-danger);
}

.dsh-spss-banner p {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.dsh-spss-banner button {
  flex: none;
  padding: 1px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.dsh-spss-banner button:hover {
  background: var(--sp-hover);
}

/* ------------------------------------------------------------- empty */

.dsh-spss-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  margin-top: 14px;
  padding: 44px 22px 46px;
  border: 1px dashed var(--sp-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--sp-surface) 60%, transparent);
  text-align: center;
}

.dsh-spss-empty-icon {
  display: inline-flex;
  margin-bottom: 9px;
  color: var(--sp-caption);
}

.dsh-spss-empty h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}

.dsh-spss-empty p {
  max-width: 42ch;
  margin: 5px 0 0;
  color: var(--sp-ink-3);
  font-size: 12.5px;
  line-height: 1.6;
}

.dsh-spss-empty-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 16px;
}

/* ------------------------------------------------------------ dataset */

.dsh-spss-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0 0;
}

.dsh-spss-varchips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
}

.dsh-spss-varchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 6px;
  background: var(--sp-surface);
  color: var(--sp-ink-2);
  font-family: var(--sp-mono);
  font-size: 11px;
  line-height: 1.6;
}

.dsh-spss-varchip em {
  color: var(--sp-caption);
  font-family: var(--sp-font);
  font-style: normal;
  font-size: 10px;
}

/* -------------------------------------------------------------- tables */

.dsh-spss-tablewrap {
  margin-top: 10px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 11px;
  overflow: auto;
  max-height: 460px;
  background: var(--sp-bg);
}

.dsh-spss-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.dsh-spss-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 11px;
  border-bottom: 1px solid var(--sp-border);
  background: var(--sp-surface-2);
  color: var(--sp-ink-2);
  font-size: 11px;
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
  letter-spacing: .01em;
}

.dsh-spss-table thead th:first-child,
.dsh-spss-table tbody td:first-child {
  text-align: left;
}

.dsh-spss-table thead th[data-sticky="true"] {
  left: 0;
  z-index: 2;
  border-right: 1px solid var(--sp-border-soft);
}

.dsh-spss-table tbody td {
  padding: 6px 11px;
  border-bottom: 1px solid var(--sp-border-soft);
  color: var(--sp-ink);
  text-align: right;
  white-space: nowrap;
}

.dsh-spss-table tbody td[data-sticky="true"] {
  position: sticky;
  left: 0;
  background: var(--sp-bg);
  border-right: 1px solid var(--sp-border-soft);
}

.dsh-spss-table tbody tr:last-child td {
  border-bottom: 0;
}

.dsh-spss-table tbody tr:hover td {
  background: var(--sp-hover);
}

.dsh-spss-table tbody tr:hover td[data-sticky="true"] {
  background: color-mix(in srgb, var(--sp-hover) 100%, var(--sp-bg));
}

.dsh-spss-table td[data-mono="true"] {
  font-family: var(--sp-mono);
  font-size: 11.5px;
  text-align: left;
}

.dsh-spss-table-note {
  margin: 10px 0 0;
  color: var(--sp-ink-3);
  font-size: 11.5px;
  line-height: 1.55;
}

/* ------------------------------------------------------------- results */

.dsh-spss-analysis {
  padding: 16px 0 4px;
}

.dsh-spss-analysis + .dsh-spss-analysis {
  border-top: 1px solid var(--sp-border-soft);
}

.dsh-spss-analysis-head {
  display: flex;
  align-items: baseline;
  gap: 9px;
  flex-wrap: wrap;
}

.dsh-spss-analysis-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}

.dsh-spss-analysis-type {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--sp-surface-2);
  color: var(--sp-ink-3);
  font-family: var(--sp-mono);
  font-size: 10px;
  line-height: 1.5;
}

.dsh-spss-tabtitle {
  margin: 12px 0 0;
  color: var(--sp-ink-2);
  font-size: 12px;
  font-weight: 600;
}

.dsh-spss-analysis-note {
  margin: 10px 0 0;
  padding: 8px 11px;
  border-left: 2px solid var(--sp-border);
  border-radius: 0 7px 7px 0;
  background: var(--sp-surface);
  color: var(--sp-ink-2);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.dsh-spss-analysis-note[data-tone="error"] {
  border-left-color: var(--sp-danger);
  color: var(--sp-danger);
}

.dsh-spss-chart {
  display: block;
  max-width: 100%;
  margin: 12px 0 0;
  border: 1px solid var(--sp-border-soft);
  border-radius: 9px;
  background: var(--sp-bg);
}

/* ------------------------------------------------------------- outputs */

.dsh-spss-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.dsh-spss-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 9px;
  background: var(--sp-bg);
}

.dsh-spss-file-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 21px;
  flex: none;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--sp-surface-2);
  color: var(--sp-ink-2);
  font-family: var(--sp-mono);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  text-transform: uppercase;
}

.dsh-spss-file-main {
  flex: 1;
  min-width: 0;
}

.dsh-spss-file-name {
  display: block;
  overflow: hidden;
  color: var(--sp-ink);
  font-size: 12.5px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-spss-file-path {
  display: block;
  overflow: hidden;
  color: var(--sp-caption);
  font-family: var(--sp-mono);
  font-size: 10.5px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-spss-willwrite {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.dsh-spss-willwrite code {
  padding: 2px 7px;
  border: 1px dashed var(--sp-border);
  border-radius: 6px;
  color: var(--sp-ink-3);
  font-family: var(--sp-mono);
  font-size: 10.5px;
  line-height: 1.7;
  word-break: break-all;
}

/* ---------------------------------------------------------------- run */

.dsh-spss-runbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 22px;
  padding: 14px 18px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 14px;
  background: var(--sp-surface);
}

.dsh-spss-runbar-state {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--sp-ink-3);
  font-size: 12.5px;
  line-height: 1.5;
}

.dsh-spss-runbar-state[data-tone="error"] {
  color: var(--sp-danger);
}

.dsh-spss-runbar-state svg {
  flex: none;
}

/* --------------------------------------------------------------- misc */

.dsh-spss-log {
  margin: 12px 0 0;
  padding: 11px 13px;
  border: 1px solid var(--sp-border-soft);
  border-radius: 9px;
  background: var(--sp-surface);
  color: var(--sp-ink-2);
  font-family: var(--sp-mono);
  font-size: 11px;
  line-height: 1.7;
  max-height: 190px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.dsh-spss-details {
  margin-top: 12px;
}

.dsh-spss-details summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  color: var(--sp-ink-3);
  font-size: 12px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.dsh-spss-details summary::-webkit-details-marker {
  display: none;
}

.dsh-spss-details summary:hover {
  color: var(--sp-ink);
}

.dsh-spss-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.dsh-spss-skeleton span {
  display: block;
  height: 11px;
  border-radius: 5px;
  background: linear-gradient(90deg, var(--sp-surface) 0%, var(--sp-surface-2) 50%, var(--sp-surface) 100%);
  background-size: 200% 100%;
  animation: dsh-spss-shimmer 1.3s ease-in-out infinite;
}

.dsh-spss-skeleton span:nth-child(2) { width: 82%; }
.dsh-spss-skeleton span:nth-child(3) { width: 64%; }

.dsh-spss-recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.dsh-spss-recent-dir {
  margin: 2px 0 10px;
  color: var(--sp-caption);
  font-family: var(--sp-mono);
  font-size: 10.5px;
  line-height: 1.5;
  word-break: break-all;
}

.dsh-spss-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 500;
  max-width: min(560px, calc(100vw - 40px));
  padding: 9px 15px;
  border: 1px solid var(--sp-border);
  border-radius: 999px;
  background: var(--dsw-specific-menu, var(--sp-bg));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(24px) saturate(150%));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(24px) saturate(150%));
  box-shadow: 0 8px 28px rgba(0, 0, 0, .16), 0 2px 6px rgba(0, 0, 0, .08);
  color: var(--sp-ink);
  font: 12.5px/1.45 var(--sp-font);
  transform: translateX(-50%);
  animation: dsh-spss-toast-in .2s cubic-bezier(.2, .75, .3, 1) both;
}

/* ------------------------------------------------------------- focus */

.dsh-spss-page :focus-visible {
  outline: 2px solid var(--sp-accent);
  outline-offset: 2px;
}

.dsh-spss-page .dsh-spss-input:focus-visible,
.dsh-spss-page .dsh-spss-select:focus-visible {
  outline: none;
}

.dsh-spss-page ::selection {
  background: color-mix(in srgb, var(--sp-accent) 24%, transparent);
}

/* artwork shading only; chrome follows the tokens above */
body[data-ds-dark-theme] .dsh-spss-empty-icon,
body[data-ds-dark-theme] .dsh-spss-empty,
body[data-ds-dark-theme] .dsh-spss-vargroups {
  background: color-mix(in srgb, var(--sp-surface) 38%, transparent);
}

body[data-ds-dark-theme] .dsh-spss-skeleton span {
  background: linear-gradient(90deg, var(--sp-surface) 0%, var(--sp-surface-2) 50%, var(--sp-surface) 100%);
  background-size: 200% 100%;
}

/* --------------------------------------------------------- responsive */

@media (max-width: 780px) {
  .dsh-spss-topbar {
    flex-direction: column;
    gap: 13px;
  }

  .dsh-spss-types {
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  }

  .dsh-spss-section-body {
    padding: 14px 14px 16px;
  }

  .dsh-spss-section-head {
    padding: 13px 14px 0;
  }

  .dsh-spss-tablewrap {
    max-height: 340px;
  }
}

@media (max-width: 520px) {
  .dsh-spss-heading h1 {
    font-size: 22px;
  }

  .dsh-spss-runbar {
    flex-direction: column;
    align-items: stretch;
  }

  .dsh-spss-btn-lg {
    width: 100%;
  }
}

@keyframes dsh-spss-spin {
  to { transform: rotate(360deg); }
}

@keyframes dsh-spss-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}

@keyframes dsh-spss-shimmer {
  from { background-position: 140% 0; }
  to { background-position: -40% 0; }
}

@keyframes dsh-spss-toast-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-spss-page *,
  .dsh-spss-page *::before,
  .dsh-spss-page *::after {
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
