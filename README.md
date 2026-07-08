# logpush-syslog-hub

Open-source Cloudflare Worker that receives **Cloudflare Logpush** batches and
forwards them as **CEF-over-syslog (TCP)** to one or more syslog / SIEM
destinations — NetWitness, Splunk, QRadar, Microsoft Sentinel, Elastic, or any
other CEF-aware collector. Manage destinations and field mappings from a
built-in web UI; delivery is queued and retried automatically.

```
Cloudflare Logpush
  │ POST gzip NDJSON, Authorization: Bearer <INGEST_SECRET>
  ▼
Worker  (apps/api)  ── /ingest/:dataset ──▶  Cloudflare Queue
  │                                              │
  │ /admin/*  (CRUD, D1)                         ▼
  ▼                                     Queue consumer
Web UI (apps/web)                        │ CEF format (RFC 3164 + RFC 6587 framing)
  reads/writes D1 via /admin/*           ▼
                                    TCP socket (direct or Workers VPC)
                                          │
                                          ▼
                                  Syslog / SIEM destination
```

## Why CEF?

CEF (Common Event Format) is auto-detected by device vendor/product strings
and is natively parsed by most SIEMs without custom parsers. This project
ships **generic, vendor-agnostic default mappings** for `http_requests` and
`firewall_events` using only the standard CEF extension dictionary (`src`,
`spt`, `dhost`, `request`, `act`, `cs1-6`, `cn1-3`, `externalId`,
`deviceExternalId`, `rt`), so the same output works across NetWitness,
Splunk, QRadar, ArcSight, Sentinel, Elastic, etc. You can add custom
mappings for any other Logpush dataset from the web UI.

**Current scope:** TCP delivery only (plaintext), no TLS yet, no UDP. See
[Roadmap](#roadmap).

## Monorepo layout

```
apps/api/      Hono Worker: ingest endpoint, admin API, queue consumer, D1 schema
apps/web/      React + Vite + Tailwind admin UI (destinations, mappings, dashboard)
packages/shared/  Zod schemas + default CEF mappings shared by api and web
```

## Prerequisites

- Node.js 20+, pnpm 8+
- A Cloudflare account with Workers, D1, and Queues enabled
- `wrangler` (installed as a dev dependency, invoke via `npx wrangler`)

## 1. Install

```bash
pnpm install
```

## 2. Create Cloudflare resources

```bash
cd apps/api
npx wrangler d1 create logpush-syslog-hub-db
npx wrangler queues create logpush-syslog-queue
npx wrangler queues create logpush-syslog-queue-dlq
```

Copy the returned `database_id` into `apps/api/wrangler.jsonc` under
`d1_databases[0].database_id` (already set for this repo's own deployment —
replace it with your own IDs when forking).

## 3. Set secrets

```bash
npx wrangler secret put INGEST_SECRET   # used by Logpush to authenticate
npx wrangler secret put ADMIN_SECRET    # used by the web UI / admin API
```

Generate strong values with `openssl rand -hex 32`.

For local development, copy `apps/api/.dev.vars.example` to
`apps/api/.dev.vars` and fill in test values (never commit this file).

## 4. Apply D1 migrations

```bash
npx wrangler d1 migrations apply logpush-syslog-hub-db --remote
```

This creates the `destinations`, `mappings`, and `destination_status` tables
and seeds two generic default mappings (`default-http-requests`,
`default-firewall-events`).

## 5. Deploy the API

```bash
pnpm --filter @logpush-syslog-hub/api deploy
```

Note the deployed URL, e.g. `https://logpush-syslog-hub.<subdomain>.workers.dev`.

## 6. Deploy the admin UI

```bash
cd apps/web
pnpm build
npx wrangler pages deploy dist --project-name=logpush-syslog-hub-web
```

Open the deployed Pages URL, then enter:
- **API base URL**: the Worker URL from step 5
- **Admin secret**: the `ADMIN_SECRET` value from step 3

From the UI you can add destinations and mappings.

## 7. Create a Logpush job

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "syslog-hub-http-requests",
    "destination_conf": "https://logpush-syslog-hub.<subdomain>.workers.dev/ingest/http_requests?header_Authorization=Bearer%20<INGEST_SECRET>",
    "dataset": "http_requests",
    "output_options": {
      "field_names": [
        "RayID","EdgeStartTimestamp","ClientIP","ClientCountry","ClientSrcPort",
        "ClientRequestMethod","ClientRequestHost","ClientRequestURI","ClientRequestProtocol",
        "ClientRequestUserAgent","ClientSSLProtocol","EdgeResponseStatus","EdgeResponseBytes",
        "EdgeColoCode","EdgeTimeToFirstByteMs","CacheCacheStatus","WAFAction","WAFRuleID","ZoneName"
      ],
      "timestamp_format": "unixnano"
    },
    "enabled": true
  }'
