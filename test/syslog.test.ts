import { describe, expect, it } from "vitest";
import { frameMessage, sendSyslogMessage, SyslogDeliveryError } from "../src/services/syslog.js";

describe("frameMessage", () => {
  it("prefixes an RFC 6587 octet count", () => {
    const chunks = frameMessage("hello", "rfc6587");
    const decoder = new TextDecoder();
    expect(chunks.map((c) => decoder.decode(c))).toEqual(["5 ", "hello"]);
  });

  it("computes byte length (not char length) for multi-byte text", () => {
    const chunks = frameMessage("é", "rfc6587"); // 2 bytes in UTF-8
    const decoder = new TextDecoder();
    expect(decoder.decode(chunks[0])).toBe("2 ");
  });

  it("appends a trailing newline for newline framing", () => {
    const chunks = frameMessage("hello", "newline");
    const decoder = new TextDecoder();
    expect(chunks.map((c) => decoder.decode(c))).toEqual(["hello", "\n"]);
  });
});

describe("sendSyslogMessage", () => {
  it("throws SyslogDeliveryError when transport is 'vpc' but no binding is configured", async () => {
    await expect(
      sendSyslogMessage(
        { host: "10.0.0.1", port: 514, transport: "vpc", frame: "rfc6587", tls: false },
        "hello",
        undefined,
      ),
    ).rejects.toBeInstanceOf(SyslogDeliveryError);
  });

  it("rejects tls=true combined with transport='vpc' with a clear error, even if a binding IS configured", async () => {
    // Workers VPC connect() is plaintext-only — this must fail fast with a
    // clear message rather than silently sending unencrypted bytes, or
    // (worse) attempting something the binding doesn't support.
    const vpcBinding = {
      connect: () => {
        throw new Error("connect() should not be called when tls+vpc is rejected up front");
      },
    };
    await expect(
      sendSyslogMessage(
        { host: "10.0.0.1", port: 514, transport: "vpc", frame: "rfc6587", tls: true },
        "hello",
        vpcBinding,
      ),
    ).rejects.toThrow(/TLS is not supported over the 'vpc' transport/);
  });

  it("uses the provided VPC binding's connect() when transport is 'vpc'", async () => {
    const written: Uint8Array[] = [];
    const fakeSocket = {
      opened: Promise.resolve({ remoteAddress: "10.0.0.1:514", localAddress: "0.0.0.0:0" }),
      writable: {
        getWriter: () => ({
          write: async (chunk: Uint8Array) => {
            written.push(chunk);
          },
          close: async () => undefined,
        }),
      },
      closed: Promise.resolve(undefined),
      close: async () => undefined,
    };
    const vpcBinding = {
      connect: (address: string) => {
        expect(address).toBe("10.0.0.1:514");
        return fakeSocket as unknown as Socket;
      },
    };

    const info = await sendSyslogMessage(
      { host: "10.0.0.1", port: 514, transport: "vpc", frame: "rfc6587", tls: false },
      "hi",
      vpcBinding,
    );

    const decoder = new TextDecoder();
    expect(written.map((c) => decoder.decode(c))).toEqual(["2 ", "hi"]);
    // Returns the real peer address as proof of a completed handshake.
    expect(info.remoteAddress).toBe("10.0.0.1:514");
  });

  it("surfaces the real error when the connection is rejected (opened rejects)", async () => {
    // A hard connect failure — Cloudflare-IP block, HTTP-port guard, connection
    // refused — surfaces as `socket.opened` rejecting quickly. Even if buffered
    // writes resolve and the socket never reaches a clean `closed`, we must
    // report that underlying error rather than a generic timeout or false success.
    const rejectedSocket = {
      opened: Promise.reject(new Error("proxy request failed, cannot connect to the specified address")),
      writable: {
        getWriter: () => ({
          write: async () => undefined, // buffered write resolves immediately
          close: async () => undefined,
        }),
      },
      closed: new Promise<void>(() => undefined), // never closes cleanly
      close: async () => undefined,
    };
    const vpcBinding = {
      connect: () => rejectedSocket as unknown as Socket,
    };

    await expect(
      sendSyslogMessage(
        { host: "10.0.0.1", port: 514, transport: "vpc", frame: "newline", tls: false },
        "hi",
        vpcBinding,
        5_000, // long enough that a timeout would NOT be what we assert on
      ),
    ).rejects.toThrow(/proxy request failed/);
  });

  it("times out when the socket never closes cleanly (blackholed destination)", async () => {
    // No listener / firewall drop: writes may buffer and `opened` never settles
    // either way, so `socket.closed` never resolves. Must time out, not hang.
    let closed = false;
    const blackholeSocket = {
      opened: new Promise<never>(() => undefined), // never resolves or rejects
      writable: {
        getWriter: () => ({
          write: async () => undefined, // buffered write resolves immediately
          close: async () => undefined,
        }),
      },
      closed: new Promise<void>(() => undefined), // never closes
      close: async () => {
        closed = true;
      },
    };
    const vpcBinding = {
      connect: () => blackholeSocket as unknown as Socket,
    };

    await expect(
      sendSyslogMessage(
        { host: "10.0.0.1", port: 514, transport: "vpc", frame: "newline", tls: false },
        "hi",
        vpcBinding,
        50, // short timeout so the test itself doesn't hang
      ),
    ).rejects.toThrow(/timed out after 50ms/);

    expect(closed).toBe(true);
  });

  it("times out instead of hanging forever when a connected destination never drains writes", async () => {
    // Handshake completes, but the peer never accepts our bytes (stuck write).
    let closed = false;
    const stuckWriteSocket = {
      opened: Promise.resolve({ remoteAddress: "10.0.0.1:514", localAddress: "0.0.0.0:0" }),
      writable: {
        getWriter: () => ({
          write: () => new Promise<void>(() => undefined), // never resolves
          close: async () => undefined,
        }),
      },
      closed: new Promise<void>(() => undefined),
      close: async () => {
        closed = true;
      },
    };
    const vpcBinding = {
      connect: () => stuckWriteSocket as unknown as Socket,
    };

    await expect(
      sendSyslogMessage(
        { host: "10.0.0.1", port: 514, transport: "vpc", frame: "newline", tls: false },
        "hi",
        vpcBinding,
        50,
      ),
    ).rejects.toThrow(/timed out after 50ms/);

    expect(closed).toBe(true);
  });
});
