import { Hono } from "hono";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/api/health", async (c) => {
  let dbOk = false;
  try {
    await c.env.DB.prepare("SELECT 1").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return c.json({
    status: dbOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    bindings: {
      db: dbOk,
      queue: Boolean(c.env.SYSLOG_QUEUE),
    },
  });
});
