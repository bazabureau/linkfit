/**
 * Per-suite setup hook. Currently a no-op — globalSetup spins the container
 * once for the whole run and exposes TEST_DATABASE_URL. Each test that needs
 * a DB handle uses `tests/helpers/db.ts` to build one against that URL.
 *
 * If we later add per-suite schema reset/truncate behaviour, it lives here.
 */
export {};
