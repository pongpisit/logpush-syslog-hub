# logpush-syslog-hub

Turn **Cloudflare Logpush** into a generic **syslog (CEF over TCP)** feed for
any log collector — Splunk, QRadar, Elastic, Graylog, rsyslog, syslog-ng, or
literally anything that can listen on a TCP port. Point Logpush at this
Worker, add a destination in the web UI, and your logs start flowing as
standard CEF syslog. No custom parser required on the receiving end.

- ✅ **Generic CEF output** — standard extension keys (`src`, `dhost`,
  `request`, `cs1-6`, `cn1-3`, …) that any CEF-aware syslog receiver already
  understands
- ✅ **Web UI** — add/edit destinations and field mappings without touching code
- ✅ **Multiple destinations** — fan a single Logpush job out to as many
  syslog servers as you want, each with its own mapping
- ✅ **Reliable delivery** — backed by a Cloudflare Queue with automatic
  retries and a dead-letter queue
- ✅ **Private or public targets** — reach a syslog server over the public
  internet, or privately through a Cloudflare Tunnel

**Current scope:** TCP delivery only (plaintext), no TLS yet, no UDP — see
[Roadmap](#roadmap).

## How it works

```
Cloudflare Logpush
  │ POST gzip NDJSON, Authorization: Bearer <INGEST_SECRET>
  ▼
Worker (apps/api) ── /ingest/:dataset ──▶ Cloudflare Queue
  │                                            │
  │ /admin/* (CRUD, D1)                        ▼
  ▼                                   Queue consumer
Web UI (apps/web)                       │ formats CEF syslog message
  reads/writes D1 via /admin/*          ▼
                                   TCP socket (direct or Workers VPC)
                                         │
                                         ▼
                                 Your syslog server / SIEM
```

1. Cloudflare Logpush POSTs a gzip-compressed NDJSON batch to `/ingest/:dataset`.
2. The Worker authenticates the request, decompresses and parses each record,
   and enqueues one delivery per destination configured for that dataset.
3. A queue consumer formats each record as a CEF syslog message and opens a
   TCP connection to the destination, retrying automatically on failure.

### Why CEF?

CEF (Common Event Format) is a plain-text, self-describing syslog format
that most log collectors already know how to parse based on its
`CEF:0|Vendor|Product|...` header — no custom grok pattern or parser plugin
needed. This project ships **generic, vendor-agnostic default mappings** for
the `http_requests` and `firewall_events` Logpush datasets, using only
standard CEF keys, so the output is useful out of the box. You can add
mappings for any other Logpush dataset from the web UI.

## Monorepo layout

```
apps/api/         Hono Worker: ingest endpoint, admin API, queue consumer, D1 schema
apps/web/         React + Vite + Tailwind admin UI (destinations, mappings, dashboard)
packages/shared/  Zod schemas + default CEF mappings shared by api and web
```

## Quickstart

Requires Node.js 22+, pnpm 8+, and a Cloudflare account.

```bash
git clone https://github.com/<you>/logpush-syslog-hub
cd logpush-syslog-hub
pnpm install
```

### 1. Create your Cloudflare resources

```bash
cd apps/api
npx wrangler d1 create logpush-syslog-hub-db
npx wrangler queues create logpush-syslog-queue
npx wrangler queues create logpush-syslog-queue-dlq
```

Paste the `database_id` printed above into `apps/api/wrangler.jsonc` →
`d1_databases[0].database_id`.

### 2. Set two secrets

```bash
npx wrangler secret put INGEST_SECRET   # authenticates Logpush -> Worker
npx wrangler secret put ADMIN_SECRET    # authenticates the web UI / admin API
```

Generate strong values with `openssl rand -hex 32`. For local development,
copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and fill in test
values (this file is git-ignored).

### 3. Apply the database schema

```bash
npx wrangler d1 migrations apply logpush-syslog-hub-db --remote
```

This creates the `destinations`, `mappings`, and `destination_status` tables
and seeds two ready-to-use generic mappings.

### 4. Deploy

```bash
# API
pnpm --filter @logpush-syslog-hub/api deploy

# Web UI
cd ../web && pnpm build && npx wrangler deploy
```

Open the deployed web UI URL, then enter the API URL (from the API deploy
output) and your `ADMIN_SECRET`. You're in.

### 5. Add a destination

In the web UI, click **+ Add destination** and fill in your syslog server's
host and port. Use **Test send** to confirm connectivity before wiring up
real traffic.

### 6. Point Logpush at your Worker

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "syslog-hub-http-requests",
    "destination_conf": "https://<your-worker>.workers.dev/ingest/http_requests?header_Authorization=Bearer%20<INGEST_SECRET>",
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

URL-encode the `Bearer ` prefix as `Bearer%20` before your `INGEST_SECRET`
value. See [Cloudflare's HTTP destination
docs](https://developers.cloudflare.com/logs/logpush/logpush-job/enable-destinations/http/)
for details on `header_*` query parameters.

Repeat with `"dataset": "firewall_events"` and `/ingest/firewall_events` to
also forward firewall events. That's it — logs should start arriving at your
syslog server within a minute or two.

## Connecting to your syslog server

| Your syslog server is... | Destination `transport` |
|---|---|
| Publicly reachable | `direct` — plain TCP. Allow inbound from [Workers egress IPs](https://developers.cloudflare.com/workers/platform/known-issues/#outbound-ip-ranges). |
| Private / on-prem | `vpc` — reach it through a [Workers VPC Network](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/) bound to a Cloudflare Tunnel or Mesh network. |

To enable `vpc` transport, uncomment and configure the `vpc_networks` block
in `apps/api/wrangler.jsonc`, then redeploy:

```jsonc
"vpc_networks": [
  { "binding": "SYSLOG_VPC", "tunnel_id": "<YOUR_TUNNEL_UUID>", "remote": true }
]
```

One `SYSLOG_VPC` binding reaches **any** host:port behind that tunnel/mesh —
you don't need a separate binding per destination.

> **Note:** TCP connections from Workers (both `direct` and `vpc`) are
> **plaintext only** today. TLS isn't supported yet — see [Roadmap](#roadmap).

### Framing: which one do I pick?

Each destination has a **Framing** setting that controls how syslog messages
are delimited on the wire:

| Framing | Format | Use when your syslog receiver expects... |
|---|---|---|
| `rfc6587` (default) | `<byte-length> <message>` | Octet-counted / length-prefixed TCP syslog (the most robust option — messages can never be split incorrectly, even if they contain embedded newlines) |
| `newline` | `<message>\n` | Classic newline-delimited TCP syslog (what most syslog daemons like rsyslog and syslog-ng use out of the box) |

If you're not sure, start with `newline` — most generic TCP syslog listeners
expect it. Switch to `rfc6587` if your receiver explicitly supports
length-prefixed framing (check its docs for "octet counting" or "RFC 6587").

## Local development

Try the whole pipeline locally in under a minute:

```bash
# Terminal 1: a plain TCP listener to see the output
nc -lk 1514 | cat

# Terminal 2: run the Worker locally
cd apps/api
npx wrangler dev

# Terminal 3: add a destination pointing at 127.0.0.1:1514 (transport=direct,
# framing=newline) via the web UI pointed at http://localhost:8787, or call
# the admin API directly — then send a sample Logpush-shaped payload:
printf '{"RayID":"test001","EdgeStartTimestamp":1720000000000000000,"ClientIP":"203.0.113.1","ClientCountry":"TH","ClientSrcPort":54321,"ClientRequestMethod":"GET","ClientRequestHost":"example.com","ClientRequestURI":"/api/v1/data","ClientRequestProtocol":"HTTP/2","ClientRequestUserAgent":"Mozilla/5.0","ClientSSLProtocol":"TLSv1.3","EdgeResponseStatus":200,"EdgeResponseBytes":4096,"EdgeColoCode":"SIN","EdgeTimeToFirstByteMs":18,"CacheCacheStatus":"MISS","ZoneName":"example.com"}' \
  | gzip \
  | curl -s -X POST http://localhost:8787/ingest/http_requests \
       -H "Authorization: Bearer $(grep INGEST_SECRET apps/api/.dev.vars | cut -d= -f2)" \
       -H "Content-Encoding: gzip" \
       --data-binary @-
```

You should see a CEF syslog line appear in Terminal 1 within a couple of
seconds.

## Testing

```bash
pnpm -r typecheck
pnpm --filter @logpush-syslog-hub/api test              # ~52 tests, ~90% coverage
pnpm --filter @logpush-syslog-hub/api test -- --coverage
```

## Troubleshooting

- **Nothing arrives at my syslog server** — check the destination's status
  on the Dashboard tab (forwarded/dropped counts, last error). Use **Test
  send** on the destination to isolate connectivity issues from Logpush
  configuration issues.
- **Messages look truncated or merged together** — try switching the
  destination's **Framing** setting (see [above](#framing-which-one-do-i-pick)).
- **`vpc` transport fails immediately** — make sure the `vpc_networks` block
  in `apps/api/wrangler.jsonc` is uncommented, configured with a real tunnel
  ID, and that you've redeployed after changing it.
- **Logpush job creation fails with a destination validation error** — the
  ingest endpoint must respond `2xx` to Logpush's ownership check; make sure
  `INGEST_SECRET` in the job's `header_Authorization` matches the deployed
  Worker's secret exactly (including the `Bearer ` prefix, URL-encoded).

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
