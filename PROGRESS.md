# Project Progress

**Goal**: Open-source Cloudflare Worker that receives Logpush batches, converts them to
CEF-over-syslog, and forwards over TCP to one or more configurable syslog/SIEM
destinations, with a web UI for managing destinations and field mappings.

**Mode**: MVP
**Account**: aa8ab6fe5b7f906df426a972033e922a (Pongpisit Demo account)

## Tasks

- [x] 1. Monorepo scaffold (pnpm workspaces: apps/api, apps/web)
- [x] 2. Cloudflare resources
  - [x] 2.1 D1 database `logpush-syslog-hub-db` created
  - [x] 2.2 Queue `logpush-syslog-queue` + DLQ `logpush-syslog-queue-dlq` created
  - [x] 2.3 D1 migrations written (destinations, mappings, destination_status) + seeded generic mappings
  - [ ] 2.4 Workers VPC Network binding (left commented out in wrangler.jsonc; needs a real Cloudflare Tunnel ID from the user)
- [x] 3. Shared package: Zod schemas + generic CEF default mappings (http_requests, firewall_events)
- [x] 4. API (Hono Worker)
  - [x] 4.1 `/health`
  - [x] 4.2 `/ingest/:dataset` (gzip NDJSON, streaming parse, timing-safe bearer auth, enqueues to Queue)
  - [x] 4.3 Queue consumer (CEF format, RFC 6587/newline framing, TCP send via `cloudflare:sockets` or VPC binding, retry + DLQ)
  - [x] 4.4 `/admin/*` CRUD for destinations + mappings, status, test-send
- [x] 5. Tests: 51 tests, ~89% statement / ~93% line coverage (vitest + @cloudflare/vitest-pool-workers)
- [x] 6. Web UI (React + Vite + Tailwind): Dashboard, Destinations, Mappings, Settings gate
- [x] 7. Docs: README, LICENSE (MIT), PROGRESS.md
- [x] 8. GitHub Actions CI (typecheck + test) — https://github.com/pongpisit/logpush-syslog-hub/actions
- [x] 9. Pushed to public GitHub repo — https://github.com/pongpisit/logpush-syslog-hub
- [x] 10. Deployed to Cloudflare and verified end-to-end:
  - API: https://logpush-syslog-hub.pongpisit.workers.dev (`/health` returns `{"status":"ok",...}`)
  - Web UI: https://logpush-syslog-hub-web.pongpisit.workers.dev (Workers static assets, not Pages)
  - Verified live: admin CRUD, ingest gzip/NDJSON parsing + auth, CEF test-send against
    an unreachable destination (confirmed fast, correct error handling, no hangs)
  - Found + fixed in production testing: duplicate `rt=` CEF key, and a Workers-runtime
    gotcha where `Date.now()` computed at module scope returns 0 (see migration 0002 and
    the `fix:` commit)
