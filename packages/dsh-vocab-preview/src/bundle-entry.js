/**
 * Bundle entry: re-exports the client half so the CJS build exposes
 * `{ name, inject, apply }` for the module-loader factory.
 *
 * `__test` rides along for the offline harness (`scripts/test.mjs`); the loader
 * reads only `name`, `inject`, and `apply`.
 */
export { name, inject, apply, __test } from './client.js'
