import { connect } from "cloudflare:sockets";
import type { Destination } from "../shared/index.js";

/**
 * Minimal shape of a Workers VPC Network binding's connect() method.
 * Kept as our own minimal interface (rather than importing the generated
 * `Fetcher` type) because this binding is optional — deployments that don't
 * configure `vpc_networks` in wrangler.jsonc won't have it in their
 * generated `Env` at all, so code can't assume it statically. Matches the
 * real signature (confirmed against `wrangler types` output once a
 * `vpc_networks` binding is configured): `connect()` is lazy/synchronous,
 * just like `cloudflare:sockets`' own `connect()` below — it returns a
 * `Socket` immediately; the handshake happens on first write/read.
 */
export interface VpcNetworkBinding {
  connect(address: string): Socket;
}

export class SyslogDeliveryError extends Error {}

/**
 * `cloudflare:sockets` connect() is lazy: it returns a Socket immediately,
 * and the actual TCP handshake only happens on the first write/read. If the
 * destination silently drops packets (no listener, firewall blackhole — no
 * RST, so it's not a fast failure) that first write's promise can hang far
 * longer than is useful, both for the interactive "Test send" button and for
 * the queue consumer delivering real batches. There is no per-connect
 * timeout option in the sockets API, so this wraps the whole send in one.
 */
const DEFAULT_DELIVERY_TIMEOUT_MS = 8_000;

/**
 * Frame a syslog message per the destination's chosen framing:
 *  - "rfc6587": octet-count prefix `"<byteLength> "` before the message.
 *  - "newline": the message followed by a trailing `\n`.
 * Returns the raw byte chunks to write to the socket, in order.
 */
export function frameMessage(message: string, frame: "rfc6587" | "newline"): Uint8Array[] {
  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(message);
  if (frame === "rfc6587") {
    return [encoder.encode(`${msgBytes.byteLength} `), msgBytes];
  }
  return [msgBytes, encoder.encode("\n")];
}

/**
 * Send one already-formatted syslog message over TCP to a destination.
 * Supports:
 *  - transport "direct": plain TCP via `cloudflare:sockets` connect() (no TLS in this build).
 *  - transport "vpc": plaintext TCP via a Workers VPC Network binding
 *    (reaches any host:port behind the bound Cloudflare Tunnel/Mesh).
 * Framing:
 *  - "rfc6587": octet-count prefix `"<byteLength> "` before the message (robust
 *    length-prefixed TCP syslog framing per RFC 6587).
 *  - "newline": a trailing `\n` after the message (classic line-delimited TCP syslog,
 *    the default expected by most syslog daemons such as rsyslog and syslog-ng).
 */
export async function sendSyslogMessage(
  destination: Pick<Destination, "host" | "port" | "transport" | "frame">,
  message: string,
  vpcBinding: VpcNetworkBinding | undefined,
  timeoutMs = DEFAULT_DELIVERY_TIMEOUT_MS,
): Promise<void> {
  let socket: Socket;
  if (destination.transport === "vpc") {
    if (!vpcBinding) {
      throw new SyslogDeliveryError(
        "Destination transport is 'vpc' but no SYSLOG_VPC binding is configured. " +
          "Add a vpc_networks binding to wrangler.jsonc and redeploy.",
      );
    }
    socket = vpcBinding.connect(`${destination.host}:${destination.port}`);
  } else {
    socket = connect(
      { hostname: destination.host, port: destination.port },
      { secureTransport: "off", allowHalfOpen: false },
    );
  }

  const send = async () => {
    const writer = socket.writable.getWriter();
    try {
      for (const chunk of frameMessage(message, destination.frame)) {
        await writer.write(chunk);
      }
    } finally {
      await writer.close().catch(() => undefined);
    }
    await socket.closed.catch(() => undefined);
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new SyslogDeliveryError(
          `Connection to ${destination.host}:${destination.port} timed out after ${timeoutMs}ms ` +
            "(no response — check the host/port is reachable, listening on TCP, and not firewalled)",
        ),
      );
    }, timeoutMs);
  });

  try {
    await Promise.race([send(), timeout]);
  } finally {
    clearTimeout(timer);
    // On timeout, `send()` is still running against a socket nobody's
    // waiting on anymore — close it so it doesn't leak past this invocation.
    await socket.close().catch(() => undefined);
  }
}
