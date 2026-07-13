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

describe("buildCefMessage — raw JSON passthrough (SOC field coverage guarantee)", () => {
  it("appends a raw= extension containing the full record as JSON by default", () => {
    const record = { ClientIP: "203.0.113.1", SomeFutureField: "not yet mapped by any rule" };
    const message = buildCefMessage({
      dataset: "http_requests",
      record,
      rules: [],
      syslogHostname: "cloudflare",
    });
    expect(message).toContain(`raw=${JSON.stringify(record)}`);
  });

  it("omits raw= when includeRaw is explicitly false", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: { ClientIP: "203.0.113.1" },
      rules: [],
      syslogHostname: "cloudflare",
      includeRaw: false,
    });
    expect(message).not.toContain("raw=");
  });

  it("omits raw= entirely for an empty record", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: {},
      rules: [],
      syslogHostname: "cloudflare",
    });
    expect(message).not.toContain("raw=");
  });

  it("truncates an oversized record instead of producing an unbounded line", () => {
    const hugeArray = Array.from({ length: 2000 }, (_, i) => `item-${i}`);
    const message = buildCefMessage({
      dataset: "http_requests",
      record: { HugeField: hugeArray },
      rules: [],
      syslogHostname: "cloudflare",
    });
    expect(message).toContain("truncated");
    // The whole message should still be bounded, not multi-hundred-KB.
    expect(message.length).toBeLessThan(20_000);
  });

  it("still escapes CEF-reserved characters inside the raw JSON blob", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: { ClientRequestHost: "a=b" },
      rules: [],
      syslogHostname: "cloudflare",
    });
    // The JSON string contains a literal `=` inside the value; CEF
    // extension escaping must still apply within raw=.
    expect(message).toContain('raw={"ClientRequestHost":"a\\=b"}');
  });
});

