import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

function authed(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${env.ADMIN_SECRET}`,
      "Content-Type": "application/json",
    },
  };
}

describe("admin auth", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/destinations");
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/destinations", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });
});

describe("admin mappings CRUD", () => {
  it("lists the seeded default mappings", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/mappings", authed());
    expect(res.status).toBe(200);
    const body = await res.json<{ mappings: Array<{ id: string }> }>();
    const ids = body.mappings.map((m) => m.id);
    expect(ids).toContain("default-http-requests");
    expect(ids).toContain("default-firewall-events");
  });

  it("creates, updates, and deletes a custom mapping", async () => {
    const createRes = await SELF.fetch(
      "https://example.com/api/admin/mappings",
      authed({
        method: "POST",
        body: JSON.stringify({
          name: "Test Mapping",
          dataset: "dns_logs",
          rules: [{ cefKey: "src", sourceField: "SourceIP" }],
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{ mapping: { id: string } }>();
    const id = created.mapping.id;

    const updateRes = await SELF.fetch(
      `https://example.com/api/admin/mappings/${id}`,
      authed({
        method: "PUT",
        body: JSON.stringify({
          name: "Test Mapping Updated",
          dataset: "dns_logs",
          rules: [{ cefKey: "src", sourceField: "SourceIP" }],
        }),
      }),
    );
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json<{ mapping: { name: string } }>();
    expect(updated.mapping.name).toBe("Test Mapping Updated");

    const deleteRes = await SELF.fetch(
      `https://example.com/api/admin/mappings/${id}`,
      authed({ method: "DELETE" }),
    );
    expect(deleteRes.status).toBe(204);

    const getMissing = await SELF.fetch(
      `https://example.com/api/admin/mappings/${id}`,
      authed({ method: "PUT", body: JSON.stringify({ name: "x", dataset: "y", rules: [] }) }),
    );
    expect(getMissing.status).toBe(404);
  });

  it("rejects an invalid mapping payload", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/admin/mappings",
      authed({ method: "POST", body: JSON.stringify({ name: "" }) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("admin destinations CRUD", () => {
  it("creates, lists, updates, and deletes a destination", async () => {
    const createRes = await SELF.fetch(
      "https://example.com/api/admin/destinations",
      authed({
        method: "POST",
        body: JSON.stringify({
          name: "Test SIEM",
          host: "192.0.2.10",
          port: 514,
          protocol: "tcp",
          transport: "direct",
          frame: "rfc6587",
          dataset: "http_requests",
          mappingId: "default-http-requests",
          syslogHostname: "cloudflare",
          enabled: true,
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{ destination: { id: string } }>();
    const id = created.destination.id;

    const listRes = await SELF.fetch("https://example.com/api/admin/destinations", authed());
    const list = await listRes.json<{ destinations: Array<{ id: string }> }>();
    expect(list.destinations.some((d) => d.id === id)).toBe(true);

    const statusRes = await SELF.fetch("https://example.com/api/admin/status", authed());
    const status = await statusRes.json<{ statuses: Array<{ destinationId: string }> }>();
    expect(status.statuses.some((s) => s.destinationId === id)).toBe(true);

    const updateRes = await SELF.fetch(
      `https://example.com/api/admin/destinations/${id}`,
      authed({
        method: "PUT",
        body: JSON.stringify({
          name: "Test SIEM Renamed",
          host: "192.0.2.10",
          port: 514,
          protocol: "tcp",
          transport: "direct",
          frame: "rfc6587",
          dataset: "http_requests",
          mappingId: "default-http-requests",
          syslogHostname: "cloudflare",
          enabled: false,
        }),
      }),
    );
    expect(updateRes.status).toBe(200);

    const deleteRes = await SELF.fetch(
      `https://example.com/api/admin/destinations/${id}`,
      authed({ method: "DELETE" }),
    );
    expect(deleteRes.status).toBe(204);

    const deleteAgain = await SELF.fetch(
      `https://example.com/api/admin/destinations/${id}`,
      authed({ method: "DELETE" }),
    );
    expect(deleteAgain.status).toBe(404);
  });

  it("rejects an invalid destination payload", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/admin/destinations",
      authed({ method: "POST", body: JSON.stringify({ name: "x" }) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("admin test-send", () => {
  it("returns 404 for an unknown destination", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/admin/test-send",
      authed({ method: "POST", body: JSON.stringify({ destinationId: "missing" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 502 with the formatted CEF message when delivery fails", async () => {
    const createRes = await SELF.fetch(
      "https://example.com/api/admin/destinations",
      authed({
        method: "POST",
        body: JSON.stringify({
          name: "Unreachable",
          host: "127.0.0.1",
          port: 1,
          protocol: "tcp",
          transport: "direct",
          frame: "rfc6587",
          dataset: "http_requests",
          mappingId: "default-http-requests",
          syslogHostname: "cloudflare",
          enabled: true,
        }),
      }),
    );
    const created = await createRes.json<{ destination: { id: string } }>();

    const res = await SELF.fetch(
      "https://example.com/api/admin/test-send",
      authed({
        method: "POST",
        body: JSON.stringify({ destinationId: created.destination.id }),
      }),
    );
    expect(res.status).toBe(502);
    const body = await res.json<{ ok: boolean; message: string }>();
    expect(body.ok).toBe(false);
    expect(body.message).toContain("CEF:0|Cloudflare|Logpush|1.0|http_requests|HTTP Request|");
  });
});
