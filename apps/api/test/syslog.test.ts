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
        { host: "10.0.0.1", port: 514, transport: "vpc", frame: "rfc6587" },
        "hello",
        undefined,
      ),
    ).rejects.toBeInstanceOf(SyslogDeliveryError);
  });

  it("uses the provided VPC binding's connect() when transport is 'vpc'", async () => {
    const written: Uint8Array[] = [];
    const fakeSocket = {
      writable: {
        getWriter: () => ({
          write: async (chunk: Uint8Array) => {
            written.push(chunk);
          },
          close: async () => undefined,
        }),
      },
      closed: Promise.resolve(undefined),
    };
    const vpcBinding = {
      connect: async (address: string) => {
        expect(address).toBe("10.0.0.1:514");
        return fakeSocket as unknown as Socket;
      },
    };

    await sendSyslogMessage(
      { host: "10.0.0.1", port: 514, transport: "vpc", frame: "rfc6587" },
      "hi",
      vpcBinding,
    );

    const decoder = new TextDecoder();
    expect(written.map((c) => decoder.decode(c))).toEqual(["2 ", "hi"]);
  });
});
