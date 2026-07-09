export {};

/**
 * Secrets are set at runtime via `wrangler secret put` and are intentionally
 * NOT declared in wrangler.jsonc (see workers-best-practices: never hardcode
 * secrets in config). `wrangler types` therefore cannot infer them, so we
 * augment the generated global `Env` interface here.
 */
declare global {
  interface Env {
    INGEST_SECRET: string;
    ADMIN_SECRET: string;
  }
}
