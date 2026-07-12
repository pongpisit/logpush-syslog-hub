import { DATASET_LABELS, type LogpushRecord, type MappingRule } from "../shared/index.js";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Escape `\` and `|` for CEF header fields. */
export function escapeCefHeader(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** Escape `\`, `=`, CR, and LF for CEF extension values. */
export function escapeCefExtension(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/=/g, "\\=")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/**
 * Best-effort conversion of a Logpush timestamp field to epoch milliseconds.
 * Logpush timestamps may be unixnano (default), unix seconds, or an
 * RFC3339 string, depending on how the job's output_options are configured.
 */
export function toEpochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e14) return Math.floor(value / 1_000_000); // nanoseconds
    if (value > 1e11) return Math.floor(value); // already milliseconds
    if (value > 1e9) return Math.floor(value * 1000); // seconds (with fraction room)
    return Math.floor(value * 1000); // seconds
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/** RFC 3164 timestamp: "Mmm DD HH:MM:SS" (UTC). */
export function rfc3164Timestamp(epochMs?: number): string {
  const d = epochMs !== undefined ? new Date(epochMs) : new Date();
  const month = MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, " ");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}:${ss}`;
}

export interface Severity {
  cef: number; // 0-10
  syslog: number; // 0-7 (RFC 5424 severity)
}

/** Action/decision values across datasets that indicate a blocking outcome. */
const BLOCKING_ACTIONS = [
  "block",
  "challenge",
  "jschallenge",
  "managedchallenge",
  "connectionclose",
  "override", // gateway_dns ResolverDecision, e.g. "overrideForSafeSearch"
  "isolate",
  "quarantine",
];

/** spectrum_events "Event" values that represent a failure, not routine traffic. */
const SPECTRUM_FAILURE_EVENTS = ["tlserror", "originerror", "clientfiltered"];

/**
 * Generic severity resolver that works across all supported datasets, tried
 * in order until one signal is found:
 *  1. HTTP status code — `EdgeResponseStatus` (http_requests) or
 *     `HTTPStatusCode` (gateway_http). Banded per standard HTTP semantics.
 *  2. `ActionResult` boolean (audit_logs) — `false` (a failed administrative
 *     action) is elevated to a warning.
 *  3. A block/allow-style decision field — `Action` (firewall_events,
 *     gateway_http, gateway_network) or `ResolverDecision` (gateway_dns).
 *  4. `Event` (spectrum_events) — connection failures are elevated.
 *  5. Defaults to informational when no signal is present.
 */
export function resolveSeverity(record: LogpushRecord): Severity {
  const status = record["EdgeResponseStatus"] ?? record["HTTPStatusCode"];
  if (typeof status === "number") {
    if (status >= 500) return { cef: 8, syslog: 3 };
    if (status >= 400) return { cef: 5, syslog: 4 };
    if (status >= 300) return { cef: 2, syslog: 6 };
    return { cef: 0, syslog: 6 };
  }

  const actionResult = record["ActionResult"];
  if (typeof actionResult === "boolean") {
    return actionResult ? { cef: 0, syslog: 6 } : { cef: 6, syslog: 4 };
  }

  const action = record["Action"] ?? record["ResolverDecision"];
  if (typeof action === "string" && action.length > 0) {
    const a = action.toLowerCase();
    if (BLOCKING_ACTIONS.some((keyword) => a.includes(keyword))) return { cef: 7, syslog: 4 };
    if (a === "allow") return { cef: 0, syslog: 6 };
    return { cef: 3, syslog: 6 };
  }

  const event = record["Event"];
  if (typeof event === "string" && SPECTRUM_FAILURE_EVENTS.includes(event.toLowerCase())) {
    return { cef: 6, syslog: 4 };
  }

  return { cef: 0, syslog: 6 };
}

/** Syslog PRI = facility * 8 + severity. Facility 16 = local0. */
export function syslogPri(syslogSeverity: number, facility = 16): number {
  return facility * 8 + syslogSeverity;
}

/**
 * Logpush record fields (tried in order) that carry the event's own
 * timestamp, across all supported datasets. Exported so the admin UI's
 * mapping editor can tell users which timestamp field their Logpush job
 * needs, without duplicating this list by hand.
 */
