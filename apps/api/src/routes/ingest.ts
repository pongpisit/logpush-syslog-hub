import { Hono } from "hono";
import { LogpushRecordSchema, type QueueMessage } from "@logpush-syslog-hub/shared";
import { bearerAuth } from "../middleware/auth.js";
import { decompressIfNeeded, parseNdjsonStream } from "../services/parser.js";
import { listEnabledDestinationsForDataset } from "../db/repo.js";

export const ingestRoute = new Hono<{ Bindings: Env }>();

const QUEUE_BATCH_SIZE = 50;

ingestRoute.use("/ingest/*", bearerAuth("INGEST_SECRET"));

/**
 * Logpush HTTP destination endpoint. Configure a Logpush job with:
 *   destination_conf = "https://<worker>/ingest/<dataset>?header_Authorization=Bearer%20<INGEST_SECRET>"
 * See README.md for the full job creation example.
 */
ingestRoute.post("/ingest/:dataset", async (c) => {
  const dataset = c.req.param("dataset");

  const destinations = await listEnabledDestinationsForDataset(c.env.DB, dataset);
  if (destinations.length === 0) {
    // Drain the body so Logpush doesn't see a connection reset, then ack.
    await c.req.raw.body?.cancel().catch(() => undefined);
    return c.text(`OK (0 destinations configured for dataset '${dataset}')`, 200);
  }

  const stream = decompressIfNeeded(c.req.raw);

  let recordCount = 0;
  let enqueuedCount = 0;
  let batch: QueueMessage[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await c.env.SYSLOG_QUEUE.sendBatch(batch.map((body) => ({ body })));
    enqueuedCount += batch.length;
    batch = [];
  };

  for await (const raw of parseNdjsonStream(stream)) {
    const parsed = LogpushRecordSchema.safeParse(raw);
    if (!parsed.success) continue;
    recordCount += 1;

    for (const destination of destinations) {
      batch.push({
        destinationId: destination.id,
        dataset,
        record: parsed.data,
        enqueuedAt: new Date().toISOString(),
      });
      if (batch.length >= QUEUE_BATCH_SIZE) {
        await flush();
      }
    }
  }
  await flush();

  return c.text(
    `OK (${recordCount} events, ${enqueuedCount} deliveries enqueued to ${destinations.length} destination(s))`,
    200,
  );
});
