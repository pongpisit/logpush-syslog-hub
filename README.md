# logpush-syslog-hub

Forward **Cloudflare Logpush** logs to any syslog server or SIEM as
standard **CEF over TCP** — Splunk, QRadar, Elastic, Graylog, rsyslog,
syslog-ng, or anything that listens on a TCP port. No custom parser needed
on the receiving end.

It's one Cloudflare Worker: it receives the logs, forwards them, *and*
serves a small web UI for managing where they go.

- **One-click deploy** — a single Worker, one URL, no infrastructure to manage
- **Generic CEF output** — standard keys any CEF-aware receiver already understands
- **Multiple destinations** — one Logpush job can fan out to many syslog servers
- **Reliable delivery** — a Cloudflare Queue retries failed deliveries automatically
- **Public or private targets** — plain TCP, or private via a Cloudflare Tunnel

> **Scope today:** plaintext TCP only (no TLS, no UDP yet). See [Roadmap](#roadmap).

---

## Quick start

1. Click **Deploy to Cloudflare** below.
2. When asked, generate two secrets and paste them in:
   ```bash
   openssl rand -hex 32
   ```
   - `INGEST_SECRET` — Logpush uses this to authenticate to the Worker
   - `ADMIN_SECRET` — you use this to log in to the web UI
3. Cloudflare creates the database, queue, and web UI for you automatically.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pongpisit/logpush-syslog-hub)

