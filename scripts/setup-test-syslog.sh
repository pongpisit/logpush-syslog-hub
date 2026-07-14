#!/usr/bin/env bash
#
# setup-test-syslog.sh — stand up a disposable CEF-over-TCP syslog receiver
# for testing logpush-syslog-hub.
#
# It installs and configures rsyslog to:
#   • listen on a TCP port (default 514), and
#   • write every line containing a CEF header (`CEF:0|`) to its own logfile,
#     byte-for-byte, keeping it out of /var/log/syslog.
#
# Works on Debian/Ubuntu (apt), Fedora/RHEL/CentOS (dnf/yum), on a real VM
# (systemd) or inside a plain container (no systemd). Safe to re-run.
#
# Usage:
#   sudo ./setup-test-syslog.sh                 # defaults: port 514
#   sudo PORT=1514 ./setup-test-syslog.sh       # custom port (>=1024 = no root needed to bind)
#   sudo LOGFILE=/tmp/cef.log ./setup-test-syslog.sh
#
# Quick one-liner (review first — piping curl to a root shell is a trust decision):
#   curl -fsSL https://raw.githubusercontent.com/pongpisit/logpush-syslog-hub/main/scripts/setup-test-syslog.sh | sudo bash
#
set -euo pipefail

PORT="${PORT:-514}"
LOGFILE="${LOGFILE:-/var/log/logpush-syslog-hub.log}"
CONF="/etc/rsyslog.d/10-logpush-syslog-hub.conf"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

# --- 0. Must be root (needed for apt/dnf, /etc/rsyslog.d, binding <1024) ----
if [ "$(id -u)" -ne 0 ]; then
  die "Please run as root, e.g.  sudo $0"
fi

# --- 1. Install rsyslog via whatever package manager exists -----------------
if ! command -v rsyslogd >/dev/null 2>&1; then
  log "Installing rsyslog..."
  if   command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y rsyslog
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y rsyslog
  elif command -v yum >/dev/null 2>&1; then
    yum install -y rsyslog
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache rsyslog
  else
    die "No supported package manager found (need apt-get, dnf, yum, or apk). Install rsyslog manually and re-run."
  fi
else
  log "rsyslog already installed."
fi

# --- 2. Write the receiver config -------------------------------------------
# We match on %rawmsg% (the whole unparsed line), NOT %msg%: rsyslog's RFC 3164
# parser treats the token up to the first ':' as the syslog TAG, so for
# "<134>... CEF:0|Cloudflare|..." it eats "CEF:" as the tag and %msg% no longer
# contains "CEF:0|". The template writes %rawmsg% back out verbatim so the full
# CEF line is preserved byte-for-byte.
mkdir -p /etc/rsyslog.d
log "Writing $CONF (listening on TCP $PORT, logging CEF lines to $LOGFILE)..."
cat > "$CONF" <<EOF
module(load="imtcp")
input(type="imtcp" port="${PORT}")

template(name="rawpassthrough" type="string" string="%rawmsg%\n")

# Anything carrying a CEF header goes to its own file, then we stop processing
# so it never also lands in /var/log/syslog.
if \$rawmsg contains "CEF:0|" then {
    action(type="omfile" file="${LOGFILE}" template="rawpassthrough"
           fileCreateMode="0644" createDirs="on")
    stop
}
EOF

# Pre-create the logfile so `tail -f` works immediately. Crucially, on
# Debian/Ubuntu rsyslog drops privileges to the `syslog` user, so a
# root-owned file it can't write to would silently swallow every message.
# Own it by that user when it exists (elsewhere rsyslog runs as root), and
# keep it 0644 so the invoking user's `tail -f` can read it.
touch "$LOGFILE"
chmod 0644 "$LOGFILE"
if id -u syslog >/dev/null 2>&1; then
  chown syslog "$LOGFILE" 2>/dev/null || true
fi

# Some distros' /etc/rsyslog.conf doesn't include the drop-in dir. Make sure ours is loaded.
if [ -f /etc/rsyslog.conf ] && ! grep -Eq '/etc/rsyslog\.d' /etc/rsyslog.conf; then
  log "Main rsyslog.conf didn't include /etc/rsyslog.d — adding the include."
  printf '\ninclude(file="/etc/rsyslog.d/*.conf")\n' >> /etc/rsyslog.conf
fi

# --- 3. (Re)start rsyslog, systemd or not -----------------------------------
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  log "systemd detected — enabling + restarting the rsyslog service."
  systemctl enable rsyslog >/dev/null 2>&1 || true
  systemctl restart rsyslog
  RUN_MODE="systemd"
else
  log "No systemd (container?) — starting rsyslogd directly."
  pkill rsyslogd >/dev/null 2>&1 || true
  sleep 1
  rsyslogd
  RUN_MODE="direct"
fi

# --- 4. Confirm it's actually listening on TCP ------------------------------
sleep 1
LISTENING=""
if command -v ss >/dev/null 2>&1; then
  LISTENING="$(ss -tlnp 2>/dev/null | grep ":${PORT} " || true)"
elif command -v netstat >/dev/null 2>&1; then
  LISTENING="$(netstat -tlnp 2>/dev/null | grep ":${PORT} " || true)"
fi
if [ -n "$LISTENING" ]; then
  log "Confirmed: something is listening on TCP ${PORT}."
else
  warn "Couldn't confirm a TCP listener on ${PORT} (ss/netstat unavailable or blocked)."
  warn "If deliveries don't arrive, check:  journalctl -u rsyslog   or   cat $CONF"
fi

# --- 5. Print next steps ----------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$IP" ] && IP="<this-box-ip>"

cat <<EOF

$(printf '\033[1;32m✓ Test syslog receiver is ready.\033[0m')

  Listening on : TCP ${PORT}${RUN_MODE:+  (${RUN_MODE})}
  Writing to   : ${LOGFILE}

Next steps
  1. Watch the logfile (leave this running in another terminal):
       tail -f ${LOGFILE}

  2. In the logpush-syslog-hub web UI, add a destination:
       Host       ${IP}      (or 127.0.0.1 if testing against 'wrangler dev' locally)
       Port       ${PORT}
       Transport  Direct
       Framing    newline

  3. Click "Test send" — a CEF line should appear in the tail above instantly.

Reachability note
  A *deployed* Worker sends from Cloudflare's network, so this box needs a
  PUBLIC IP with TCP ${PORT} open in your cloud firewall / security group
  (not just a host firewall). Testing against 'wrangler dev'? Use 127.0.0.1.
  Private box with no public IP? Use the 'Workers VPC' transport instead.
EOF
