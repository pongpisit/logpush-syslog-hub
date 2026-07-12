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
  // Per the Workers VPC docs, this returns `Promise<Socket>` (unlike
  // `cloudflare:sockets`' synchronous `connect()`). We type it as either and
  // `await` it at the call site so the code is correct regardless of which
  // shape the runtime hands back.
  connect(address: string): Socket | Promise<Socket>;
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
): Promise<SocketInfo> {
  let socket: Socket;
  if (destination.transport === "vpc") {
    if (!vpcBinding) {
      throw new SyslogDeliveryError(
        "Destination transport is 'vpc' but no SYSLOG_VPC binding is configured. " +
          "Add a vpc_networks binding to wrangler.jsonc and redeploy.",
      );
    }
    socket = await vpcBinding.connect(`${destination.host}:${destination.port}`);
  } else {
    socket = connect(
      { hostname: destination.host, port: destination.port },
      { secureTransport: "off", allowHalfOpen: false },
    );
  }

  const send = async (): Promise<SocketInfo> => {
    // Completion signal for fire-and-forget TCP syslog:
    //   (1) the TCP handshake completes — `socket.opened` resolves (and rejects
    //       fast on a hard failure: Cloudflare-IP block, HTTP-port guard,
    //       connection refused), giving us the real peer address as proof; AND
    //   (2) our framed bytes are written and our writable half is closed.
    //
    // We deliberately DO NOT await `socket.closed`. A syslog daemon (rsyslog,
    // syslog-ng, …) receives the record and keeps the TCP connection open —
    // it never closes its side and sends nothing back. Since we also never
    // drain `socket.readable`, `socket.closed` would never resolve, so waiting
    // on it made every real delivery hang until the timeout. The outer
    // `finally` force-closes the socket once we're done.
    //
    // `connect()` is lazy (the SYN isn't sent until the first I/O), so we kick
    // off the write concurrently to trigger the connection, then await the
    // handshake and the flush together.
    const writer = socket.writable.getWriter();
    const writeAll = (async () => {
      try {
        for (const chunk of frameMessage(message, destination.frame)) {
          await writer.write(chunk);
        }
      } finally {
        await writer.close().catch(() => undefined);
      }
    })();

    let info: SocketInfo;
    try {
      info = await socket.opened;
    } catch (err) {
      throw err instanceof Error ? err : new SyslogDeliveryError(String(err));
    }
    await writeAll;
    return info;
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
    return await Promise.race([send(), timeout]);
  } finally {
    clearTimeout(timer);
    // On timeout, `send()` is still running against a socket nobody's
    // waiting on anymore — close it so it doesn't leak past this invocation.
    await socket.close().catch(() => undefined);
  }
}
