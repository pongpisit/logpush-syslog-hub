import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, "src/db/migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      coverage: {
        provider: "istanbul",
        reporter: ["text", "lcov"],
        include: ["src/**/*.ts"],
        exclude: ["src/db/migrations/**", "src/index.ts"],
      },
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              INGEST_SECRET: "test-ingest-secret",
              ADMIN_SECRET: "test-admin-secret",
            },
          },
        },
      },
    },
  };
});
