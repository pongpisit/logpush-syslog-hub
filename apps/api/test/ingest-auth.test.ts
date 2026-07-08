import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

describe("POST /ingest/:dataset auth", () => {
  it("rejects requests with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/ingest/http_requests", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await SELF.fetch("https://example.com/ingest/http_requests", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-POST methods", async () => {
    const res = await SELF.fetch("https://example.com/ingest/http_requests", {
      method: "GET",
      headers: { Authorization: `Bearer ${env.INGEST_SECRET}` },
    });
    expect(res.status).toBe(404);
  });

  it("accepts requests with the correct bearer token", async () => {
    const res = await SELF.fetch("https://example.com/ingest/http_requests", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.INGEST_SECRET}` },
      body: "",
    });
    expect(res.status).toBe(200);
  });
});
