import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("static asset fallback (non-/api/* requests)", () => {
  it("serves the web UI for GET requests to the root", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves the web UI (SPA fallback) for GET requests to an unknown client-side route", async () => {
    const res = await SELF.fetch("https://example.com/destinations");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("returns a helpful JSON 404 (not the static asset handler's opaque 405) for a POST to the root", async () => {
    // This is the exact failure mode behind "Invalid destination configuration:
    // error writing object: error uploading to https: status:405" when a
    // Logpush HTTP destination is pointed at the site root instead of
    // /api/ingest/:dataset.
    const res = await SELF.fetch("https://example.com/", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string; hint: string }>();
    expect(body.error).toBe("Not found");
    expect(body.hint).toContain("/api/ingest/:dataset");
  });

  it("returns a helpful JSON 404 for a POST to an unrelated non-API path", async () => {
    const res = await SELF.fetch("https://example.com/ingest/http_requests", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Not found");
  });
});
