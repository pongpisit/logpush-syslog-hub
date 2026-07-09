import { useState } from "react";
import { clearSettings, getSettings } from "./api.js";
import { SettingsForm } from "./components/SettingsForm.js";
import { Dashboard } from "./components/Dashboard.js";
import { Destinations } from "./components/Destinations.js";
import { Mappings } from "./components/Mappings.js";

type Tab = "dashboard" | "destinations" | "mappings";

export default function App() {
  const [connected, setConnected] = useState(() => Boolean(getSettings().adminSecret));
  const [tab, setTab] = useState<Tab>("dashboard");

  if (!connected) {
    return <SettingsForm onSaved={() => setConnected(true)} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-tangerine">Logpush Syslog Hub</h1>
        </div>
        <button
          className="link"
          onClick={() => {
            clearSettings();
            setConnected(false);
          }}
        >
          Disconnect
        </button>
      </header>

      <nav className="mb-6 flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1 text-sm">
        {(["dashboard", "destinations", "mappings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-2 capitalize ${
              tab === t ? "bg-tangerine text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && <Dashboard />}
      {tab === "destinations" && <Destinations />}
      {tab === "mappings" && <Mappings />}
    </div>
  );
}