export const TIMESTAMP_FIELD_CANDIDATES = [
  "EdgeStartTimestamp", // http_requests
  "Datetime", // firewall_events, gateway_http, gateway_dns, gateway_network
  "Timestamp", // dns_logs, spectrum_events, nel_reports
  "When", // audit_logs
  "EdgeEndTimestamp", // fallback
] as const;

/** Find the first present, parseable field among the known timestamp candidates. */
function resolveEventEpochMs(record: LogpushRecord): number | undefined {
  for (const field of TIMESTAMP_FIELD_CANDIDATES) {
    const value = record[field];
    if (value !== undefined && value !== null) {
      const ms = toEpochMs(value);
      if (ms !== undefined) return ms;
    }
  }
  return undefined;
}

/** RFC 5424 TIMESTAMP: full ISO 8601 with millisecond precision, e.g. "2026-07-12T14:41:20.123Z". */
export function rfc5424Timestamp(epochMs?: number): string {
  const d = epochMs !== undefined ? new Date(epochMs) : new Date();
  return d.toISOString();
}

/**
 * Sanitize a value for use in an RFC 5424 header field (APP-NAME, PROCID,
 * MSGID): these are restricted to printable US-ASCII with no spaces. Falls
 * back to "-" (the RFC 5424 NILVALUE) for empty/all-invalid input.
 */
function sanitizeSyslogHeaderField(value: string, maxLen: number): string {
  const cleaned = value.replace(/[^\x21-\x7e]/g, "").slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : "-";
}

export interface BuildCefMessageOptions {
  dataset: string;
  record: LogpushRecord;
  rules: MappingRule[];
  syslogHostname: string;
  /** Syslog header format. Defaults to "rfc3164" for backward compatibility. */
  format?: "rfc3164" | "rfc5424";
  /** Syslog facility (0-23). Defaults to 16 (local0). */
  facility?: number;
}

/**
 * Build a full CEF-over-syslog message, in either syslog header format:
 *  - RFC 3164 (default): `<PRI>Mmm DD HH:MM:SS hostname CEF:0|Vendor|Product|Version|SignatureId|Name|Severity|extension`
 *  - RFC 5424: `<PRI>1 ISO8601-timestamp hostname app-name procid msgid - CEF:0|...`
 *    (STRUCTURED-DATA and MSGID are emitted as "-"/nilvalue — CEF's own
 *    extension fields already carry structured information, so no
 *    SD-ELEMENT is generated. PROCID carries the dataset name so a
 *    receiver can bucket events without parsing the CEF body.)
 */
export function buildCefMessage(opts: BuildCefMessageOptions): string {
  const { dataset, record, rules, syslogHostname, format = "rfc3164", facility = 16 } = opts;
  const eventEpochMs = resolveEventEpochMs(record);
  const severity = resolveSeverity(record);
  const pri = syslogPri(severity.syslog, facility);
  const hostname = escapeCefHeader(syslogHostname) || "-";
  const name = DATASET_LABELS[dataset] ?? dataset;

  const cefHeader = [
    "CEF:0",
    escapeCefHeader("Cloudflare"),
    escapeCefHeader("Logpush"),
    escapeCefHeader("1.0"),
    escapeCefHeader(dataset),
    escapeCefHeader(name),
    String(severity.cef),
  ].join("|");

  const extensionParts: string[] = [];
  if (eventEpochMs !== undefined) {
    extensionParts.push(`rt=${eventEpochMs}`);
  }
  extensionParts.push(`cat=${escapeCefExtension(dataset)}`);

  for (const rule of rules) {
    const raw = rule.staticValue ?? (rule.sourceField ? record[rule.sourceField] : undefined);
    if (raw === undefined || raw === null || raw === "") continue;
    extensionParts.push(`${rule.cefKey}=${escapeCefExtension(raw)}`);
    if (rule.label) {
      extensionParts.push(`${rule.cefKey}Label=${escapeCefExtension(rule.label)}`);
    }
  }

  const cefBody = `${cefHeader}|${extensionParts.join(" ")}`;

  if (format === "rfc5424") {
    const timestamp = rfc5424Timestamp(eventEpochMs);
    const appName = sanitizeSyslogHeaderField("Logpush", 48);
    const procId = sanitizeSyslogHeaderField(dataset, 128);
    return `<${pri}>1 ${timestamp} ${hostname} ${appName} ${procId} - - ${cefBody}`;
  }

  const timestamp = rfc3164Timestamp(eventEpochMs);
  return `<${pri}>${timestamp} ${hostname} ${cefBody}`;
}
