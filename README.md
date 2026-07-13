# logpush-syslog-hub

Forward **Cloudflare Logpush** logs to any syslog server or SIEM as
standard **CEF over TCP** — Splunk, QRadar, Elastic, Graylog, rsyslog,
syslog-ng, or anything that listens on a TCP port. No custom parser needed
on the receiving end.

It's one Cloudflare Worker: it receives the logs, forwards them, *and*
serves a small web UI for managing where they go.

- **One-click deploy** — a single Worker, one URL, no infrastructure to manage
- **9 Logpush datasets supported out of the box** — HTTP requests, Firewall
  events, DNS logs, Spectrum events, and 5 Zero Trust/account datasets — each
  with a ready-made CEF field mapping curated for SOC monitoring (see the
  [table below](#supported-datasets) and [SOC_USE_CASES.md](SOC_USE_CASES.md))
- **Nothing ever silently dropped** — every message carries a `raw=<full
  record JSON>` extension alongside the mapped fields, so future Cloudflare
  fields and anything not in a named CEF key still reach your SIEM
- **Two syslog header formats** — classic RFC 3164 or structured RFC 5424,
  your choice per destination
- **Plaintext or TLS** — encrypt the TCP connection (RFC 5425) for
  `Direct` destinations
- **Multiple destinations** — one Logpush job can fan out to many syslog servers
- **Reliable delivery** — a Cloudflare Queue retries failed deliveries automatically
- **Public or private targets** — plain TCP, or private via a Cloudflare Tunnel

---

## Quick start (5 minutes)

1. Click **Deploy to Cloudflare** below.
2. When asked, generate two secrets and paste them in:
   ```bash
   openssl rand -hex 32
   ```
   - `INGEST_SECRET` — Logpush uses this to authenticate to the Worker
   - `ADMIN_SECRET` — you use this to log in to the web UI
3. Cloudflare creates the database, queue, and web UI for you automatically.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pongpisit/logpush-syslog-hub)

When it's done, open the Worker's URL, enter your `ADMIN_SECRET`, and
continue with [Set up a destination](#1-set-up-a-destination) below.

Prefer the command line? See [Manual setup](#manual-setup) instead — it's
four commands.

---

## The whole path, end to end

Three steps. Each links to its section below.

1. **Deploy the Worker** — [Quick start](#quick-start-5-minutes) (button) or [Manual setup](#manual-setup) (CLI).
2. **Add a destination** — in the web UI, tell it *where* to send logs (your syslog server's host/port) and *what* format. Then click **Test send** to prove the connection end-to-end before any real logs flow. → [Set up a destination](#1-set-up-a-destination)
3. **Create a Logpush job** — point Cloudflare Logpush at the Worker so real logs start flowing. → [Point a Logpush job at it](#2-point-a-logpush-job-at-it)

> **No syslog server to test against?** Step 2 needs somewhere to send to.
> Run [`scripts/setup-test-syslog.sh`](#dont-have-a-syslog-server-yet-one-command-test-receiver)
> on any Linux box to get a working CEF-over-TCP receiver in one command.

---

## How it works

```
Logs:  Cloudflare Logpush → /api/ingest/:dataset → Queue → TCP → your syslog server
Admin: Web UI (this Worker) → /api/admin/* → D1 (stores destinations & mappings)
```

1. Logpush POSTs a batch of logs to `/api/ingest/:dataset`.
2. The Worker checks the batch belongs to one of your destinations, then
   queues one delivery per destination.
3. A queue consumer formats each log as a CEF-over-syslog message and sends
   it over TCP, retrying automatically if delivery fails.
4. Everything else (`/`, `/destinations`, `/mappings`, ...) is the web UI,
   served by the same Worker.

**Why CEF?** It's a plain-text format most log collectors already parse
out of the box, based on its `CEF:0|Vendor|Product|...` header — no custom
grok pattern needed.

---

## Supported datasets

Nine Logpush datasets ship with a ready-made, generic CEF field mapping —
pick one from the **CEF mapping** dropdown when you create a destination and
it just works. Any *other* Logpush dataset works too — [add a custom
mapping](#4-customize-field-mappings-optional) for it in about two minutes.

| Dataset | What it is | Scope | Default mapping |
|---|---|---|---|
| `http_requests` | Every HTTP request to your zone | Zone | `default-http-requests` |
| `firewall_events` | WAF / firewall rule matches | Zone or account | `default-firewall-events` |
| `dns_logs` | Recursive DNS queries to your zone | Zone | `default-dns-logs` |
| `spectrum_events` | Spectrum TCP/UDP proxy connections | Zone | `default-spectrum-events` |
| `gateway_http` | Zero Trust Gateway HTTP filtering decisions | Account | `default-gateway-http` |
| `gateway_dns` | Zero Trust Gateway DNS filtering decisions | Account | `default-gateway-dns` |
| `gateway_network` | Zero Trust Gateway L3/L4 filtering decisions | Account | `default-gateway-network` |
| `audit_logs` | Account-level administrative audit trail | Account | `default-audit-logs` |
| `nel_reports` | Browser-reported Network Error Logging | Zone | `default-nel-reports` |

> **Zone vs. account scope matters for job creation:** zone-scoped datasets
> use `POST /zones/$ZONE_ID/logpush/jobs`; account-scoped ones (the Zero
> Trust Gateway datasets and `audit_logs`) use
> `POST /accounts/$ACCOUNT_ID/logpush/jobs` instead. See [Cloudflare's
> Logpush dataset docs](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/)
> for the full list of fields per dataset.

---

## Syslog output format

Every destination controls five independent settings — mix and match per
receiver:

| Setting | Options | Notes |
|---|---|---|
| **Format** | `RFC 3164` (default) or `RFC 5424` | 3164 is the classic `<PRI>Mmm DD HH:MM:SS host CEF:0\|...` header most daemons expect. 5424 is `<PRI>1 ISO8601-timestamp host app-name procid msgid - CEF:0\|...` — pick this if your receiver wants an unambiguous, sub-second, timezone-explicit timestamp. |
| **Facility** | `0`–`23` (default `16`, local0) | Combined with the per-event severity to compute `PRI`. Most SIEMs don't care; some route by facility. |
| **Framing** | `rfc6587` (default) or `newline` | See [below](#framing-which-one-do-i-pick). |
| **TLS** | off (default) or on | RFC 5425 — wraps the TCP connection in TLS. **`Direct` transport only** — Workers VPC connections are plaintext-only, so TLS is rejected up front if you combine it with `Workers VPC`. |
| **Include raw JSON** | on (default) or off | Appends a `raw=<full Logpush record as JSON>` CEF extension. This is what guarantees every field a dataset emits — including ones not in the default mapping, and any Cloudflare adds later — reaches your SOC/SIEM. Turn off only if your collector enforces a max line length; see [SOC_USE_CASES.md](SOC_USE_CASES.md). |

### Framing: which one do I pick?

| Framing | Wire format | Pick this if your syslog receiver... |
|---|---|---|
| `newline` | `<message>\n` | is a typical daemon like rsyslog/syslog-ng (**default choice if unsure**) |
| `rfc6587` | `<byte-length> <message>` | explicitly documents "octet counting" / RFC 6587 support |

---

## Using it

### 1. Set up a destination

In the web UI, go to **Destinations → + Add destination**:

| Field | What to enter |
|---|---|
| Name | A friendly label, e.g. `Production SIEM` |
| Host / Port | Your syslog server's address, e.g. `10.0.0.5` / `514`. Don't have one yet? [Spin one up with one command](#dont-have-a-syslog-server-yet-one-command-test-receiver). |
| Transport | `Direct` for a public IP, `Workers VPC` for a private one — see [below](#connecting-to-a-private-syslog-server) |
| Framing | `newline` is the safe default — see [Framing](#framing-which-one-do-i-pick) |
| Syslog format | `RFC 3164` is the safe default — see [above](#syslog-output-format) |
| Facility | `16` (local0) unless your receiver routes by facility |
| TLS | Off unless your receiver terminates TLS on that port, and transport is `Direct` |
| Include raw JSON | On (default) — see [Syslog output format](#syslog-output-format) |
| Dataset | Which Logpush dataset to receive — any of the [9 supported](#supported-datasets), or `all` |
| CEF mapping | The matching default mapping, or your own |

Click **Save**, then click **Test send** on the new destination — it fires
one realistic sample event (shaped to match the dataset you picked) through
the full pipeline without needing a real Logpush job yet. A green
**Delivered** means you're ready to go live, and the response includes the
real `remoteAddress` it connected to as proof.

### 2. Point a Logpush job at it

Run this once per Cloudflare zone (replace `$ZONE_ID`, `$CF_API_TOKEN`,
`<your-worker>`, `<INGEST_SECRET>`) for `http_requests`:

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
        "RayID","EdgeStartTimestamp","ClientIP","ClientASN","ClientIPClass","ClientCountry",
        "ClientSrcPort","ClientRequestMethod","ClientRequestHost","ClientRequestURI",
        "ClientRequestProtocol","ClientRequestUserAgent","ClientSSLProtocol","OriginIP",
        "EdgeResponseStatus","EdgeColoCode","EdgeTimeToFirstByteMs","EdgePathingSrc",
        "CacheCacheStatus","ZoneName","SecurityAction","SecurityRuleID","SecurityRuleDescription",
        "SecurityActions","SecurityRuleIDs","SecuritySources","BotScore","BotScoreSrc","BotTags",
        "JA3Hash","JA4","WAFAttackScore","LeakedCredentialCheckResult"
      ],
      "timestamp_format": "unixnano"
    },
    "enabled": true
  }'
```

A response with `"success": true` means it's live — logs should start
arriving within a minute or two.

> ⚠️ **Two things to get right, or the job silently misbehaves:**
> 1. **`header_Authorization` must be exactly `Bearer%20<INGEST_SECRET>`** —
>    the word `Bearer`, a URL-encoded space (`%20`), then your secret. Get
>    this wrong and the job fails to create.
> 2. **`field_names` must match your CEF mapping.** Logpush has no "send all
>    fields" option — whatever you omit arrives as `null`, and the Worker's
>    default mappings reference specific field names. The **Mappings** tab
>    shows the exact list each mapping needs (with a **Copy JSON** button),
>    so it can't drift out of sync.

> 💡 **SOC team?** Every field in every dataset's mapping was chosen to cover
> six monitoring priorities: bot detection, WAF tuning, DDoS, credential-leak
> detection, insider threat, and 0-day/threat-intel hunting. See
> [SOC_USE_CASES.md](SOC_USE_CASES.md) for the full
> field-to-detection-scenario reference. (The field list above intentionally
> includes `SecurityAction`/`SecurityRuleID` — the current names for the
> deprecated `WAFAction`/`WAFRuleID`; don't use the old names in new jobs.)

<details>
<summary><b>The other 8 datasets (firewall_events, dns_logs, gateway_*, …)</b></summary>

The pattern is identical — swap the `dataset`, the `/api/ingest/<dataset>`
path, and the `field_names` list. **Don't copy field lists from here;** open
the dataset's default mapping in the **Mappings** tab and use its **Copy
JSON** button, so the list can never drift from the mapping actually in use.

Account-scoped datasets (`gateway_*`, `audit_logs`) use
`/accounts/$ACCOUNT_ID/logpush/jobs` instead of
`/zones/$ZONE_ID/logpush/jobs` — see the [dataset table](#supported-datasets).

For example, `firewall_events` uses these `output_options`:

```json
"output_options": {
  "field_names": [
    "RayID","Datetime","ClientIP","ClientASN","ClientASNDescription","ClientIPClass",
    "ClientCountry","ClientRequestHost","ClientRequestPath","ClientRequestMethod",
    "ClientRequestUserAgent","ClientRequestQuery","EdgeColoCode","EdgeResponseStatus",
    "OriginResponseStatus","ZoneName","Action","RuleID","Description","Ref","Source",
    "MatchIndex","LeakedCredentialCheckResult","AISecurityInjectionScore",
    "OriginatorRayID","FraudUserID"
  ],
  "timestamp_format": "unixnano"
}
```
</details>

<details>
<summary><b>Prefer the dashboard? The same job, click by click</b></summary>

1. Cloudflare dashboard → **Logpush** (account or zone level, per the
   [dataset table](#supported-datasets)) → **Create a Logpush job**.
2. **Select a destination** → **HTTP destination**.
3. **HTTP endpoint** — paste the full URL, including the `?header_Authorization=...`
   query string, exactly as generated above. Click **Continue**.
4. **Dataset** — select the dataset you're forwarding.
5. **Job name** — anything you like.
6. **If logs match** — leave as-is unless you want to filter which events get pushed.
7. **Send the following fields** — the dashboard's version of
   `output_options.field_names`. Its default field set is **not** the list
   your mapping needs — switch to manual selection and pick exactly the
   fields shown in the **Mappings** tab, or fields arrive empty.
8. **Advanced Options** → **Timestamp format** — `RFC3339` (the default) is
   fine; the Worker parses `unixnano`, `unix`, and RFC3339 automatically.
9. **Submit**.

> ⚠️ **Dashboard gotcha:** it validates `destination_conf` against
> `^[a-zA-Z0-9\.,_:/?%+&=\{\}-]+$` — **no literal spaces**. The URL's one
> space is already encoded as `%20` (three characters: `%`, `2`, `0`), which
> is valid. If you get `invalid destination_conf: config string must
> match "..."`, something turned that `%20` back into a real space — paste
> the URL directly rather than retyping it. If it keeps mangling it, the
> [API method](#2-point-a-logpush-job-at-it) above sidesteps this entirely.
</details>

### 3. Watch it work

The **Dashboard** tab shows, per destination: events forwarded, events
dropped, and the last success/error. If drops keep climbing, click **Test
send** to isolate whether it's a Logpush issue or a delivery issue.

### 4. Customize field mappings (optional)

Go to **Mappings → + Add mapping**. **Dataset** autocompletes the 9 built-in
names but accepts any Logpush dataset — then add rows mapping a **cefKey**
(e.g. `src`) to either a **sourceField** (a Logpush field name) or a fixed
**staticValue**. Select it on any destination.

---

## Don't have a syslog server yet? One-command test receiver

To try this out you need *somewhere* to send logs. The repo ships a script
that turns any Linux box (or container) into a CEF-over-TCP receiver: it
installs `rsyslog`, listens on TCP `514`, and writes every CEF line to its
own logfile. Works on Debian/Ubuntu, Fedora/RHEL, and Alpine, with or
without systemd.

**On a fresh Linux VM (via SSH):**

```bash
curl -fsSL https://raw.githubusercontent.com/pongpisit/logpush-syslog-hub/main/scripts/setup-test-syslog.sh | sudo bash
```

**Or clone the repo and run it directly** (it's short and worth a read first):

```bash
sudo ./scripts/setup-test-syslog.sh
# custom port (>=1024 needs no root to bind):  sudo PORT=1514 ./scripts/setup-test-syslog.sh
```

When it finishes it prints the exact destination settings to enter in the
web UI. In a second terminal, watch the logs arrive:

```bash
tail -f /var/log/logpush-syslog-hub.log
```

Then add a destination pointing at this box and click **Test send** — a CEF
line should appear in the `tail -f` immediately:

| Field | Value |
|---|---|
| Host | This box's IP (`hostname -I`), or `127.0.0.1` if testing against `wrangler dev` locally |
| Port | `514` (or whatever `PORT` you set) |
| Transport | `Direct` |
| Framing | `newline` (rsyslog's `imtcp` also auto-detects `rfc6587`, so either works) |

> ⚠️ **Reachability:** a **deployed** Worker sends TCP from Cloudflare's
> network, so the receiver needs a **public** IP with the port open in your
> **cloud firewall / security group** (not just `ufw`). Testing against
> `wrangler dev`? Use `127.0.0.1`. Private box with no public IP? Use
> `Workers VPC` — see [below](#connecting-to-a-private-syslog-server).

<details>
<summary><b>Prefer a throwaway Docker container?</b></summary>

Start it detached so it survives disconnects, then run the script inside it
as a one-shot `exec`:

```bash
# A container whose only job is to stay alive
docker run -d --name logpush-poc -p 514:514 debian:12 sleep infinity

# Install + configure rsyslog inside it
docker exec logpush-poc bash -c \
  'apt-get update -y && apt-get install -y curl >/dev/null && \
   curl -fsSL https://raw.githubusercontent.com/pongpisit/logpush-syslog-hub/main/scripts/setup-test-syslog.sh | bash'

# Watch logs any time — reconnect and rerun this as often as you like
docker exec -it logpush-poc tail -f /var/log/logpush-syslog-hub.log
```

Point the destination's **Host** at the Docker host's IP (the `-p 514:514`
publishes it), or `127.0.0.1` when testing locally.
</details>

<details>
<summary><b>How the script works, and the two non-obvious gotchas it handles</b></summary>

The whole receiver config is just this — an `imtcp` listener plus a rule
that routes CEF lines to their own file:

```
module(load="imtcp")
input(type="imtcp" port="514")
template(name="rawpassthrough" type="string" string="%rawmsg%\n")
if $rawmsg contains "CEF:0|" then {
    action(type="omfile" file="/var/log/logpush-syslog-hub.log" template="rawpassthrough")
    stop
}
```

- **Why the filter matches `$rawmsg`, not `$msg`:** rsyslog's RFC 3164
  parser treats the leading token up to the first colon as the syslog
  **tag** — so for `<134>Jul 12 ... CEF:0|Cloudflare|...` it consumes `CEF:`
  itself as the tag, and `$msg` no longer contains `CEF:0|`. Matching on
  `$rawmsg` (the entire unparsed line) avoids this, and the template writes
  it back out unmodified so the full CEF line is preserved byte-for-byte.
- **Why it survives an SSH/terminal disconnect:** on a systemd host the
  script enables + restarts the `rsyslog` service, so it's decoupled from
  your login shell. In a container (no systemd) it launches `rsyslogd`
  directly, which reparents to the container's PID 1 and keeps running —
  which is why the Docker recipe above uses a `sleep infinity` PID 1 and a
  separate, reconnect-anytime `tail -f` rather than an interactive shell
  that dies the moment you disconnect.
</details>

---

## Connecting to a private syslog server

| Your syslog server is... | Use transport |
|---|---|
| Publicly reachable, **no IP-based firewall/security group** | `Direct` — plain TCP (optionally TLS) straight to the host. |
| Publicly reachable, but **behind an IP allowlist** | `Workers VPC` instead — see below. There is no static IP range you can allowlist for `Direct`: per [Cloudflare's TCP sockets docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/), "TCP Workers outbound connections are sourced from a prefix that is not part of [the published Cloudflare IP ranges]" — unlike `fetch()`, there's no fixed list to add to a security group. If a destination times out from this Worker but is reachable from everywhere else you've tested, an IP allowlist excluding Workers' TCP egress is the most likely cause. |
| Private / on-prem | `Workers VPC` — reached through a [Workers VPC Network](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/) bound to a Cloudflare Tunnel or Mesh. **Plaintext only** — TLS is rejected for this transport, since Workers VPC connections don't support it. |

To enable `Workers VPC`, uncomment and fill in the `vpc_networks` block in
`wrangler.jsonc`, then redeploy:

```jsonc
"vpc_networks": [
  { "binding": "SYSLOG_VPC", "tunnel_id": "<YOUR_TUNNEL_UUID>", "remote": true }
]
```

One binding reaches any host/port behind that tunnel — you don't need one
per destination.

---

## Manual setup

Prefer the CLI, want to try it locally first, or plan to make changes
before deploying? Here's the manual path — a one-time setup.

**You'll need:** Node.js 22+, pnpm 8+, and `wrangler` logged in
(`npx wrangler login`).

```bash
git clone https://github.com/<you>/logpush-syslog-hub
cd logpush-syslog-hub
pnpm install

# Create the resources
npx wrangler d1 create logpush-syslog-hub-db
npx wrangler queues create logpush-syslog-queue
npx wrangler queues create logpush-syslog-queue-dlq
```

Copy the printed `database_id` into `wrangler.jsonc` →
`d1_databases[0].database_id`.

```bash
# Set your two secrets (generate values with: openssl rand -hex 32)
npx wrangler secret put INGEST_SECRET
npx wrangler secret put ADMIN_SECRET

# Build the UI, apply D1 migrations, and deploy — one command
npm run deploy
```

Open the printed URL, enter your `ADMIN_SECRET`, and continue with
[Set up a destination](#1-set-up-a-destination) above.

> For local dev instead of deploying, copy `.dev.vars.example` to
> `.dev.vars` and fill in test values (git-ignored, never committed).

### Local development

```bash
# Terminal 1 — the Worker (build once first so it has assets to serve)
npm run build
npm run dev:worker    # http://localhost:8787

# Terminal 2 — the web UI with hot reload, proxying /api to :8787
npm run dev:ui        # http://localhost:5173
```

### Running the tests

```bash
npm run typecheck
npm test              # builds the UI, then ~97 tests
```

---

## Troubleshooting

| Symptom | Try this |
|---|---|
| Nothing arrives at my syslog server | Check the Dashboard tab for forwarded/dropped counts and the last error. Use **Test send** to isolate Logpush vs. delivery issues. |
| Messages look truncated or merged | Switch the destination's [Framing](#framing-which-one-do-i-pick) setting. |
| `Workers VPC` transport fails immediately with `Destination transport is 'vpc' but no SYSLOG_VPC binding is configured` | Confirm `vpc_networks` in `wrangler.jsonc` is uncommented with a real tunnel ID, and that you've redeployed since changing it. If you added the binding through the dashboard's **Bindings** UI directly (rather than `wrangler.jsonc`), the *next* `wrangler deploy` will silently remove it — Wrangler treats `wrangler.jsonc` as the full source of truth for bindings. Always mirror any dashboard-added binding into `wrangler.jsonc` before deploying again (check `wrangler versions view <latest-id>` if unsure what's actually live). |
| A destination with **TLS on** fails immediately with `TLS is not supported over the 'vpc' transport` | Workers VPC connections are plaintext-only. Either turn TLS off on that destination, or switch transport to `Direct` and terminate TLS at the receiver (e.g. rsyslog's `imtcp` with a `gtls` driver, or a TLS-terminating proxy in front of it). |
| `Workers VPC` transport connects (no binding error) but still fails with `Connection to <host>:<port> timed out` | The binding itself is fine — the failure is between the tunnel and your private destination. Check, in order: (1) is a **TCP** listener actually running on that host/port (`ss -tlnp \| grep <port>` on the destination) — syslog daemons default to UDP; (2) is the `cloudflared` connector for this tunnel Healthy in **Zero Trust → Networks → Tunnels**, not Down/Inactive; (3) local firewall rules on the destination host. Isolate with `nc -zv <host> <port>` run from wherever `cloudflared` itself is running — if that also fails, it's not a Cloudflare-side problem. |
| **Every** delivery times out after 8s (both `direct` and `vpc`), even to hosts you know are reachable and listening on TCP | This was a bug in this Worker (fixed): the send path awaited `socket.closed`, but a TCP syslog daemon receives the record and holds the connection open indefinitely without sending anything back — and since the Worker never drains `socket.readable`, `socket.closed` never resolved, so every real delivery hung to the timeout. Delivery now completes on the TCP handshake (`socket.opened`) plus the write/flush, and does **not** wait for the peer to close. If you're on an older build and seeing universal timeouts, redeploy from `main`. A successful **Test send** now echoes back `remoteAddress` — the actual TCP peer it reached. |
| Logpush job creation fails: `Invalid destination configuration: error writing object: error uploading to https: status:405` | Your `destination_conf` URL is missing `/api/ingest/:dataset` — it's most likely pointing at the site root (or an old pre-merge `/ingest/...` path). Cloudflare validates every HTTP destination by POSTing a small test payload to the URL you gave it; anything outside `/api/*` is the web UI (GET/HEAD only), so a POST there is rejected. Fix the URL to `https://<your-worker>.workers.dev/api/ingest/<dataset>?header_Authorization=Bearer%20<INGEST_SECRET>` and try again. |
| Dashboard rejects the job with `invalid destination_conf: config string must match "^[a-zA-Z0-9\.,_:/?%+&=\{\}-]+$"` | That regex has no literal space in its allowed characters. Your `header_Authorization=Bearer%20<SECRET>` query param must keep `%20` as the three literal characters `%`, `2`, `0` — if it got turned back into a real space (e.g. by retyping instead of pasting), this is the error you'll get. Paste the URL directly rather than retyping it; if the dashboard keeps mangling it, use the [API method](#2-point-a-logpush-job-at-it) instead. |
| Logpush job creation fails with a different/other validation error | Double-check `INGEST_SECRET` matches exactly, including the URL-encoded `Bearer%20` prefix — the ingest endpoint must return `2xx` during Logpush's validation POST. |
| **Test send** (or real delivery) fails with `Connection to <host>:<port> timed out after 8000ms`, `transport: direct` | Two likely causes, in order of likelihood: (1) the server only listens on **UDP**, not TCP, on that port — Cloudflare Workers can only open outbound **TCP** connections, no raw UDP support; (2) an IP-based firewall/security group is dropping the connection. For (2): unlike `fetch()`, Workers' TCP `connect()` egress is **not** sourced from Cloudflare's published IP ranges, so there's no fixed list you can allowlist. If the same host:port is reachable via `nc -zv <host> <port>` from an unrelated machine but times out here, an IP allowlist is almost certainly why — switch that destination to `Workers VPC` instead, which authenticates via the tunnel rather than source IP. |
| **Test send** reports `{"ok":true}` and echoes a `remoteAddress`, but **nothing arrives** at your syslog server | `ok:true` means the TCP handshake completed and the bytes were written to that peer — check the echoed `remoteAddress` is actually your server. If it is, the bytes reached it, so the gap is on the receiver: confirm the daemon is listening on **TCP** (not UDP) on that port (`ss -tlnp \| grep <port>`), and that its framing expectation matches the destination's [Framing](#framing-which-one-do-i-pick) setting (rsyslog's `imtcp` wants newline-delimited by default; octet-counting needs `SupportOctetCountedFraming`). Also double check the receiver's config filters on `$rawmsg`, not `$msg` — see the [test receiver section](#dont-have-a-syslog-server-yet-one-command-test-receiver) for why. |
| **Test send** fails fast (<1s) with `proxy request failed, cannot connect to the specified address` | The destination host resolves to a **Cloudflare IP** and [outbound TCP to Cloudflare IP ranges is blocked](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations). Run `dig +short <host>` — if it returns a Cloudflare anycast address (e.g. `104.16.0.0/12`), that hostname is **proxied** (orange cloud), not your origin. Fix: switch the DNS record to **DNS only** (grey cloud) so it resolves to your real origin, or set the destination to the raw origin IP. (If the error additionally says *"consider using fetch instead"*, you pointed it at an HTTP port like 80/443 — use a real syslog TCP port such as 514.) |
| **Test send** for a dataset other than `http_requests`/`firewall_events` shows mostly-empty CEF extensions | Shouldn't happen — every one of the [9 supported datasets](#supported-datasets) has a matching built-in sample record used by **Test send**. If you're passing a custom `record` in the API request body instead of relying on the built-in sample, make sure its field names match the mapping's `sourceField`s exactly (case-sensitive). |
| My syslog receiver rejects lines as too long, or truncates them | Turn off **Include raw JSON** on that destination (see [Syslog output format](#syslog-output-format)) — the mapped CEF fields alone are much shorter. The `raw=` extension is capped at 8 KB and self-truncates with a `...<truncated>` marker for pathological records (e.g. `http_requests`' `Subrequests` array), but some collectors have stricter line-length limits than that. |
| A mapped field that's a JSON array or object (e.g. `SecurityActions`, `Metadata`, `NewValue`) shows up as `[object Object]` | This was a bug in this Worker (fixed): array/object-valued Logpush fields are now JSON-encoded before being written into the CEF extension. If you're on an older build, redeploy from `main`. |
| Web UI shows "Unauthorized" | Your `ADMIN_SECRET` doesn't match what's deployed. Click **Disconnect** and re-enter it. |

> **Heads up:** Cloudflare's destination validation sends one real POST with
> a tiny test payload (`{"content":"tests"}`) to your `destination_conf` URL
> when you create or update an HTTP Logpush job. If a destination already
> exists for that dataset, you'll see this show up as one harmless extra
> delivery/CEF line the first time — that's expected, not a bug.

---

## Roadmap

**Recently shipped:** SOC-focused field expansion across all 9 default
mappings covering bot detection, WAF tuning, DDoS, credential-leak
detection, insider threat, and 0-day/threat-intel hunting (see
[SOC_USE_CASES.md](SOC_USE_CASES.md)) · a `raw=<full record JSON>` CEF
extension so no field is ever silently dropped, on by default and
configurable per destination · TLS for `Direct` destinations (RFC 5425) ·
RFC 5424 syslog format · configurable syslog facility · 7 additional
default dataset mappings (`dns_logs`, `spectrum_events`, `gateway_http`,
`gateway_dns`, `gateway_network`, `audit_logs`, `nel_reports`).

- [ ] UDP delivery via an optional relay
- [ ] Even more default mappings (`access_requests`, `casb_findings`,
      `email_security_alerts`, `network_analytics_logs`, `ssh_logs`,
      `workers_trace_events`, `zero_trust_network_sessions`)
- [ ] Per-destination filtering and sampling
- [ ] Cloudflare Access-protected admin UI (instead of a shared secret)

## Contributing

Issues and PRs welcome. Run `npm run typecheck` and `npm test` before
submitting.

## License

[MIT](LICENSE)
