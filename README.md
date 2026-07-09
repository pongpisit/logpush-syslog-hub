# logpush-syslog-hub

Turn **Cloudflare Logpush** into a generic **syslog (CEF over TCP)** feed for
any log collector — Splunk, QRadar, Elastic, Graylog, rsyslog, syslog-ng, or
literally anything that can listen on a TCP port. Point Logpush at this
Worker, add a destination in the built-in web UI, and your logs start
flowing as standard CEF syslog. No custom parser required on the receiving
end.

- ✅ **Single Worker** — the ingest API, admin API, and web UI are all one
  Cloudflare Worker deployment. One URL, one "Deploy to Cloudflare" button.
- ✅ **Generic CEF output** — standard extension keys (`src`, `dhost`,
  `request`, `cs1-6`, `cn1-3`, …) that any CEF-aware syslog receiver already
  understands
- ✅ **Multiple destinations** — fan a single Logpush job out to as many
  syslog servers as you want, each with its own mapping
- ✅ **Reliable delivery** — backed by a Cloudflare Queue with automatic
  retries and a dead-letter queue
- ✅ **Private or public targets** — reach a syslog server over the public
  internet, or privately through a Cloudflare Tunnel

**Current scope:** TCP delivery only (plaintext), no TLS yet, no UDP — see
[Roadmap](#roadmap).

## Deploy to Cloudflare

Click the button, and Cloudflare will fork this repo into your own
GitHub/GitLab account, provision the D1 database and Queue automatically,
build the web UI, and deploy — all as one Worker. No local clone, no
`wrangler` CLI required.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pongpisit/logpush-syslog-hub)

You'll be prompted to enter two values during setup — `INGEST_SECRET` and
`ADMIN_SECRET` (generate each with `openssl rand -hex 32`). Everything else
(the D1 database, the Queue + dead-letter queue, the database schema
migration, and the web UI build) is created and applied automatically.

