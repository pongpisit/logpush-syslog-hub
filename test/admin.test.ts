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

  // One destination per dataset that ships a default mapping, so "Test send"
  // exercises every one end-to-end: sample record -> default mapping rules ->
  // CEF extensions. Regression guard for the sample-record/mapping field-name
  // drift that's easy to introduce when either side changes independently.
  const DATASETS_WITH_DEFAULT_MAPPINGS = [
    "http_requests",
    "firewall_events",
    "dns_logs",
    "spectrum_events",
    "gateway_http",
    "gateway_dns",
    "gateway_network",
    "audit_logs",
    "nel_reports",
  ];

  it.each(DATASETS_WITH_DEFAULT_MAPPINGS)(
    "'Test send' for dataset '%s' populates multiple CEF extension fields from its default mapping + built-in sample record",
    async (dataset) => {
      const createRes = await SELF.fetch(
        "https://example.com/api/admin/destinations",
        authed({
          method: "POST",
          body: JSON.stringify({
            name: `Unreachable (${dataset})`,
            host: "127.0.0.1",
            port: 1,
            protocol: "tcp",
            transport: "direct",
            frame: "rfc6587",
            dataset,
            mappingId: `default-${dataset.replace(/_/g, "-")}`,
            syslogHostname: "cloudflare",
            enabled: true,
          }),
        }),
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json<{ destination: { id: string } }>();

      const res = await SELF.fetch(
        "https://example.com/api/admin/test-send",
        authed({ method: "POST", body: JSON.stringify({ destinationId: created.destination.id }) }),
      );
      expect(res.status).toBe(502); // delivery fails (port 1 is unreachable) — we only care about the built message
      const body = await res.json<{ message: string }>();

      expect(body.message).toContain(`cat=${dataset}`);
      // The built-in sample record's field names are chosen to match this
      // dataset's default mapping rules, so most rules should resolve to a
      // real extension key=value pair, not be skipped as "missing".
      const extensionKeyCount = (body.message.match(/ [a-zA-Z][a-zA-Z0-9]*=/g) ?? []).length;
      expect(extensionKeyCount, `expected several populated CEF fields for '${dataset}', got: ${body.message}`).toBeGreaterThan(4);
      // Every default-mapped record also always carries the full raw
      // record as JSON — the guarantee that no field is ever dropped, even
      // ones this mapping doesn't name.
      expect(body.message).toContain("raw={");
    },
  );

  // Spot-checks that the SOC-priority fields for each of the six monitoring
  // use cases (bot, WAF, DDoS, credential-leak, insider-threat, 0-day —
  // see SOC_USE_CASES.md) actually make it through test-send's sample
  // record -> default mapping -> CEF extension pipeline, not just "some
  // field or other" as the generic count-based test above checks.
  const SOC_PRIORITY_FIELD_CHECKS: Array<{ dataset: string; mustContain: string[] }> = [
    {
      dataset: "http_requests",
      mustContain: [
        "cn2=4 cn2Label=botScore", // bot detection
        "cn3=12 cn3Label=wafAttackScore", // WAF / 0-day anomaly score
        "cs14=e7d705a3286e19ea42f587b344ee6865 cs14Label=ja3Hash", // 0-day/APT fingerprint tracking
        "cs15=clean cs15Label=leakedCredResult", // credential-leak detection
      ],
    },
    {
      dataset: "firewall_events",
      mustContain: [
        "cs2=waf cs2Label=securitySource", // WAF/bot/DDoS product attribution
        "cs10=username_and_password_leaked cs10Label=leakedCredResult", // credential-leak detection
      ],
    },
    {
      dataset: "spectrum_events",
      mustContain: [
        "cs5=64502 cs5Label=clientAsn", // DDoS source-network attribution
        "cs7=2d9f9e6f1a7b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d cs7Label=originTlsFingerprint",
      ],
    },
    {
      dataset: "audit_logs",
      mustContain: [
        'cs6={"security_level":"high"} cs6Label=oldValue', // insider-threat before/after diff
        'cs7={"security_level":"essentially_off"} cs7Label=newValue',
      ],
    },
  ];

  it.each(SOC_PRIORITY_FIELD_CHECKS)("'Test send' for '$dataset' surfaces its SOC-priority fields", async ({ dataset, mustContain }) => {
    const createRes = await SELF.fetch(
      "https://example.com/api/admin/destinations",
      authed({
        method: "POST",
        body: JSON.stringify({
          name: `SOC field check (${dataset})`,
          host: "127.0.0.1",
          port: 1,
          protocol: "tcp",
          transport: "direct",
          frame: "rfc6587",
          dataset,
          mappingId: `default-${dataset.replace(/_/g, "-")}`,
          syslogHostname: "cloudflare",
          enabled: true,
        }),
      }),
    );
    const created = await createRes.json<{ destination: { id: string } }>();

    const res = await SELF.fetch(
      "https://example.com/api/admin/test-send",
      authed({ method: "POST", body: JSON.stringify({ destinationId: created.destination.id }) }),
    );
    const body = await res.json<{ message: string }>();

    for (const fragment of mustContain) {
      expect(body.message, `expected '${dataset}' CEF message to contain '${fragment}'`).toContain(fragment);
    }
  });

  it("'Test send' for 'gateway_http' surfaces DLP profile fields when a sample transfer is blocked (insider-threat use case)", async () => {
    const createRes = await SELF.fetch(
      "https://example.com/api/admin/destinations",
      authed({
        method: "POST",
        body: JSON.stringify({
          name: "SOC field check (gateway_http blocked)",
          host: "127.0.0.1",
          port: 1,
          protocol: "tcp",
          transport: "direct",
          frame: "rfc6587",
          dataset: "gateway_http",
          mappingId: "default-gateway-http",
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
        body: JSON.stringify({
          destinationId: created.destination.id,
          record: {
            SourceIP: "203.0.113.5",
            Action: "block",
            BlockedFileHash: "d41d8cd98f00b204e9800998ecf8427e",
            BlockedFileName: "invoice.exe",
            BlockedFileReason: "malware detected",
            DownloadMatchedDlpProfiles: ["PCI-DSS"],
          },
        }),
      }),
    );
    const body = await res.json<{ message: string }>();

    expect(body.message).toContain("fileHash=d41d8cd98f00b204e9800998ecf8427e");
    expect(body.message).toContain("reason=malware detected");
    expect(body.message).toContain('cs8=["PCI-DSS"] cs8Label=dlpDownloadProfiles');
  });
});