- [x] 11. Added "Deploy to Cloudflare" buttons for one-click deploy:
  - Removed `packages/shared`; vendored its contents into
    `apps/api/src/shared/` (Zod schemas + CEF defaults, used at runtime) and
    `apps/web/src/types.ts` (plain TS interfaces, no runtime deps). Required
    because Cloudflare's Deploy to Cloudflare button needs each Worker's
    subdirectory to be fully isolated, including dependencies — a pnpm
    workspace `workspace:*` dependency breaks that.
  - Verified isolation for real: copied each app to a scratch directory with
    no sibling packages, ran `npm install` (not pnpm) from scratch, then
    `tsc --noEmit`, the full test suite, and `wrangler deploy --dry-run` —
    all passed for both apps.
  - `apps/api`'s `deploy` script now runs `wrangler d1 migrations apply DB
    --remote` before `wrangler deploy` (binding name, not database name, per
    Cloudflare's guidance, so it works regardless of what the button
    auto-provisions the database as) — verified against the live account.
  - Added `cloudflare.bindings.*.description` to `apps/api/package.json` so
    the button's setup screen shows friendly prompts for `INGEST_SECRET` and
    `ADMIN_SECRET`.
- [x] 12. Merged the API and web UI into a **single Worker project** (user
  decision: project is small enough that two separate deployments added
  more overhead than value):
  - Flattened the monorepo: `apps/api/*` → project root (`src/`, `test/`,
    `tsconfig.json`, `vitest.config.ts`), `apps/web/*` → `ui/`. Removed
    `apps/`, `pnpm-workspace.yaml`; single root `package.json` and
    `wrangler.jsonc`.
  - `wrangler.jsonc` now has an `assets` block (`directory: "./dist"`,
    `binding: "ASSETS"`, `run_worker_first: true`,
    `not_found_handling: "single-page-application"`) alongside the existing
    `main` Worker script — one Worker serves both.
  - Moved all API routes under `/api/*` (`/api/health`, `/api/ingest/:dataset`,
    `/api/admin/*`). In `src/index.ts`, unmatched `/api/*` requests return a
    JSON 404; every other unmatched request defers to
    `env.ASSETS.fetch(request)`, which serves the React SPA (and falls back
    to `index.html` for client-side routes like `/destinations`).
  - Removed CORS entirely (`hono/cors`, `ADMIN_ALLOWED_ORIGIN`) — UI and API
    are now same-origin.
  - Simplified the web UI: removed the "API base URL" setting; `ui/src/api.ts`
    now calls relative `/api/*` paths. Settings screen only asks for
    `ADMIN_SECRET`.
  - `ui/vite.config.ts` builds to `../dist` (project root) instead of
    `ui/dist`; both `npm run build` and `npm run dev:ui` `cd` into `ui/`
    first so Tailwind/PostCSS's cosmiconfig-based config discovery (which
    only searches upward from cwd, not into subdirectories) finds
    `ui/tailwind.config.js` and `ui/postcss.config.js`.
  - Added `pretest: npm run build` — the Worker's `assets.directory` must
    exist on disk before `@cloudflare/vitest-pool-workers` can start
    Miniflare, so tests build the UI first automatically.
  - `npm run deploy` = build UI → apply D1 migrations (`--remote`) →
    `wrangler deploy`.
  - Verified for real, not just in-repo: ran `wrangler dev` locally and
    curl-tested every path class — `/api/health` (JSON), `/` and
    `/destinations` (SPA `index.html`, 200), `/api/nonexistent` (JSON 404),
    `/api/admin/*` without/with the bearer token (401 / 200), and the built
    JS/CSS asset URLs (200, correct content-type). All 52 tests still pass;
    `tsc --noEmit` passes for the Worker, `test/`, and `ui/` separately.
  - **Not yet done**: redeploy the merged Worker to the live account and
    verify in production; decide whether to delete the now-redundant
    `logpush-syslog-hub-web` Worker.

## Notes / Decisions

- Transport scope for v1: **TCP only, no TLS, no UDP** (explicit user decision).
- CEF mapping: generic, vendor-agnostic default mappings using only standard CEF keys
  so output works with any CEF-aware SIEM or generic syslog receiver without customization.
- Admin auth: shared `ADMIN_SECRET` bearer token for MVP (Cloudflare Access deferred to roadmap).
- One `SYSLOG_VPC` Workers VPC Network binding is shared across all `transport=vpc`
  destinations (VPC Networks route by runtime address, unlike VPC Services).

## Security Checklist

- [x] Secrets (`INGEST_SECRET`, `ADMIN_SECRET`) via `wrangler secret put`, never hardcoded
- [x] Zod validation on all admin/ingest inputs
- [x] Timing-safe bearer token comparison (SHA-256 digest + `crypto.subtle.timingSafeEqual`)
- [x] No CORS needed on `/api/admin/*` — UI and API are same-origin (single Worker)
- [x] No `any` types; `wrangler types` used for `Env` (secrets augmented in `src/secrets.d.ts`)
- [x] `pnpm audit --prod` run before first deploy — no known vulnerabilities
