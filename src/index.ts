import { Hono } from "hono";
import { healthRoute } from "./routes/health.js";
import { ingestRoute } from "./routes/ingest.js";
import { adminRoute } from "./routes/admin.js";
import { queue as queueHandler } from "./queue/consumer.js";

const app = new Hono<{ Bindings: Env }>();

app.route("/", healthRoute);
app.route("/", ingestRoute);
app.route("/", adminRoute);

// Anything under /api/* that didn't match a route above is a real API 404.
// Everything else is a client-side route owned by the built-in web UI
// (served from ./dist via the `ASSETS` binding) — defer to it so the SPA's
// own router/index.html can handle it. See wrangler.jsonc `assets` config.
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Internal server error" }, 500);
  }
  return c.text("Internal server error", 500);
});

export default {
  fetch: app.fetch,
  queue: queueHandler,
} satisfies ExportedHandler<Env>;
