import { applyD1Migrations, env } from "cloudflare:test";

// Applies the same migrations used in production (src/db/migrations) to the
// local, isolated D1 instance Miniflare spins up for tests. The migration
// list is injected as a binding from vitest.config.ts.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS as Parameters<typeof applyD1Migrations>[1]);
