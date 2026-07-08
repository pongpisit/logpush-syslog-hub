# Project Progress

**Goal**: Open-source Cloudflare Worker that receives Logpush batches, converts them to
CEF-over-syslog, and forwards over TCP to one or more configurable syslog/SIEM
destinations, with a web UI for managing destinations and field mappings.

**Mode**: MVP
**Account**: aa8ab6fe5b7f906df426a972033e922a (Pongpisit Demo account)

## Tasks

- [x] 1. Monorepo scaffold (pnpm workspaces: apps/api, apps/web, packages/shared)
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

## Notes / Decisions

- Transport scope for v1: **TCP only, no TLS, no UDP** (explicit user decision).
- CEF mapping: generic, vendor-agnostic default mappings using only standard CEF keys
  so output works across NetWitness, Splunk, QRadar, Sentinel, etc. without customization.
- Admin auth: shared `ADMIN_SECRET` bearer token for MVP (Cloudflare Access deferred to roadmap).
- One `SYSLOG_VPC` Workers VPC Network binding is shared across all `transport=vpc`
  destinations (VPC Networks route by runtime address, unlike VPC Services).

## Security Checklist

- [x] Secrets (`INGEST_SECRET`, `ADMIN_SECRET`) via `wrangler secret put`, never hardcoded
- [x] Zod validation on all admin/ingest inputs
- [x] Timing-safe bearer token comparison (SHA-256 digest + `crypto.subtle.timingSafeEqual`)
- [x] CORS on `/admin/*` locked to a configurable `ADMIN_ALLOWED_ORIGIN`
- [x] No `any` types; `wrangler types` used for `Env` (secrets augmented in `src/secrets.d.ts`)
- [x] `pnpm audit --prod` run before first deploy — no known vulnerabilities