describe("buildCefMessage — SOC field mappings (bot/WAF/DDoS/creds-leak/insider-threat/0-day)", () => {
  it("maps http_requests bot-detection and WAF-tuning fields (bot, WAF, 0-day use cases)", () => {
    const message = buildCefMessage({
      dataset: "http_requests",
      record: {
        ClientIP: "203.0.113.1",
        SecurityAction: "block",
        SecurityRuleID: "abc123",
        SecurityActions: ["block", "log"],
        SecuritySources: ["waf", "botManagement"],
        BotScore: 4,
        BotScoreSrc: "Machine Learning",
        JA3Hash: "e7d705a3286e19ea42f587b344ee6865",
        WAFAttackScore: 8,
        ClientASN: 64500,
        ClientIPClass: "scan",
        LeakedCredentialCheckResult: "username_and_password_leaked",
      },
      rules: DEFAULT_MAPPING_RULES.http_requests ?? [],
      syslogHostname: "cloudflare",
      includeRaw: false,
    });
    expect(message).toContain("act=block");
    expect(message).toContain("deviceExternalId=abc123");
    // Array-valued fields are JSON-encoded (not comma-joined), so a value
    // containing a literal comma is never ambiguous with the array's own
    // element separator.
    expect(message).toContain('cs7=["block","log"] cs7Label=securityActions');
    expect(message).toContain('cs9=["waf","botManagement"] cs9Label=securitySources');
    expect(message).toContain("cn2=4 cn2Label=botScore");
    expect(message).toContain("cs14=e7d705a3286e19ea42f587b344ee6865 cs14Label=ja3Hash");
    expect(message).toContain("cn3=8 cn3Label=wafAttackScore");
    expect(message).toContain("cs10=64500 cs10Label=clientAsn");
    expect(message).toContain("cs11=scan cs11Label=clientIpClass");
    expect(message).toContain("cs15=username_and_password_leaked cs15Label=leakedCredResult");
  });

  it("maps firewall_events security-product attribution fields (WAF/DDoS use cases)", () => {
    const message = buildCefMessage({
      dataset: "firewall_events",
      record: {
        ClientIP: "203.0.113.2",
        Action: "block",
        Source: "l7ddos",
        Description: "DDoS mitigation",
        ClientASN: 64501,
        ClientASNDescription: "EXAMPLE-ISP",
      },
      rules: DEFAULT_MAPPING_RULES.firewall_events ?? [],
      syslogHostname: "cloudflare",
      includeRaw: false,
    });
    expect(message).toContain("reason=DDoS mitigation");
    expect(message).toContain("cs2=l7ddos cs2Label=securitySource");
    expect(message).toContain("cs7=64501 cs7Label=clientAsn");
    expect(message).toContain("cs8=EXAMPLE-ISP cs8Label=clientAsnDescription");
  });

  it("maps gateway_http blocked-file fields to the standard CEF file* keys (insider-threat/malware use case)", () => {
    const message = buildCefMessage({
      dataset: "gateway_http",
      record: {
        SourceIP: "203.0.113.5",
        Action: "block",
        BlockedFileHash: "d41d8cd98f00b204e9800998ecf8427e",
        BlockedFileName: "invoice.exe",
        BlockedFileType: "exe",
        BlockedFileSize: 204800,
        BlockedFileReason: "malware detected",
        DownloadMatchedDlpProfiles: ["PCI-DSS"],
      },
      rules: DEFAULT_MAPPING_RULES.gateway_http ?? [],
      syslogHostname: "cloudflare",
      includeRaw: false,
    });
    expect(message).toContain("fileHash=d41d8cd98f00b204e9800998ecf8427e");
    expect(message).toContain("fileName=invoice.exe");
    expect(message).toContain("fileType=exe");
    expect(message).toContain("fileSize=204800");
    expect(message).toContain("reason=malware detected");
    expect(message).toContain('cs8=["PCI-DSS"] cs8Label=dlpDownloadProfiles');
  });

  it("JSON-encodes object-valued fields instead of emitting '[object Object]' (insider-threat audit trail use case)", () => {
    const message = buildCefMessage({
      dataset: "audit_logs",
      record: {
        ActorEmail: "admin@example.com",
        ActionType: "update",
        OldValue: { security_level: "high" },
        NewValue: { security_level: "essentially_off" },
        Metadata: { zone_name: "example.com" },
      },
      rules: DEFAULT_MAPPING_RULES.audit_logs ?? [],
      syslogHostname: "cloudflare",
      includeRaw: false,
    });
    expect(message).not.toContain("[object Object]");
    expect(message).toContain('cs6={"security_level":"high"} cs6Label=oldValue');
    expect(message).toContain('cs7={"security_level":"essentially_off"} cs7Label=newValue');
  });

  it("maps gateway_dns threat-intel feed matches (0-day/IOC hunting use case)", () => {
    const message = buildCefMessage({
      dataset: "gateway_dns",
      record: {
        SrcIP: "203.0.113.6",
        QueryName: "malicious-c2.example",
        ResolverDecision: "block",
        MatchedIndicatorFeedNames: ["Vendor Malware Feed"],
        MatchedCategoryNames: ["Malware"],
      },
      rules: DEFAULT_MAPPING_RULES.gateway_dns ?? [],
      syslogHostname: "cloudflare",
      includeRaw: false,
    });
    expect(message).toContain('cs7=["Vendor Malware Feed"] cs7Label=matchedIndicatorFeedNames');
    expect(message).toContain('cs6=["Malware"] cs6Label=matchedCategoryNames');
  });

  it("maps spectrum_events DDoS/network-attribution fields, respecting the API's own field casing", () => {
    const message = buildCefMessage({
      dataset: "spectrum_events",
      record: {
        ClientIP: "203.0.113.7",
        Event: "originError",
        ClientAsn: 64502, // note: lowercase "sn", not "ASN" — matches Cloudflare's docs
        OriginTlsFingerprint: "2d9f9e6f1a7b3c4d",
      },
      rules: DEFAULT_MAPPING_RULES.spectrum_events ?? [],
      syslogHostname: "cloudflare",
      includeRaw: false,
    });
    expect(message).toContain("cs5=64502 cs5Label=clientAsn");
    expect(message).toContain("cs7=2d9f9e6f1a7b3c4d cs7Label=originTlsFingerprint");
  });

  it("skips empty arrays instead of emitting a dangling cefKey=<empty>", () => {
    const message = buildCefMessage({
      dataset: "gateway_dns",
      record: { SrcIP: "203.0.113.6", MatchedIndicatorFeedNames: [] },
      rules: DEFAULT_MAPPING_RULES.gateway_dns ?? [],
      syslogHostname: "cloudflare",
      includeRaw: false,
    });
    expect(message).not.toContain("cs7=");
    expect(message).not.toContain("matchedIndicatorFeedNames");
  });
});
