import { useState, type ReactNode } from "react";
import type { Destination, DestinationInput, Mapping } from "../types.js";

const DATASET_OPTIONS = [
  "http_requests",
  "firewall_events",
  "dns_logs",
  "spectrum_events",
  "gateway_http",
  "gateway_dns",
  "gateway_network",
  "audit_logs",
  "nel_reports",
  "all",
];

// Common named syslog facilities (RFC 5424 Table 1). Any 0-23 value is valid;
// this list just covers the conventional choices.
const FACILITY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 16, label: "16 — local0 (recommended default)" },
  { value: 17, label: "17 — local1" },
  { value: 18, label: "18 — local2" },
  { value: 19, label: "19 — local3" },
  { value: 20, label: "20 — local4" },
  { value: 21, label: "21 — local5" },
  { value: 22, label: "22 — local6" },
  { value: 23, label: "23 — local7" },
  { value: 1, label: "1 — user" },
  { value: 4, label: "4 — security/auth" },
];

export function DestinationForm({
  initial,
  mappings,
  onSubmit,
  onCancel,
}: {
  initial?: Destination;
  mappings: Mapping[];
  onSubmit: (input: DestinationInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<DestinationInput>({
    name: initial?.name ?? "",
    host: initial?.host ?? "",
    port: initial?.port ?? 514,
    protocol: "tcp",
    transport: initial?.transport ?? "direct",
    frame: initial?.frame ?? "rfc6587",
    format: initial?.format ?? "rfc3164",
    facility: initial?.facility ?? 16,
    tls: initial?.tls ?? false,
    dataset: initial?.dataset ?? "http_requests",
    mappingId: initial?.mappingId ?? mappings[0]?.id ?? null,
    syslogHostname: initial?.syslogHostname ?? "cloudflare",
    enabled: initial?.enabled ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
          await onSubmit(form);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to save destination");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <Field label="Name" span2>
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </Field>
      <Field label="Host">
        <input
          className="input"
          value={form.host}
          onChange={(e) => setForm({ ...form, host: e.target.value })}
          placeholder="10.0.0.5 or syslog.internal"
          required
        />
      </Field>
      <Field label="Port">
        <input
          type="number"
          min={1}
          max={65535}
          className="input"
          value={form.port}
          onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
          required
        />
      </Field>
      <Field label="Transport">
        <select
          className="input"
          value={form.transport}
          onChange={(e) => setForm({ ...form, transport: e.target.value as DestinationInput["transport"] })}
        >
          <option value="direct">Direct (public TCP)</option>
          <option value="vpc">Workers VPC (private, via Cloudflare Tunnel)</option>
        </select>
      </Field>
      <Field label="Framing">
        <select
          className="input"
          value={form.frame}
          onChange={(e) => setForm({ ...form, frame: e.target.value as DestinationInput["frame"] })}
        >
          <option value="rfc6587">RFC 6587 octet-count (recommended)</option>
          <option value="newline">Newline-delimited (rsyslog/syslog-ng default)</option>
        </select>
      </Field>
      <Field label="Syslog format">
        <select
          className="input"
          value={form.format}
          onChange={(e) => setForm({ ...form, format: e.target.value as DestinationInput["format"] })}
        >
          <option value="rfc3164">RFC 3164 (classic BSD syslog)</option>
          <option value="rfc5424">RFC 5424 (structured, ISO 8601 timestamp)</option>
        </select>
      </Field>
      <Field label="Facility">
        <select
          className="input"
          value={form.facility}
          onChange={(e) => setForm({ ...form, facility: Number(e.target.value) })}
        >
          {FACILITY_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="TLS (RFC 5425)">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={form.tls}
            disabled={form.transport === "vpc"}
            onChange={(e) => setForm({ ...form, tls: e.target.checked })}
          />
          {form.transport === "vpc"
            ? "Not supported over Workers VPC (plaintext-only)"
            : "Wrap the TCP connection in TLS"}
        </label>
      </Field>
      <Field label="Dataset">
        <select
          className="input"
          value={form.dataset}
          onChange={(e) => setForm({ ...form, dataset: e.target.value })}
        >
          {DATASET_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="CEF mapping">
        <select
          className="input"
          value={form.mappingId ?? ""}
          onChange={(e) => setForm({ ...form, mappingId: e.target.value || null })}
        >
          <option value="">(generic fallback)</option>
          {mappings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Syslog hostname">
        <input
          className="input"
          value={form.syslogHostname}
          onChange={(e) => setForm({ ...form, syslogHostname: e.target.value })}
        />
      </Field>
      <Field label="Enabled">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
      </Field>

      {error && <p className="col-span-2 text-sm text-red-400">{error}</p>}

      <div className="col-span-2 flex gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-tangerine px-4 py-2 text-sm font-medium text-slate-950 hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save destination"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children, span2 }: { label: string; children: ReactNode; span2?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-sm text-slate-300 ${span2 ? "col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}