```

URL-encode the `Bearer ` prefix as `Bearer%20` and your `INGEST_SECRET` value
in the `header_Authorization` query parameter. See [Cloudflare's HTTP
destination docs](https://developers.cloudflare.com/logs/logpush/logpush-job/enable-destinations/http/)
for details on `header_*` parameters.

Repeat with `"dataset": "firewall_events"` and
`/ingest/firewall_events` for firewall events.

## Connectivity to your syslog server

| Scenario | Destination `transport` |
|---|---|
| Syslog server has a public IP reachable from the internet | `direct` — plain TCP via `cloudflare:sockets`. Allow inbound from [Workers egress IPs](https://developers.cloudflare.com/workers/platform/known-issues/#outbound-ip-ranges). |
| Syslog server is private / on-prem | `vpc` — requires a [Workers VPC Network](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/) binding to a Cloudflare Tunnel or Cloudflare Mesh network reaching your network. |

To enable `vpc` transport, uncomment and configure the `vpc_networks` block
in `apps/api/wrangler.jsonc`:

```jsonc
"vpc_networks": [
  { "binding": "SYSLOG_VPC", "tunnel_id": "<YOUR_TUNNEL_UUID>", "remote": true }
]
```

then redeploy. One `SYSLOG_VPC` binding can reach **any** host:port behind
that tunnel/mesh — you don't need a separate binding per destination.

> **Note:** `connect()` over Workers VPC Networks and `cloudflare:sockets`
> both currently support **plaintext TCP only**. TLS to the syslog
> destination is not yet supported by this project (tracked in
> [Roadmap](#roadmap)).

## NetWitness-specific setup

The default framing is **RFC 6587 octet-count** (`<len> <msg>`). In
NetWitness, use event source type **`syslog-lengthprefix-tcp`** (not
`syslog-tcp`) when adding the Syslog collector under
**Admin → Services → Log Collector → Config → Event Sources**. If you prefer
newline-delimited framing (`syslog-tcp` compatible collectors, rsyslog,
syslog-ng, etc.), set a destination's **Framing** to `newline` in the admin
UI.

## Local development

```bash
# Terminal 1: TCP listener to observe output
nc -lk 1514 | cat

# Terminal 2: run the Worker locally
cd apps/api
npx wrangler dev

# Terminal 3: add a "direct" destination pointing at 127.0.0.1:1514 via the
# admin API (or web UI pointed at http://localhost:8787), then send a test
# Logpush-shaped payload:
printf '{"RayID":"test001","EdgeStartTimestamp":1720000000000000000,"ClientIP":"203.0.113.1","ClientCountry":"TH","ClientSrcPort":54321,"ClientRequestMethod":"GET","ClientRequestHost":"example.com","ClientRequestURI":"/api/v1/data","ClientRequestProtocol":"HTTP/2","ClientRequestUserAgent":"Mozilla/5.0","ClientSSLProtocol":"TLSv1.3","EdgeResponseStatus":200,"EdgeResponseBytes":4096,"EdgeColoCode":"SIN","EdgeTimeToFirstByteMs":18,"CacheCacheStatus":"MISS","ZoneName":"example.com"}' \
  | gzip \
  | curl -s -X POST http://localhost:8787/ingest/http_requests \
       -H "Authorization: Bearer $(grep INGEST_SECRET apps/api/.dev.vars | cut -d= -f2)" \
       -H "Content-Encoding: gzip" \
       --data-binary @-
```

## Testing

```bash
pnpm -r typecheck
pnpm --filter @logpush-syslog-hub/api test         # 51 tests, ~90% coverage
pnpm --filter @logpush-syslog-hub/api test -- --coverage
```

## Roadmap

- [ ] TLS transport for `direct` and `vpc` destinations
- [ ] UDP delivery via an optional relay (Cloudflare Container or sidecar)
- [ ] Additional default mappings (`gateway_http`, `dns_logs`, `spectrum_events`)
- [ ] Per-destination filtering and sampling
- [ ] Cloudflare Access-protected admin UI (instead of a shared bearer secret)

## Contributing

Issues and PRs welcome. Please run `pnpm -r typecheck` and
`pnpm --filter @logpush-syslog-hub/api test` before submitting.

## License

[MIT](LICENSE)
