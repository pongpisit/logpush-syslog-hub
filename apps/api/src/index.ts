import { Hono } from "hono";
import { healthRoute } from "./routes/health.js";
import { ingestRoute } from "./routes/ingest.js";
import { adminRoute } from "./routes/admin.js";
import { queue as queueHandler } from "./queue/consumer.js";

const app = new Hono<{ Bindings: Env }>();

app.route("/", healthRoute);
app.route("/", ingestRoute);
app.route("/", adminRoute);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  fetch: app.fetch,
  queue: queueHandler,
} satisfies ExportedHandler<Env>;
