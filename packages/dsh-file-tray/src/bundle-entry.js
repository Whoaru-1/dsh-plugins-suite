/**
 * Bundle entry: re-exports the client half so the CJS build exposes
 * `{ name, inject, apply }` for the module-loader factory.
 *
 * `__test` rides along for the offline harness; the loader reads only `name`,
 * `inject`, and `apply`. `retireImagePreviewLayer` cleans up a stylesheet left
 * by an earlier build that styled the document preview.
 */
export { name, inject, apply, __test } from './client.js'
export { retireImagePreviewLayer } from './image-fit.js'