When it's done, open the Worker's URL, enter your `ADMIN_SECRET`, and continue with [Set up a destination](#1-set-up-a-destination) below.

Prefer the command line? See [Manual setup](#manual-setup) instead.

---

## How it works

```
Logs:  Cloudflare Logpush → /api/ingest/:dataset → Queue → TCP → your syslog server
Admin: Web UI (this Worker) → /api/admin/* → D1 (stores destinations & mappings)
```

1. Logpush POSTs a batch of logs to `/api/ingest/:dataset`.
2. The Worker checks the batch belongs to one of your destinations, then
   queues one delivery per destination.
3. A queue consumer formats each log as a CEF message and sends it over TCP,
   retrying automatically if delivery fails.
4. Everything else (`/`, `/destinations`, `/mappings`, ...) is the web UI,
   served by the same Worker.

**Why CEF?** It's a plain-text format most log collectors already parse
out of the box, based on its `CEF:0|Vendor|Product|...` header — no custom
grok pattern needed. Two ready-to-use mappings are included
(`http_requests`, `firewall_events`), and you can add your own for any
other Logpush dataset from the **Mappings** tab.

---

## Using it

### 1. Set up a destination

In the web UI, go to **Destinations → + Add destination**:

| Field | What to enter |
|---|---|
| Name | A friendly label, e.g. `Production SIEM` |
| Host / Port | Your syslog server's address, e.g. `10.0.0.5` / `514`. Don't have one yet? [Spin up a disposable one on Debian](#dont-have-a-syslog-server-yet-spin-up-a-disposable-one-on-debian) in under a minute. |
| Transport | `Direct` for a public IP, `Workers VPC` for a private one — see [below](#connecting-to-a-private-syslog-server) |
| Framing | See [Framing](#framing-which-one-do-i-pick) if unsure — `newline` is the safe default |
| Dataset | Which Logpush dataset to receive: `http_requests`, `firewall_events`, or `all` |
| CEF mapping | One of the two included defaults, or your own |

Click **Save**, then click **Test send** on the new destination — it fires
one sample event through the full pipeline without needing a real Logpush
job yet. A green **Delivered** means you're ready to go live.

### 2. Point a Logpush job at it

Run this once per Cloudflare zone (replace `$ZONE_ID`, `$CF_API_TOKEN`,
`<your-worker>`, `<INGEST_SECRET>`):

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

A response with `"success": true` means it's live — logs should start
arriving within a minute or two. To also forward firewall events, repeat
with this `field_names` list, `"dataset": "firewall_events"`, and
`/api/ingest/firewall_events`:

```json
"output_options": {
  "field_names": [
    "RayID","Datetime","ClientIP","ClientCountry","ClientRequestHost",
    "ClientRequestPath","ClientRequestMethod","ClientRequestUserAgent",
    "ClientRequestQuery","EdgeColoCode","EdgeResponseStatus","ZoneName",
    "Action","RuleID","Source"
  ],
  "timestamp_format": "unixnano"
}
```

> ⚠️ **Common mistake:** `header_Authorization` must be exactly
> `Bearer%20<INGEST_SECRET>` — the word `Bearer`, a URL-encoded space
> (`%20`), then your secret. Get this wrong and the job fails to create.
>
> ⚠️ **`field_names` must match your CEF mapping exactly.** Logpush has no
> "send all fields" option — whatever you omit from `field_names` arrives
> as `null` in that record, and this Worker's default CEF mappings
> (`src/shared/cef-defaults.ts`) reference the exact field names above. If
> you're using a custom mapping, open it in the **Mappings** tab of the web
> UI — it now shows the exact `field_names` your mapping needs, with a
> **Copy JSON** button, so this never drifts out of sync.

#### Prefer the dashboard? Here's the same job, click by click

1. Cloudflare dashboard → **Logpush** (account or zone level) → **Create a Logpush job**.
2. **Select a destination** → **HTTP destination**.
3. **HTTP endpoint** — paste the full URL, including the `?header_Authorization=...`
   query string, exactly as generated above. Click **Continue**.
4. **Dataset** — select `HTTP requests` (or `Firewall events`).
5. **Job name** — anything you like.
6. **If logs match** — leave as-is unless you want to filter which events get pushed.
7. **Send the following fields** — this is the dashboard's version of
   `output_options.field_names`. The dashboard's own default field set is
   **not** the same list as above — switch to manual selection and pick
   exactly the fields listed for your dataset, or fields will silently
   arrive as empty in the CEF output.
8. **Advanced Options** → **Timestamp format** — `RFC3339` (the dashboard
   default) is fine; this Worker parses `unixnano`, `unix`, and RFC3339
   timestamps automatically.
9. **Submit**.

> ⚠️ **Dashboard-specific gotcha:** the dashboard validates `destination_conf`
> against the regex `^[a-zA-Z0-9\.,_:/?%+&=\{\}-]+$` — notably, **no literal
> spaces**. The URL above already encodes its one space as `%20`
> (three plain characters: `%`, `2`, `0`), which is valid. If you get
> `invalid destination_conf: config string must match "..."`, something
> along the way turned that `%20` back into a real space character — paste
> the URL directly rather than retyping it. If the dashboard keeps mangling
> it, the [API method](#2-point-a-logpush-job-at-it) above sidesteps this
> entirely.

### 3. Watch it work

The **Dashboard** tab shows, per destination: events forwarded, events
dropped, and the last success/error. If drops keep climbing, click **Test
send** to isolate whether it's a Logpush issue or a delivery issue.

### 4. Customize field mappings (optional)

Go to **Mappings → + Add mapping**, set **Dataset** to any Logpush dataset
name (e.g. `dns_logs`), then add rows mapping a **cefKey** (e.g. `src`) to
either a **sourceField** (a Logpush field name) or a fixed **staticValue**.
Select it on any destination.

---

## Don't have a syslog server yet? Spin up a disposable one on Debian

For a quick PoC, this sets up `rsyslog` on a fresh Debian box (or container)
to listen on TCP and write anything that looks like our CEF output to its
own file.

> **Why this version doesn't die when you disconnect:** an earlier version
> of this script piped straight into an interactive `docker run -it bash`
> and ended with a blocking `tail -f`. Both are fragile — a container's
> whole process tree dies the instant its PID 1 exits (an interactive
> `bash` has no init system to keep other processes alive), and a script
> that ends by blocking on a live terminal makes any SSH drop or closed
> pane look like the whole setup failed. The version below runs the setup
> as a one-shot command against a container whose PID 1 is a stable
> no-op (`sleep infinity`) — daemonized processes like `rsyslogd` get
> reparented to it and keep running no matter what happens to your
> terminal — and watching the logs is a separate, reconnect-anytime step.

**On a real Debian/Ubuntu VM (via SSH),** paste this as whatever user you're
logged in as (e.g. the default `ubuntu` user) — it elevates itself with
`sudo` for the privileged parts, so you don't need to `sudo -i` first.
`rsyslog` runs under systemd, so it's already independent of your SSH
session once installed:

```bash
sudo bash <<'ROOTSCRIPT'
set -euo pipefail

PORT=1514
LOGFILE=/var/log/logpush-syslog-hub.log

apt-get update -y
apt-get install -y rsyslog

cat > /etc/rsyslog.d/10-logpush-syslog-hub.conf <<EOF
module(load="imtcp")
input(type="imtcp" port="${PORT}")

# Anything with our CEF header goes to its own file instead of syslog/messages
if \$msg contains "CEF:0|" then {
    action(type="omfile" file="${LOGFILE}")
    stop
}
EOF

touch "$LOGFILE"
chmod 640 "$LOGFILE"
systemctl enable rsyslog
systemctl restart rsyslog

echo "Done. rsyslog is running under systemd — it'll keep running even if this session disconnects."
echo "Watch logs any time with: sudo tail -f ${LOGFILE}"
ROOTSCRIPT
```

> `sudo bash <<'ROOTSCRIPT' ... ROOTSCRIPT` runs the whole block as root in
> one go, so `apt-get`, writing to `/etc/rsyslog.d/`, and `systemctl` all
> succeed regardless of which user pasted it in. If you skip this and paste
> the inner body directly as a non-root user instead, you'll hit `Permission
> denied` writing to `/etc/rsyslog.d/` — `set -e` then aborts the script
> right there (that's a normal, if abrupt, way for a script to fail; it's
> not related to disconnects).

**In a throwaway Docker container instead,** start it detached first so it
survives disconnects, then run setup as a one-shot `exec` — nothing here
blocks or depends on your terminal staying open:

```bash
# 1. A container whose only job is to stay alive (survives any disconnect)
docker run -d --name logpush-poc -p 1514:1514 debian:12 sleep infinity

# 2. Install and configure rsyslog inside it — safe to lose your
#    connection the moment this command returns
docker exec logpush-poc bash -c '
set -euo pipefail
apt-get update -y
apt-get install -y rsyslog
cat > /etc/rsyslog.d/10-logpush-syslog-hub.conf <<EOF
module(load="imtcp")
input(type="imtcp" port="1514")
if \$msg contains "CEF:0|" then {
    action(type="omfile" file="/var/log/logpush-syslog-hub.log")
    stop
}
EOF
touch /var/log/logpush-syslog-hub.log
rsyslogd
echo "rsyslogd is running, reparented to this container'"'"'s PID 1 — it will survive even if this exec session disconnects."
'

# 3. Watch logs any time — reconnect and rerun this as often as you like
docker exec -it logpush-poc tail -f /var/log/logpush-syslog-hub.log
```

Then, back in the web UI, add a destination pointing at it:

| Field | Value |
|---|---|
| Host | This box's IP (`hostname -I`), or `127.0.0.1` if testing against `wrangler dev` locally |
| Port | `1514` |
| Transport | `Direct` |
| Framing | `newline` (rsyslog's `imtcp` also auto-detects `rfc6587`, so either works) |

Click **Test send** — a CEF line should appear immediately in the `tail -f`
terminal from the script above.

> **Reachability matters:** a **deployed** Worker sends TCP from Cloudflare's
> network, so the receiver needs a **public** IP with the port open (cloud
> firewall / security group, not just `ufw`). Testing against `wrangler dev`
> instead? Use `127.0.0.1` — everything runs on your machine. For a private
> receiver with no public IP, use `Workers VPC` — see
> [below](#connecting-to-a-private-syslog-server).

---

## Connecting to a private syslog server

| Your syslog server is... | Use transport |
|---|---|
| Publicly reachable | `Direct` — plain TCP. Allow inbound from [Workers egress IPs](https://developers.cloudflare.com/workers/platform/known-issues/#outbound-ip-ranges). |
| Private / on-prem | `Workers VPC` — reached through a [Workers VPC Network](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/) bound to a Cloudflare Tunnel or Mesh. |

To enable `Workers VPC`, uncomment and fill in the `vpc_networks` block in
`wrangler.jsonc`, then redeploy:

```jsonc
"vpc_networks": [
  { "binding": "SYSLOG_VPC", "tunnel_id": "<YOUR_TUNNEL_UUID>", "remote": true }
]
```

One binding reaches any host/port behind that tunnel — you don't need one
per destination.

> TCP from Workers (`Direct` or `Workers VPC`) is **plaintext only** today —
> see [Roadmap](#roadmap).

### Framing: which one do I pick?

| Framing | Wire format | Pick this if your syslog receiver... |
|---|---|---|
| `newline` | `<message>\n` | is a typical daemon like rsyslog/syslog-ng (**default choice if unsure**) |
| `rfc6587` | `<byte-length> <message>` | explicitly documents "octet counting" / RFC 6587 support |

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
npm test              # builds the UI, then ~52 tests, ~90% coverage
```

---

## Troubleshooting

| Symptom | Try this |
|---|---|
| Nothing arrives at my syslog server | Check the Dashboard tab for forwarded/dropped counts and the last error. Use **Test send** to isolate Logpush vs. delivery issues. |
| Messages look truncated or merged | Switch the destination's [Framing](#framing-which-one-do-i-pick) setting. |
| `Workers VPC` transport fails immediately with `Destination transport is 'vpc' but no SYSLOG_VPC binding is configured` | Confirm `vpc_networks` in `wrangler.jsonc` is uncommented with a real tunnel ID, and that you've redeployed since changing it. If you added the binding through the dashboard's **Bindings** UI directly (rather than `wrangler.jsonc`), the *next* `wrangler deploy` will silently remove it — Wrangler treats `wrangler.jsonc` as the full source of truth for bindings. Always mirror any dashboard-added binding into `wrangler.jsonc` before deploying again (check `wrangler versions view <latest-id>` if unsure what's actually live). |
| `Workers VPC` transport connects (no binding error) but still fails with `Connection to <host>:<port> timed out` | The binding itself is fine — the failure is between the tunnel and your private destination. Check, in order: (1) is a **TCP** listener actually running on that host/port (`ss -tlnp \| grep <port>` on the destination) — syslog daemons default to UDP; (2) is the `cloudflared` connector for this tunnel Healthy in **Zero Trust → Networks → Tunnels**, not Down/Inactive; (3) local firewall rules on the destination host. Isolate with `nc -zv <host> <port>` run from wherever `cloudflared` itself is running — if that also fails, it's not a Cloudflare-side problem. |
| Logpush job creation fails: `Invalid destination configuration: error writing object: error uploading to https: status:405` | Your `destination_conf` URL is missing `/api/ingest/:dataset` — it's most likely pointing at the site root (or an old pre-merge `/ingest/...` path). Cloudflare validates every HTTP destination by POSTing a small test payload to the URL you gave it; anything outside `/api/*` is the web UI (GET/HEAD only), so a POST there is rejected. Fix the URL to `https://<your-worker>.workers.dev/api/ingest/<dataset>?header_Authorization=Bearer%20<INGEST_SECRET>` and try again. |
| Dashboard rejects the job with `invalid destination_conf: config string must match "^[a-zA-Z0-9\.,_:/?%+&=\{\}-]+$"` | That regex has no literal space in its allowed characters. Your `header_Authorization=Bearer%20<SECRET>` query param must keep `%20` as the three literal characters `%`, `2`, `0` — if it got turned back into a real space (e.g. by retyping instead of pasting), this is the error you'll get. Paste the URL directly rather than retyping it; if the dashboard keeps mangling it, use the [API method](#2-point-a-logpush-job-at-it) instead. |
| Logpush job creation fails with a different/other validation error | Double-check `INGEST_SECRET` matches exactly, including the URL-encoded `Bearer%20` prefix — the ingest endpoint must return `2xx` during Logpush's validation POST. |
| **Test send** (or real delivery) fails with `Connection to <host>:<port> timed out after 8000ms` | The destination never responded to a TCP handshake — no listener, a firewall silently dropping packets, or (most common) the server only listens on **UDP**, not TCP, on that port. Cloudflare Workers can only open outbound **TCP** connections — there's no raw UDP support — so a syslog daemon configured for UDP-only on 514 will always time out here. Confirm the receiving daemon has a TCP listener on that port and that nothing between here and there blocks inbound TCP on it. |
| Web UI shows "Unauthorized" | Your `ADMIN_SECRET` doesn't match what's deployed. Click **Disconnect** and re-enter it. |

> **Heads up:** Cloudflare's destination validation sends one real POST with
> a tiny test payload (`{"content":"tests"}`) to your `destination_conf` URL
> when you create or update an HTTP Logpush job. If a destination already
> exists for that dataset, you'll see this show up as one harmless extra
> delivery/CEF line the first time — that's expected, not a bug.

---

## Roadmap

- [ ] TLS transport for `direct` and `vpc` destinations
- [ ] UDP delivery via an optional relay
- [ ] More default mappings (`gateway_http`, `dns_logs`, `spectrum_events`)
- [ ] Per-destination filtering and sampling
- [ ] Cloudflare Access-protected admin UI (instead of a shared secret)

## Contributing

Issues and PRs welcome. Run `npm run typecheck` and `npm test` before
submitting.

## License

[MIT](LICENSE)
