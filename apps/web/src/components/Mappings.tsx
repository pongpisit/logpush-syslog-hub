import { useEffect, useState } from "react";
import type { Mapping, MappingInput } from "../types.js";
import { createMapping, deleteMapping, listMappings, updateMapping } from "../api.js";
import { MappingForm } from "./MappingForm.js";

export function Mappings() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [editing, setEditing] = useState<Mapping | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    listMappings()
      .then(setMappings)
      .catch((e: unknown) => setError(String(e)));
  };

  useEffect(refresh, []);

  const handleSave = async (input: MappingInput) => {
    if (editing && editing !== "new") {
      await updateMapping(editing.id, input);
    } else {
      await createMapping(input);
    }
    setEditing(null);
    refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this mapping? Destinations referencing it will fall back to generic mapping.")) return;
    await deleteMapping(id);
    refresh();
  };

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-950 px-4 py-2 text-sm text-red-300">{error}</p>}

      {editing ? (
        <MappingForm
          initial={editing === "new" ? undefined : editing}
          onSubmit={handleSave}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          onClick={() => setEditing("new")}
          className="rounded-md bg-tangerine px-4 py-2 text-sm font-medium text-slate-950 hover:opacity-90"
        >
          + Add mapping
        </button>
      )}

      <div className="space-y-3">
        {mappings.map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="font-medium">{m.name}</h3>
                <p className="text-xs text-slate-500">
                  dataset: {m.dataset} · {m.rules.length} field(s)
                </p>
              </div>
              <div className="flex gap-2">
                <button className="link" onClick={() => setEditing(m)}>
                  Edit
                </button>
                <button className="link text-red-400" onClick={() => handleDelete(m.id)}>
                  Delete
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {m.rules.map((r, i) => (
                <span
                  key={i}
                  className="rounded-full bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300"
                >
                  {r.cefKey}={r.sourceField ?? `"${r.staticValue}"`}
                  {r.label ? ` (${r.label})` : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
        {mappings.length === 0 && (
          <p className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-center text-sm text-slate-500">
            No mappings yet.
          </p>
        )}
      </div>
    </div>
  );
}
