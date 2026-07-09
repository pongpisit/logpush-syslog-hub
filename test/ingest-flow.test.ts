import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDestination } from "../src/db/repo.js";

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("POST /api/ingest/:dataset", () => {
  it("acks with zero enqueued when no destination matches the dataset", async () => {
    const res = await SELF.fetch("https://example.com/api/ingest/no_such_dataset", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.INGEST_SECRET}` },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("0 destinations configured");
  });

  it("parses gzip NDJSON and enqueues one delivery per record per matching destination", async () => {
    const destination = await createDestination(env.DB, {
      name: "Test destination for ingest",
      host: "192.0.2.50",
      port: 514,
      protocol: "tcp",
      transport: "direct",
      frame: "rfc6587",
      dataset: "http_requests",
      mappingId: "default-http-requests",
      syslogHostname: "cloudflare",
      enabled: true,
    });

    const ndjson = [
      JSON.stringify({ RayID: "r1", ClientIP: "203.0.113.1", EdgeResponseStatus: 200 }),
      JSON.stringify({ RayID: "r2", ClientIP: "203.0.113.2", EdgeResponseStatus: 404 }),
    ].join("\n");
    const body = await gzip(ndjson);

    const res = await SELF.fetch("https://example.com/api/ingest/http_requests", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.INGEST_SECRET}`,
        "Content-Encoding": "gzip",
      },
      body,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("2 events");
    expect(text).toContain("2 deliveries enqueued to 1 destination");
    void destination;
  });

  it("skips lines that are not valid JSON objects", async () => {
    await createDestination(env.DB, {
      name: "Another destination",
      host: "192.0.2.51",
      port: 514,
      protocol: "tcp",
      transport: "direct",
      frame: "rfc6587",
      dataset: "firewall_events",
      mappingId: "default-firewall-events",
      syslogHostname: "cloudflare",
      enabled: true,
    });

    const ndjson = ['not-json', JSON.stringify({ RayID: "r3", Action: "block" })].join("\n");
    const body = await gzip(ndjson);

    const res = await SELF.fetch("https://example.com/api/ingest/firewall_events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.INGEST_SECRET}`,
        "Content-Encoding": "gzip",
      },
      body,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("1 events");
  });
});
