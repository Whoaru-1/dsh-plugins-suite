# dsh-file-tray

A produced-files tray for the DSH Web conversation header, in one client plugin.
It reads the conversation's own record of what it wrote, so the list cannot
invent a file — and clicking a row opens that file in the right-side preview.

The document preview itself is **not** modified: an earlier revision also tried
to fit and then to zoom workspace images, and both versions were withdrawn. See
[section 2](#2-the-document-preview-is-deliberately-untouched).

## 1. A produced-files tray in the conversation header's top-right corner

Every file the current conversation **wrote or edited** gets one row in a tray
button that sits in the conversation header's right-aligned utilities strip,
beside the session-log and open-in-app controls:

- the button shows a document mark plus the file count, and renders **nothing**
  until the conversation has produced a file, so an empty session's header is
  unchanged;
- clicking it opens a popover listing every file: one row per file with a
  kind icon, the file name, and its directory;
- **clicking a row opens that file** in the right-side document preview (the
  same surface the transcript's own file links use), and closes the popover;
- `全部打开` opens the whole list, `清空` forgets the list, `Esc` / a click
  outside / scrolling closes the popover;
- a search field appears once the list passes six rows.

The expanded card is **frosted**, not opaque: it paints the theme's own menu
surface, which already carries alpha (≈45% in dark, ≈58% in light), plus the
theme's menu backdrop blur. A hovered row uses a softened wash so it never reads
as a second opaque card inside it; the fallbacks are equally translucent, so a
missing theme token degrades to a frosted card rather than an opaque one.

### Where the list comes from

The rows are the official **`deliverables`** conversation projection — the same
source the built-in "本轮文件改动" row reads: successful `write`, `edit`, and
mutating `str_replace_editor` calls. Reads, failed calls, malformed calls, and
the closing prose contribute nothing, so the tray cannot invent a file the
model never wrote.

The projection is published per turn, so one invisible turn-tail seat
(`conversation.chat.turnTail`, renders no DOM) feeds a module-level per-session
ledger, and the header button aggregates the whole conversation from it. A path
written in turn 2 and edited in turn 5 stays listed once, under turn 2.

### Why not the far-right header corner

`conversation.session.header.corner` is a **single-occupancy** slot and the
sidebar-right plugin already holds it with the column's expand button. A second
registration there would shadow that control, so the tray shares the
`…header.utilities` list instead — still the header's top-right group, and it
can appear and disappear without disturbing anything else.

## 2. The document preview is deliberately untouched

An earlier revision of this plugin also changed the workspace image preview —
first by clamping images into the pane, then by turning the pane into a zoomable
viewer. Both were withdrawn: the preview keeps exactly the behaviour the bundled
`ui-sidebar-documentpreview` gives it, with no stylesheet, no listeners, and no
observers from this plugin.

The only trace that survives is hygiene: a build between those revisions
appended a `<style data-plugin-css="dsh-file-tray/image-fit">` to the document,
and a browser tab still running it would keep that sheet after the plugin
reloads. `retireImagePreviewLayer()` removes exactly that sheet (identified by
both the marker and this plugin's id) on install, so one reload lands on the
bundled behaviour. It touches nothing else.

## Layout

```
index.js                  host half: mounts the row, writes a boot proof
cordis.patch.yml          bundle layer: the loader insert row
lib/client.js             built browser bundle (do not edit)
src/files.js              pure produced-path + address + kind helpers
src/store.js              per-session produced-file ledger
src/image-fit.js          retirement of the withdrawn preview stylesheet
src/client.js             the tray component and the turn-tail recorder
scripts/build.mjs         esbuild bundle build
scripts/test.mjs          pure-logic harness (paths, ledger)
scripts/test-wiring.cjs   wiring harness (bundle contract, slots, tray render)
scripts/test-open.cjs     popover harness under real React (event sequence)
scripts/test-e2e.cjs      end-to-end harness under real React (mount, click, open)
```

## Install

```sh
cd ~/.dsh/profiles/<profile>
npm install --save "dsh-file-tray@link:/absolute/path/to/packages/dsh-file-tray"
```

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-file-tray
      name: 'dsh-file-tray'
```

Then **fully restart DSH**. The desktop profile is startup-only, so a row added
while it runs does not reach the browser boot graph until restart.

## Development

```sh
npm run build     # rebuild lib/client.js from src/
npm test          # all four harnesses
```

`test-open.cjs` and `test-e2e.cjs` run the real component under React 18 in
jsdom; they are the ones that catch interaction bugs, not just contract drift.
The popover arms its outside-press dismissal one task after opening: arming it
inside the opening task lets the tail of the opening gesture dismiss the
popover, which reads as a dead button. The same harness also asserts the card's
frosted treatment (translucent theme surface + backdrop blur, and never element
`opacity`, which would dim the rows instead of the card).

The host half writes `$DSH_HOME/dsh-file-tray.boot.json` when the running server
mounts the row — its absence means the row has not reached the browser boot
graph yet.
