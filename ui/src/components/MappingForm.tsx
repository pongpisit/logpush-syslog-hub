import { useState } from "react";
import type { Mapping, MappingInput, MappingRule } from "../types.js";

const EMPTY_RULE: MappingRule = { cefKey: "", sourceField: "" };

// Mirrors the timestamp candidates in ../../src/services/cef.ts (buildCefMessage).
// Any one of these present in a Logpush record is used to populate CEF's `rt`.
const TIMESTAMP_FIELD_CANDIDATES = ["EdgeStartTimestamp", "Datetime", "Timestamp", "EdgeEndTimestamp"];

/**
 * Every `sourceField` referenced by this mapping's rules, plus a reminder to
 * include a timestamp field — this is exactly the `output_options.field_names`
 * array the matching Logpush job needs. Logpush has no "send all fields"
 * option, so a job missing any of these will silently produce `null`/empty
 * CEF extensions for that field.
 */
function requiredLogpushFields(rules: MappingRule[]): string[] {
  const fields = new Set<string>();
  for (const rule of rules) {
    if (rule.sourceField?.trim()) fields.add(rule.sourceField.trim());
  }
  return [...fields];
}

export function MappingForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Mapping;
  onSubmit: (input: MappingInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [dataset, setDataset] = useState(initial?.dataset ?? "http_requests");
  const [rules, setRules] = useState<MappingRule[]>(initial?.rules?.length ? initial.rules : [EMPTY_RULE]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const requiredFields = requiredLogpushFields(rules);
  const fieldNamesJson = JSON.stringify(requiredFields, null, 2);

  const updateRule = (index: number, patch: Partial<MappingRule>) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <form
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
          const cleanedRules = rules.filter((r) => r.cefKey.trim() && (r.sourceField?.trim() || r.staticValue?.trim()));
          await onSubmit({ name, dataset, rules: cleanedRules });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to save mapping");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Dataset
          <input
            className="input"
            value={dataset}
            onChange={(e) => setDataset(e.target.value)}
            placeholder="http_requests"
            required
          />
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm text-slate-300">CEF field mappings</span>
          <button
            type="button"
            className="link"
            onClick={() => setRules((prev) => [...prev, { ...EMPTY_RULE }])}
          >
            + Add field
          </button>
        </div>
        <div className="space-y-2">
          {rules.map((rule, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input
                className="input col-span-2"
                placeholder="cefKey (e.g. src)"
                value={rule.cefKey}
                onChange={(e) => updateRule(i, { cefKey: e.target.value })}
              />
              <input
                className="input col-span-2"
                placeholder="label (cs1Label)"
                value={rule.label ?? ""}
                onChange={(e) => updateRule(i, { label: e.target.value || undefined })}
              />
              <input
                className="input col-span-4"
                placeholder="sourceField (Logpush field)"
                value={rule.sourceField ?? ""}
                onChange={(e) => updateRule(i, { sourceField: e.target.value || undefined, staticValue: undefined })}
              />
              <input
                className="input col-span-3"
                placeholder="or staticValue"
                value={rule.staticValue ?? ""}
                onChange={(e) => updateRule(i, { staticValue: e.target.value || undefined, sourceField: undefined })}
              />
              <button
                type="button"
                className="col-span-1 text-red-400 hover:underline"
                onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {requiredFields.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
          <div className="mb-1 flex items-center justify-between">
            <span>
              Required Logpush <code className="text-slate-300">output_options.field_names</code> — the Logpush job for
              this mapping must request exactly these fields (there is no "send all fields" option), plus one
              timestamp field: <code className="text-slate-300">{TIMESTAMP_FIELD_CANDIDATES.join(", ")}</code>.
            </span>
            <button
              type="button"
              className="link shrink-0 whitespace-nowrap"
              onClick={async () => {
                await navigator.clipboard.writeText(fieldNamesJson);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied!" : "Copy JSON"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-slate-300">{fieldNamesJson}</pre>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-tangerine px-4 py-2 text-sm font-medium text-slate-950 hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save mapping"}
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
