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
  - Redeployed the merged Worker to the live account
    (https://logpush-syslog-hub.pongpisit.workers.dev) and repeated the
    same verification. Pushed to GitHub; CI green.
  - Deleted the now-redundant `logpush-syslog-hub-web` Worker (confirmed
    user decision) — verified it now 404s and the merged Worker is
    unaffected.
- [x] 13. RFC 5424 syslog format, TLS (RFC 5425) for `Direct` destinations,
  configurable syslog facility, and 7 additional default dataset mappings
  (`dns_logs`, `spectrum_events`, `gateway_http`, `gateway_dns`,
  `gateway_network`, `audit_logs`, `nel_reports`) — 9 datasets total.
- [x] 14. SOC field-coverage expansion (user request: "make sure the log
  field especially Security and HTTP requests logs field all of them are
  present ... create their own use cases"), scoped to six priorities: bot
  detection, WAF tuning, DDoS, credential-leak detection, insider threat,
  0-day/threat-intel hunting:
  - Audited every field Cloudflare's Logpush docs list for the 9 supported
    datasets against what was mapped; found major gaps (deprecated
    `WAFAction`/`WAFRuleID` still in use instead of `SecurityAction`/
    `SecurityRuleID`; no bot/DLP/threat-intel/fingerprint fields at all).
  - Added a `raw=<full record JSON>` CEF extension, on by default
    (per-destination `includeRaw` toggle) — guarantees every field a
    dataset emits reaches the SOC, including fields not in any mapping and
    fields Cloudflare adds in the future. Capped at 8 KB with a truncation
    marker for pathological records.
  - Found + fixed a real bug while building this: array/object-valued
    Logpush fields (e.g. `SecurityActions`, `Metadata`, `NewValue`) were
    rendering as the literal string `[object Object]` via naive `String()`
    coercion — added `stringifyFieldValue()` to JSON-encode them instead.
  - Rewrote `DEFAULT_MAPPING_RULES` for all 9 datasets with SOC-priority
    fields (BotScore/BotTags/JA3Hash/JA4, SecurityActions/RuleIDs/Sources,
    ClientASN/IPClass, LeakedCredentialCheckResult, WAFAttackScore,
    BlockedFile*/DLP profiles, MatchedIndicatorFeedNames, audit_logs'
    OldValue/NewValue diff, etc.) — verified field names against
    Cloudflare's live docs per dataset, not guessed.
  - New `SOC_USE_CASES.md`: field-to-detection-scenario reference for all
    six priorities, SIEM-agnostic generic query logic, verified factual
    claims (WAF/AI Security score directionality) against Cloudflare docs
    before publishing.
  - Migration `0004_soc_field_expansion.sql`: `include_raw` column +
    updated seeded mappings, generated programmatically from
    `cef-defaults.ts` (not hand-transcribed) to guarantee they can't drift.
  - 17 new tests (80 → 97): raw-passthrough behavior (default on/off,
    truncation, escaping), per-dataset SOC-field mapping assertions, and
    live test-send integration checks for the priority fields.
  - Applied migration to the live D1 database, deployed, and verified live
    against the real production VPC destination: SecurityAction/BotScore/
    WAFAttackScore/JA3Hash/JA4/LeakedCredentialCheckResult all populated
    correctly in the delivered CEF message; `audit_logs`' OldValue/NewValue
    JSON objects confirmed correctly encoded (not `[object Object]`) via a
    temporary destination, then cleaned up.
- [x] 15. README readability pass + test-receiver script (user request:
  "make it easy to understand and easy to follow step by step and have a
  sample script to setup linux syslog server for testing"):
  - New `scripts/setup-test-syslog.sh`: one-command CEF-over-TCP test
    receiver. Installs rsyslog via apt/dnf/yum/apk, writes the `$rawmsg`
    filter config, starts under systemd *or* bare `rsyslogd` (containers),
    confirms the TCP listener, and prints the exact web-UI destination
    settings. Configurable `PORT`/`LOGFILE`, root-guarded, idempotent.
  - Verified the script end-to-end in a real Linux container: installed
    rsyslog, confirmed it listened on TCP 514, sent a real RFC 3164 CEF
    line over the socket, and confirmed it was written to the dedicated
    logfile byte-for-byte and did **not** leak into `/var/log/messages`.
    Caught + fixed a bug during testing (wrote the drop-in config before
    `mkdir -p /etc/rsyslog.d`).
  - README restructured for step-by-step readability: added a "The whole
    path, end to end" 3-step overview up top; replaced the two large inline
    setup heredocs with the script + a one-liner; moved the hard-won "why"
    caveats (`$rawmsg` vs `$msg`, disconnect survival), the Docker recipe,
    the dashboard walkthrough, and the other-datasets field lists into
    collapsible `<details>` blocks so the happy path stays short. Verified
    all 27 in-page anchor links still resolve.
- [x] 16. Repo polish: README badges (CI status, MIT license, Cloudflare
  Workers) + a CI job that regression-tests the script:
  - New `smoke-test-syslog-script` CI job: shellchecks the script
    (`-S warning`), runs it on the runner (`PORT=1514`), sends a real
    RFC 3164 CEF line over TCP, and asserts it's captured byte-for-byte in
    the dedicated logfile and does **not** leak into `/var/log/syslog`.
  - That job immediately earned its keep: it caught a real bug — the script
    pre-created the logfile as `root:root 0640`, but on Debian/Ubuntu
    rsyslog drops to the `syslog` user and so couldn't write it (listener
    up, logfile silently empty). Fixed by chowning the pre-created file to
    `syslog` when that user exists + `fileCreateMode`/`createDirs` on the
    omfile action. Both CI jobs now green; smoke-test assertions confirmed
    genuinely passing in the run log (not false-positives).

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
