import { describe, expect, it } from "vitest";
import {
  buildCefMessage,
  escapeCefExtension,
  escapeCefHeader,
  resolveSeverity,
  rfc3164Timestamp,
  rfc5424Timestamp,
  syslogPri,
  TIMESTAMP_FIELD_CANDIDATES,
  toEpochMs,
} from "../src/services/cef.js";
import { DATASET_LABELS, DEFAULT_MAPPING_RULES } from "../src/shared/index.js";

const SUPPORTED_DATASETS = [
  "http_requests",
  "firewall_events",
  "dns_logs",
  "spectrum_events",
  "gateway_http",
  "gateway_dns",
  "gateway_network",
  "audit_logs",
  "nel_reports",
];

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
  it("also bands gateway_http's HTTPStatusCode the same way as EdgeResponseStatus", () => {
    expect(resolveSeverity({ HTTPStatusCode: 403 })).toEqual({ cef: 5, syslog: 4 });
    expect(resolveSeverity({ HTTPStatusCode: 200 })).toEqual({ cef: 0, syslog: 6 });
  });
  it("falls back to firewall Action when no status present", () => {
    expect(resolveSeverity({ Action: "block" })).toEqual({ cef: 7, syslog: 4 });
    expect(resolveSeverity({ Action: "allow" })).toEqual({ cef: 0, syslog: 6 });
  });
  it("treats gateway_dns's ResolverDecision like an Action field", () => {
    expect(resolveSeverity({ ResolverDecision: "overrideForSafeSearch" })).toEqual({ cef: 7, syslog: 4 });
    expect(resolveSeverity({ ResolverDecision: "allow" })).toEqual({ cef: 0, syslog: 6 });
  });
  it("elevates audit_logs' failed ActionResult to a warning", () => {
    expect(resolveSeverity({ ActionResult: false })).toEqual({ cef: 6, syslog: 4 });
    expect(resolveSeverity({ ActionResult: true })).toEqual({ cef: 0, syslog: 6 });
  });
  it("elevates spectrum_events connection failures but leaves routine events informational", () => {
    expect(resolveSeverity({ Event: "tlsError" })).toEqual({ cef: 6, syslog: 4 });
    expect(resolveSeverity({ Event: "originError" })).toEqual({ cef: 6, syslog: 4 });
    expect(resolveSeverity({ Event: "clientFiltered" })).toEqual({ cef: 6, syslog: 4 });
    expect(resolveSeverity({ Event: "connect" })).toEqual({ cef: 0, syslog: 6 });
    expect(resolveSeverity({ Event: "disconnect" })).toEqual({ cef: 0, syslog: 6 });
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

  it("defaults to facility 16 (local0) when none is specified", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: { EdgeResponseStatus: 200 },
      rules: [],
      syslogHostname: "cloudflare",
    });
    // severity 6 (info) + facility 16*8 = 134
    expect(message.startsWith("<134>")).toBe(true);
  });

  it("honors a custom facility in the PRI calculation", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: { EdgeResponseStatus: 200 },
      rules: [],
      syslogHostname: "cloudflare",
      facility: 23, // local7
    });
    // severity 6 (info) + facility 23*8 = 190
    expect(message.startsWith("<190>")).toBe(true);
  });

  it("produces an RFC 5424 header when format='rfc5424'", () => {
    const message = buildCefMessage({
      dataset: "gateway_http",
      record: { HTTPStatusCode: 200, Action: "allow" },
      rules: DEFAULT_MAPPING_RULES.gateway_http ?? [],
      syslogHostname: "cloudflare",
      format: "rfc5424",
    });
    // <PRI>1 ISO8601 hostname app-name procid msgid sd CEF:0|...
    expect(message).toMatch(
      /^<\d+>1 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z cloudflare Logpush gateway_http - - CEF:0\|/,
    );
    expect(message).toContain("Cloudflare|Logpush|1.0|gateway_http|Gateway HTTP Event|");
  });

  it("rfc3164 (default) and rfc5424 carry the same CEF body, only the header differs", () => {
    const opts = {
      dataset: "http_requests",
      record: { ClientIP: "203.0.113.1", EdgeResponseStatus: 200 },
      rules: DEFAULT_MAPPING_RULES.http_requests ?? [],
      syslogHostname: "cloudflare",
    };
    const rfc3164 = buildCefMessage(opts);
    const rfc5424 = buildCefMessage({ ...opts, format: "rfc5424" });
    const cefBody3164 = rfc3164.slice(rfc3164.indexOf("CEF:0"));
    const cefBody5424 = rfc5424.slice(rfc5424.indexOf("CEF:0"));
    expect(cefBody3164).toBe(cefBody5424);
  });

  it("resolves audit_logs' 'When' timestamp field (RFC 5424 header format uses it too)", () => {
    expect(TIMESTAMP_FIELD_CANDIDATES).toContain("When");
    const message = buildCefMessage({
      dataset: "audit_logs",
      record: { When: "2026-01-15T10:30:00Z", ActorEmail: "admin@example.com" },
      rules: DEFAULT_MAPPING_RULES.audit_logs ?? [],
      syslogHostname: "cloudflare",
    });
    expect(message).toContain(`rt=${Date.parse("2026-01-15T10:30:00Z")}`);
    expect(message).toContain("suser=admin@example.com");
  });

  it("has a label and a default mapping for every dataset listed as supported", () => {
    for (const dataset of SUPPORTED_DATASETS) {
      expect(DATASET_LABELS[dataset], `DATASET_LABELS missing '${dataset}'`).toBeTruthy();
      expect(
        DEFAULT_MAPPING_RULES[dataset]?.length,
        `DEFAULT_MAPPING_RULES missing/empty for '${dataset}'`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("rfc5424Timestamp", () => {
  it("formats as full ISO 8601 with millisecond precision", () => {
    const epochMs = Date.UTC(2026, 0, 15, 10, 30, 0, 123);
    expect(rfc5424Timestamp(epochMs)).toBe("2026-01-15T10:30:00.123Z");
  });
});
