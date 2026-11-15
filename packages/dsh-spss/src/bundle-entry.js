/**
 * Bundle entry: re-exports the client half so the CJS build exposes
 * `{ name, inject, apply }` for the module-loader factory.
 */
export { name, inject, apply, __test } from './client.js'
