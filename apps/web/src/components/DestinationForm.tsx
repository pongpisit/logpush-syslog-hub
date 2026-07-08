import { useState, type ReactNode } from "react";
import type { Destination, DestinationInput, Mapping } from "@logpush-syslog-hub/shared";

const DATASET_OPTIONS = ["http_requests", "firewall_events", "all"];

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
          <option value="newline">Newline-delimited</option>
        </select>
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
