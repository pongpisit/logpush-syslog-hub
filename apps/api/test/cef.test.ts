import { describe, expect, it } from "vitest";
import {
  buildCefMessage,
  escapeCefExtension,
  escapeCefHeader,
  resolveSeverity,
  rfc3164Timestamp,
  syslogPri,
  toEpochMs,
} from "../src/services/cef.js";
import { DEFAULT_MAPPING_RULES } from "../src/shared/index.js";

describe("escapeCefHeader", () => {
  it("escapes backslash and pipe", () => {
    expect(escapeCefHeader("a\\b|c")).toBe("a\\\\b\\|c");
  });

  it("handles null/undefined as empty string", () => {
    expect(escapeCefHeader(undefined)).toBe("");
    expect(escapeCefHeader(null)).toBe("");
  });
});

describe("escapeCefExtension", () => {
  it("escapes backslash, equals, CR, LF", () => {
    expect(escapeCefExtension("a=b\\c\r\n")).toBe("a\\=b\\\\c\\r\\n");
  });
});

describe("toEpochMs", () => {
  it("converts nanoseconds to ms", () => {
    expect(toEpochMs(1_720_000_000_000_000_000)).toBe(1_720_000_000_000);
  });

  it("passes through values that already look like ms", () => {
    expect(toEpochMs(1_720_000_000_123)).toBe(1_720_000_000_123);
  });

  it("parses RFC3339 strings", () => {
    expect(toEpochMs("2024-02-17T23:52:01Z")).toBe(Date.parse("2024-02-17T23:52:01Z"));
  });

  it("returns undefined for garbage", () => {
    expect(toEpochMs("not-a-date")).toBeUndefined();
    expect(toEpochMs(undefined)).toBeUndefined();
  });
});

describe("rfc3164Timestamp", () => {
  it("formats as 'Mmm DD HH:MM:SS' in UTC", () => {
    const epochMs = Date.UTC(2024, 1, 5, 3, 4, 5); // Feb 5, 2024
    expect(rfc3164Timestamp(epochMs)).toBe("Feb  5 03:04:05");
  });
});

describe("resolveSeverity", () => {
  it("maps 2xx to info", () => {
    expect(resolveSeverity({ EdgeResponseStatus: 200 })).toEqual({ cef: 0, syslog: 6 });
  });
  it("maps 3xx to low/info", () => {
    expect(resolveSeverity({ EdgeResponseStatus: 301 })).toEqual({ cef: 2, syslog: 6 });
  });
  it("maps 4xx to medium/warning", () => {
    expect(resolveSeverity({ EdgeResponseStatus: 404 })).toEqual({ cef: 5, syslog: 4 });
  });
  it("maps 5xx to high/error", () => {
    expect(resolveSeverity({ EdgeResponseStatus: 502 })).toEqual({ cef: 8, syslog: 3 });
  });
  it("falls back to firewall Action when no status present", () => {
    expect(resolveSeverity({ Action: "block" })).toEqual({ cef: 7, syslog: 4 });
    expect(resolveSeverity({ Action: "allow" })).toEqual({ cef: 0, syslog: 6 });
  });
  it("defaults to informational when no signal present", () => {
    expect(resolveSeverity({})).toEqual({ cef: 0, syslog: 6 });
  });
});

describe("syslogPri", () => {
  it("computes facility*8 + severity for local0 (16)", () => {
    expect(syslogPri(6)).toBe(16 * 8 + 6);
    expect(syslogPri(3)).toBe(16 * 8 + 3);
  });
});

describe("buildCefMessage", () => {
  it("produces a well-formed CEF-over-syslog line for http_requests", () => {
    const record = {
      RayID: "abc123",
      EdgeStartTimestamp: 1_720_000_000_000_000_000,
      ClientIP: "203.0.113.1",
      ClientSrcPort: 54321,
      ClientRequestHost: "example.com",
      ClientRequestURI: "/api/v1/data",
      ClientRequestMethod: "GET",
      EdgeResponseStatus: 200,
      ZoneName: "example.com",
    };

    const message = buildCefMessage({
      dataset: "http_requests",
      record,
      rules: DEFAULT_MAPPING_RULES.http_requests ?? [],
      syslogHostname: "cloudflare",
    });

    expect(message).toMatch(/^<\d+>[A-Za-z]{3}\s+\d+\s\d{2}:\d{2}:\d{2} cloudflare CEF:0\|/);
    expect(message).toContain("Cloudflare|Logpush|1.0|http_requests|HTTP Request|0|");
    expect(message).toContain("src=203.0.113.1");
    expect(message).toContain("spt=54321");
    expect(message).toContain("dhost=example.com");
    expect(message).toContain("request=/api/v1/data");
    expect(message).toContain("requestMethod=GET");
    expect(message).toContain("cn1=200 cn1Label=status");
    expect(message).toContain("externalId=abc123");
    expect(message).toContain("cat=http_requests");
  });

  it("emits `rt` exactly once, even though it is auto-populated separately from the mapping rules", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: { EdgeStartTimestamp: 1_720_000_000_000_000_000, ClientIP: "203.0.113.1" },
      rules: DEFAULT_MAPPING_RULES.http_requests ?? [],
      syslogHostname: "cloudflare",
    });
    const rtOccurrences = message.match(/\brt=/g) ?? [];
    expect(rtOccurrences).toHaveLength(1);
  });

  it("omits extension keys whose source field is missing", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: { ClientIP: "203.0.113.1" },
      rules: DEFAULT_MAPPING_RULES.http_requests ?? [],
      syslogHostname: "cloudflare",
    });
    expect(message).not.toContain("spt=");
    expect(message).toContain("src=203.0.113.1");
  });

  it("escapes pipe and equals characters found in field values", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: { ClientRequestHost: "exa=mple|.com" },
      rules: DEFAULT_MAPPING_RULES.http_requests ?? [],
      syslogHostname: "cloudflare",
    });
    expect(message).toContain("dhost=exa\\=mple|.com");
  });
});
