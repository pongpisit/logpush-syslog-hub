import { useEffect, useState } from "react";
import type { Destination, DestinationInput, Mapping } from "@logpush-syslog-hub/shared";
import {
  createDestination,
  deleteDestination,
  listDestinations,
  listMappings,
  testSend,
  updateDestination,
} from "../api.js";
import { DestinationForm } from "./DestinationForm.js";

export function Destinations() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [editing, setEditing] = useState<Destination | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const refresh = () => {
    listDestinations().then(setDestinations).catch((e) => setError(String(e)));
    listMappings().then(setMappings).catch((e) => setError(String(e)));
  };

  useEffect(refresh, []);

  const handleSave = async (input: DestinationInput) => {
    if (editing && editing !== "new") {
      await updateDestination(editing.id, input);
    } else {
      await createDestination(input);
    }
    setEditing(null);
    refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this destination?")) return;
    await deleteDestination(id);
    refresh();
  };

  const handleTestSend = async (id: string) => {
    setTestResult((r) => ({ ...r, [id]: "Sending…" }));
    try {
      const result = await testSend(id);
      setTestResult((r) => ({
        ...r,
        [id]: result.ok ? "✅ Delivered" : `❌ ${result.error ?? "Failed"}`,
      }));
    } catch (err) {
      setTestResult((r) => ({ ...r, [id]: `❌ ${err instanceof Error ? err.message : "Failed"}` }));
    }
  };

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-950 px-4 py-2 text-sm text-red-300">{error}</p>}

      {editing ? (
        <DestinationForm
          initial={editing === "new" ? undefined : editing}
          mappings={mappings}
          onSubmit={handleSave}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          onClick={() => setEditing("new")}
          className="rounded-md bg-tangerine px-4 py-2 text-sm font-medium text-slate-950 hover:opacity-90"
        >
          + Add destination
        </button>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500">
              <th className="p-3">Name</th>
              <th className="p-3">Target</th>
              <th className="p-3">Transport</th>
              <th className="p-3">Dataset</th>
              <th className="p-3">Enabled</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {destinations.map((d) => (
              <tr key={d.id} className="border-b border-slate-800/50">
                <td className="p-3">{d.name}</td>
                <td className="p-3 font-mono text-xs text-slate-400">
                  {d.host}:{d.port} ({d.frame})
                </td>
                <td className="p-3">{d.transport}</td>
                <td className="p-3">{d.dataset}</td>
                <td className="p-3">{d.enabled ? "✅" : "⏸️"}</td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="link" onClick={() => setEditing(d)}>
                      Edit
                    </button>
                    <button className="link text-red-400" onClick={() => handleDelete(d.id)}>
                      Delete
                    </button>
                    <button className="link" onClick={() => handleTestSend(d.id)}>
                      Test send
                    </button>
                    {testResult[d.id] && (
                      <span className="text-xs text-slate-400">{testResult[d.id]}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {destinations.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500">
                  No destinations yet. Add one to start forwarding syslog.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
