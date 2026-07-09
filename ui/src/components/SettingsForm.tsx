import { useState } from "react";
import { getSettings, saveSettings } from "../api.js";

export function SettingsForm({ onSaved }: { onSaved: () => void }) {
  const initial = getSettings();
  const [adminSecret, setAdminSecret] = useState(initial.adminSecret);

  return (
    <form
      className="mx-auto mt-16 max-w-md space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-lg"
      onSubmit={(e) => {
        e.preventDefault();
        saveSettings(adminSecret);
        onSaved();
      }}
    >
      <h1 className="text-lg font-semibold text-tangerine">Logpush Syslog Hub</h1>
      <p className="text-sm text-slate-400">
        Enter the <code>ADMIN_SECRET</code> you set for this Worker to manage syslog destinations
        and CEF mappings.
      </p>
      <div>
        <label className="mb-1 block text-sm text-slate-300">Admin secret</label>
        <input
          type="password"
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-tangerine"
          placeholder="value of ADMIN_SECRET"
          value={adminSecret}
          onChange={(e) => setAdminSecret(e.target.value)}
          required
        />
      </div>
      <button
        type="submit"
        className="w-full rounded-md bg-tangerine px-4 py-2 text-sm font-medium text-slate-950 hover:opacity-90"
      >
        Connect
      </button>
    </form>
  );
}
