import { useEffect, useState } from "react";
import type { DestinationStatus } from "../types.js";
import { ApiError, getHealth, listStatuses, type HealthResponse } from "../api.js";

export function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [statuses, setStatuses] = useState<DestinationStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Health check failed"));
    listStatuses()
      .then(setStatuses)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load status"));
  }, []);

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-red-950 px-4 py-2 text-sm text-red-300">{error}</p>}

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Worker health
        </h2>
        {health ? (
          <div className="flex flex-wrap gap-4 text-sm">
            <Badge label="status" value={health.status} ok={health.status === "ok"} />
            <Badge label="D1" value={health.bindings.db ? "connected" : "unavailable"} ok={health.bindings.db} />
            <Badge label="Queue" value={health.bindings.queue ? "bound" : "missing"} ok={health.bindings.queue} />
            <span className="text-slate-500">as of {new Date(health.timestamp).toLocaleString()}</span>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Destination delivery status
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500">
              <th className="py-2">Destination ID</th>
              <th className="py-2">Forwarded</th>
              <th className="py-2">Dropped</th>
              <th className="py-2">Last success</th>
              <th className="py-2">Last error</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.destinationId} className="border-b border-slate-800/50">
                <td className="py-2 font-mono text-xs text-slate-400">{s.destinationId}</td>
                <td className="py-2 text-emerald-400">{s.eventsForwarded}</td>
                <td className="py-2 text-red-400">{s.eventsDropped}</td>
                <td className="py-2 text-slate-400">{s.lastSuccess ?? "—"}</td>
                <td className="max-w-xs truncate py-2 text-red-400" title={s.lastError ?? ""}>
                  {s.lastError ?? "—"}
                </td>
              </tr>
            ))}
            {statuses.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">
                  No destinations configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Badge({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <span className={`rounded-full px-3 py-1 ${ok ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>
      {label}: {value}
    </span>
  );
}
