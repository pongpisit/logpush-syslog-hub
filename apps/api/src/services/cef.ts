import type { LogpushRecord, MappingRule } from "@logpush-syslog-hub/shared";
import { DATASET_LABELS } from "@logpush-syslog-hub/shared";

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

/**
 * Generic severity resolver that works across datasets:
 * - Uses HTTP status code when present (http_requests, gateway_http, ...).
 * - Falls back to a firewall "Action" field (firewall_events).
 * - Defaults to informational when neither signal is present.
 */
export function resolveSeverity(record: LogpushRecord): Severity {
  const status = record["EdgeResponseStatus"];
  if (typeof status === "number") {
    if (status >= 500) return { cef: 8, syslog: 3 };
    if (status >= 400) return { cef: 5, syslog: 4 };
    if (status >= 300) return { cef: 2, syslog: 6 };
    return { cef: 0, syslog: 6 };
  }

  const action = record["Action"];
  if (typeof action === "string") {
    const blocked = ["block", "challenge", "jschallenge", "managedchallenge", "connectionclose"];
    if (blocked.includes(action.toLowerCase())) return { cef: 7, syslog: 4 };
    if (action.toLowerCase() === "allow") return { cef: 0, syslog: 6 };
    return { cef: 3, syslog: 6 };
  }

  return { cef: 0, syslog: 6 };
}

/** Syslog PRI = facility * 8 + severity. Facility 16 = local0. */
export function syslogPri(syslogSeverity: number, facility = 16): number {
  return facility * 8 + syslogSeverity;
}

/** Find the first present, truthy field among common Logpush timestamp fields. */
function resolveEventEpochMs(record: LogpushRecord): number | undefined {
  const candidates = ["EdgeStartTimestamp", "Datetime", "Timestamp", "EdgeEndTimestamp"];
  for (const field of candidates) {
    const value = record[field];
    if (value !== undefined && value !== null) {
      const ms = toEpochMs(value);
      if (ms !== undefined) return ms;
    }
  }
  return undefined;
}

export interface BuildCefMessageOptions {
  dataset: string;
  record: LogpushRecord;
  rules: MappingRule[];
  syslogHostname: string;
}

/**
 * Build a full CEF-over-RFC3164 syslog message:
 *   <PRI>Mmm DD HH:MM:SS hostname CEF:0|Vendor|Product|Version|SignatureId|Name|Severity|extension
 */
export function buildCefMessage(opts: BuildCefMessageOptions): string {
  const { dataset, record, rules, syslogHostname } = opts;
  const eventEpochMs = resolveEventEpochMs(record);
  const severity = resolveSeverity(record);
  const pri = syslogPri(severity.syslog);
  const timestamp = rfc3164Timestamp(eventEpochMs);
  const hostname = escapeCefHeader(syslogHostname);
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

  const extension = extensionParts.join(" ");
  return `<${pri}>${timestamp} ${hostname} ${cefHeader}|${extension}`;
}