Once deployed, jump straight to [Part 2 — How to use it](#part-2--how-to-use-it)
to add your first destination.

> Prefer the command line, want to run it locally first, or forking to make
> changes? Use the manual steps in [Part 1](#part-1--deploy-your-own-instance-manual) instead.

---

## Contents

- [How it works](#how-it-works)
- [Deploy to Cloudflare](#deploy-to-cloudflare) *(one-click)*
- [Part 1 — Deploy your own instance (manual)](#part-1--deploy-your-own-instance-manual) *(CLI / local dev)*
- [Part 2 — How to use it](#part-2--how-to-use-it) *(day-to-day)*
- [Connecting to your syslog server](#connecting-to-your-syslog-server)
- [Local development](#local-development)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## How it works

```
Cloudflare Logpush
  │ POST gzip NDJSON, Authorization: Bearer <INGEST_SECRET>
  ▼
                    ┌─── one Worker ───────────────────────────┐
                    │                                          │
  /api/ingest/:dataset ──▶ Cloudflare Queue                    │
                    │            │                             │
  /api/admin/* (CRUD, D1)        ▼                             │
                    │      Queue consumer                      │
  /* (everything else)     formats CEF syslog message          │
    → serves the web UI          │                             │
    (static assets)              ▼                             │
                    │      TCP socket (direct or Workers VPC)  │
                    └────────────┼───────────────────────────  ┘
                                  ▼
                          Your syslog server / SIEM
```

1. Cloudflare Logpush POSTs a gzip-compressed NDJSON batch to
   `/api/ingest/:dataset`.
2. The Worker authenticates the request, decompresses and parses each
   record, and enqueues one delivery per destination configured for that
   dataset.
3. A queue consumer formats each record as a CEF syslog message and opens a
   TCP connection to the destination, retrying automatically on failure.
4. The same Worker also serves the web UI (a React SPA built to `./dist`)
   for any request that isn't under `/api/*` — same origin, no CORS, no
   separate deployment.

### Why CEF?

CEF (Common Event Format) is a plain-text, self-describing syslog format
that most log collectors already know how to parse based on its
`CEF:0|Vendor|Product|...` header — no custom grok pattern or parser plugin
needed. This project ships **generic, vendor-agnostic default mappings** for
the `http_requests` and `firewall_events` Logpush datasets, using only
standard CEF keys, so the output is useful out of the box. You can add
mappings for any other Logpush dataset from the web UI.

### Repo layout

```
src/   Hono Worker: ingest endpoint, admin API, queue consumer, D1 schema.
ui/    React + Vite + Tailwind admin UI (destinations, mappings, dashboard).
       Built by `npm run build` into ./dist, which the Worker serves via
       its `assets` binding (see wrangler.jsonc) — not a separate deploy.
test/  Vitest test suite (@cloudflare/vitest-pool-workers).
```

Everything ships as **one Worker**: API routes live under `/api/*`; every
other request falls through to the built web UI (see `src/index.ts` and the
`assets` block in `wrangler.jsonc`).

---

## Part 1 — Deploy your own instance (manual)

This is the command-line path — use it if you want to run the project
locally, make changes before deploying, or just prefer the CLI over the
[Deploy to Cloudflare button](#deploy-to-cloudflare) above. This is a
**one-time setup** you (or whoever runs the infrastructure) do once. If
someone has already deployed this for you, skip straight to
[Part 2 — How to use it](#part-2--how-to-use-it).

**You will need:**

- Node.js **22+** and pnpm **8+** installed
- A Cloudflare account, and `wrangler` logged in (`npx wrangler login`)
- A Cloudflare API token with `Logs Write` permission for the zone(s) you
  want to forward — [create one here](https://dash.cloudflare.com/profile/api-tokens)
- Your Cloudflare **Zone ID** — found on your domain's dashboard **Overview** page

### Step 1 — Clone and install

```bash
git clone https://github.com/<you>/logpush-syslog-hub
cd logpush-syslog-hub
pnpm install
```

### Step 2 — Create the Cloudflare resources

```bash
npx wrangler d1 create logpush-syslog-hub-db
npx wrangler queues create logpush-syslog-queue
npx wrangler queues create logpush-syslog-queue-dlq
```

The first command prints a `database_id`. Copy it into `wrangler.jsonc`
under `d1_databases[0].database_id`, replacing the placeholder value.

### Step 3 — Set two secrets

```bash
npx wrangler secret put INGEST_SECRET   # Logpush uses this to authenticate to the Worker
npx wrangler secret put ADMIN_SECRET    # the web UI uses this to authenticate to the Worker
```

Wrangler will prompt you for each value — generate strong random values with:

```bash
openssl rand -hex 32
```

Save both values somewhere safe (e.g. a password manager); you'll need
`ADMIN_SECRET` again when you open the web UI, and `INGEST_SECRET` again
when you [create the Logpush job](#c-create-the-logpush-job) in Part 2.

> For local development instead of a live deploy, copy `.dev.vars.example`
> to `.dev.vars` and put test values there (this file is git-ignored and
> never committed).

### Step 4 — Deploy

```bash
# Builds the web UI into ./dist, applies D1 migrations (creating the
# destinations/mappings/destination_status tables and seeding two
# ready-to-use generic CEF mappings), then deploys the Worker. Note the URL
# it prints, e.g. https://logpush-syslog-hub.<you>.workers.dev
npm run deploy
```

Open the printed URL in a browser. On first load you'll see a connection
screen — enter the `ADMIN_SECRET` value you set in Step 3, then click
**Connect**. You should land on the Dashboard, showing a green "status: ok"
badge. Deployment is done — move on to Part 2 to start forwarding logs.

---

## Part 2 — How to use it

This is what you (or your team) will do regularly: add destinations, set up
mappings, and point Logpush jobs at the Worker.

### A. Add a syslog destination

In the web UI, go to the **Destinations** tab and click **+ Add
destination**. Fill in the form:

| Field | What to enter |
|---|---|
| **Name** | A friendly label, e.g. `Production SIEM` |
| **Host** | Your syslog server's IP or hostname |
| **Port** | The TCP port it listens on (commonly `514`) |
| **Transport** | `Direct (public TCP)` if your syslog server has a public IP; `Workers VPC` if it's private — see [Connecting to your syslog server](#connecting-to-your-syslog-server) |
| **Framing** | `RFC 6587 octet-count` or `Newline-delimited` — see the table below if unsure |
| **Dataset** | Which Logpush dataset this destination should receive (`http_requests`, `firewall_events`, or `all`) |
| **CEF mapping** | Pick a mapping (the two generic defaults are pre-seeded), or `(generic fallback)` |
| **Syslog hostname** | The `HOSTNAME` field written into each syslog message (defaults to `cloudflare`) |
| **Enabled** | Leave checked to start receiving events immediately |

Click **Save destination**.

### B. Test the destination before going live

On the Destinations list, click **Test send** next to your new destination.
This sends one realistic sample event through the full pipeline (CEF
formatting + TCP delivery) without needing a real Logpush job yet.

- ✅ **"Delivered"** — the TCP connection and delivery worked. You're ready
  to wire up real traffic.
- ❌ **An error message** — see [Troubleshooting](#troubleshooting) below.

### C. Create the Logpush job

Run this once per Cloudflare zone you want to forward, replacing
`$ZONE_ID`, `$CF_API_TOKEN`, `<your-worker>`, and `<INGEST_SECRET>`:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "syslog-hub-http-requests",
    "destination_conf": "https://<your-worker>.workers.dev/api/ingest/http_requests?header_Authorization=Bearer%20<INGEST_SECRET>",
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

A successful response includes `"success": true` and a job `"id"`. To also
forward firewall events, repeat the command with
`"dataset": "firewall_events"` and `/api/ingest/firewall_events` in the URL.

> **Note the URL encoding:** the `header_Authorization` value must be
> `Bearer%20<INGEST_SECRET>` — that's the literal word `Bearer`, then `%20`
> (a URL-encoded space), then your secret. Missing this is the #1 cause of
> "it's not working."

Within a minute or two, logs should start arriving at your syslog server.

### D. Monitor delivery

Go to the **Dashboard** tab in the web UI. For each destination you'll see:

- **Forwarded** — total events successfully delivered
- **Dropped** — events that failed after all retries
- **Last success** / **Last error** — timestamps and error detail for the
  most recent attempt

If **Dropped** keeps growing, click into the destination's error message or
re-run **Test send** to diagnose.

### E. Customize field mappings (optional)

The two seeded mappings (`Generic HTTP Requests (CEF)`,
`Generic Firewall Events (CEF)`) work out of the box. To customize, or to
add support for another Logpush dataset:

1. Go to the **Mappings** tab → **+ Add mapping**.
2. Give it a name and set **Dataset** to the Logpush dataset name (e.g.
   `dns_logs`).
3. Add rows: **cefKey** (the CEF extension key to emit, e.g. `src`),
   **label** (optional, for `cnN`/`csN` keys, e.g. `country`), and either a
   **sourceField** (the Logpush field name to pull the value from) or a
   **staticValue** (a fixed string).
4. Save, then select this mapping on any destination.

---

## Connecting to your syslog server

| Your syslog server is... | Destination `transport` |
|---|---|
| Publicly reachable | `direct` — plain TCP. Allow inbound from [Workers egress IPs](https://developers.cloudflare.com/workers/platform/known-issues/#outbound-ip-ranges). |
| Private / on-prem | `vpc` — reach it through a [Workers VPC Network](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/) bound to a Cloudflare Tunnel or Mesh network. |

To enable `vpc` transport, uncomment and configure the `vpc_networks` block
in `wrangler.jsonc`, then redeploy:

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

---

## Local development

Two terminals — one runs the Worker (API + queue consumer), the other runs
the web UI with hot reload, proxying `/api/*` calls to the Worker:

```bash
# Terminal 1: the Worker (build the UI once first so wrangler's assets
# binding has something to serve; the API works fine without rebuilding
# it again on every UI change since Terminal 2 has its own dev server)
npm run build
npm run dev:worker      # http://localhost:8787

# Terminal 2: the web UI with Vite HMR, proxying /api to :8787
npm run dev:ui          # http://localhost:5173
```

Open `http://localhost:5173` for UI development with hot reload, or
`http://localhost:8787` to hit the Worker directly (serving the last build).

Try the ingest pipeline end-to-end locally:

```bash
# Terminal 3: a plain TCP listener to see the output
nc -lk 1514 | cat

# Add a destination pointing at 127.0.0.1:1514 (transport=direct,
# framing=newline) via the web UI at http://localhost:5173, then send a
# sample Logpush-shaped payload:
printf '{"RayID":"test001","EdgeStartTimestamp":1720000000000000000,"ClientIP":"203.0.113.1","ClientCountry":"TH","ClientSrcPort":54321,"ClientRequestMethod":"GET","ClientRequestHost":"example.com","ClientRequestURI":"/api/v1/data","ClientRequestProtocol":"HTTP/2","ClientRequestUserAgent":"Mozilla/5.0","ClientSSLProtocol":"TLSv1.3","EdgeResponseStatus":200,"EdgeResponseBytes":4096,"EdgeColoCode":"SIN","EdgeTimeToFirstByteMs":18,"CacheCacheStatus":"MISS","ZoneName":"example.com"}' \
  | gzip \
  | curl -s -X POST http://localhost:8787/api/ingest/http_requests \
       -H "Authorization: Bearer $(grep INGEST_SECRET .dev.vars | cut -d= -f2)" \
       -H "Content-Encoding: gzip" \
       --data-binary @-
```

You should see a CEF syslog line appear in Terminal 3 within a couple of
seconds.

### Running the test suite

```bash
npm run typecheck
npm test              # builds the UI, then ~52 tests, ~90% coverage
npm test -- --coverage
```

---

## Troubleshooting

- **Nothing arrives at my syslog server** — check the destination's status
  on the Dashboard tab (forwarded/dropped counts, last error). Use **Test
  send** on the destination to isolate connectivity issues from Logpush
  configuration issues.
- **Messages look truncated or merged together** — try switching the
  destination's **Framing** setting (see [above](#framing-which-one-do-i-pick)).
- **`vpc` transport fails immediately** — make sure the `vpc_networks` block
  in `wrangler.jsonc` is uncommented, configured with a real tunnel ID, and
  that you've redeployed after changing it.
- **Logpush job creation fails with a destination validation error** — the
  ingest endpoint must respond `2xx` to Logpush's ownership check; make sure
  `INGEST_SECRET` in the job's `header_Authorization` matches the deployed
  Worker's secret exactly (including the `Bearer ` prefix, URL-encoded).
- **The web UI shows "Unauthorized"** — double-check the `ADMIN_SECRET` you
  entered on the connection screen matches what you set in Step 3. Click
  **Disconnect** to re-enter it.

---

## Roadmap

- [ ] TLS transport for `direct` and `vpc` destinations
- [ ] UDP delivery via an optional relay (Cloudflare Container or sidecar)
- [ ] Additional default mappings (`gateway_http`, `dns_logs`, `spectrum_events`)
- [ ] Per-destination filtering and sampling
- [ ] Cloudflare Access-protected admin UI (instead of a shared bearer secret)

## Contributing

Issues and PRs welcome. Please run `npm run typecheck` and `npm test`
before submitting.

## License

[MIT](LICENSE)
