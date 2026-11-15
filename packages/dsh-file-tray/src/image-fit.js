/**
 * dsh-file-tray — the image-preview layer, retired.
 *
 * History
 * -------
 * This module used to alter the workspace image preview: first by clamping
 * images into the pane, then by turning the pane into a zoomable viewer. Both
 * changed how a file preview behaves, and both were withdrawn at the user's
 * request. The bundled preview is the reference behaviour again.
 *
 * What it does now
 * ----------------
 * Nothing to the preview. It exists for one reason: an earlier build appended a
 * `<style data-plugin-css="dsh-file-tray/image-fit">` to the document, and a
 * browser tab that is still running that build would keep the sheet after the
 * plugin reloads. `retireImagePreviewLayer` removes any such leftover sheet so
 * a reload cannot leave the preview half-styled.
 */

/** The style element identity every earlier build of this plugin used. */
const STYLE_ID = 'dsh-file-tray/image-fit'

/**
 * Remove a stylesheet left behind by an earlier build of this plugin.
 *
 * Safe to call on every install: with no such element it does nothing. Only the
 * sheet this plugin itself stamped is touched, identified by both the marker
 * attribute and the plugin id.
 * @returns the number of sheets removed.
 */
export function retireImagePreviewLayer() {
  if (typeof document === 'undefined' || document.head === null) return 0
  let removed = 0
  for (const tag of document.querySelectorAll(`style[data-plugin-css="${STYLE_ID}"]`)) {
    if (tag.dataset?.plugin === 'dsh-file-tray') {
      tag.remove()
      removed += 1
    }
  }
  return removed
}
