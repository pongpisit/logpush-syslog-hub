import { Hono } from "hono";
import {
  DestinationInputSchema,
  GENERIC_FALLBACK_RULES,
  MappingInputSchema,
  TestSendInputSchema,
} from "../shared/index.js";
import { bearerAuth } from "../middleware/auth.js";
import {
  createDestination,
  createMapping,
  deleteDestination,
  deleteMapping,
  getDestination,
  getMapping,
  listDestinations,
  listDestinationStatuses,
  listMappings,
  recordDeliveryFailure,
  recordDeliverySuccess,
  updateDestination,
  updateMapping,
} from "../db/repo.js";
import { buildCefMessage } from "../services/cef.js";
import { sendSyslogMessage, SyslogDeliveryError } from "../services/syslog.js";

export const adminRoute = new Hono<{ Bindings: Env }>();

// The admin API is same-origin: it's served by the same Worker as the web
// UI, so no CORS configuration is needed.
adminRoute.use("/api/admin/*", bearerAuth("ADMIN_SECRET"));

// ---- Destinations ----

adminRoute.get("/api/admin/destinations", async (c) => {
  const destinations = await listDestinations(c.env.DB);
  return c.json({ destinations });
});

adminRoute.post("/api/admin/destinations", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = DestinationInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid destination", issues: parsed.error.issues }, 400);
  }
  const destination = await createDestination(c.env.DB, parsed.data);
  return c.json({ destination }, 201);
});

adminRoute.put("/api/admin/destinations/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = DestinationInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid destination", issues: parsed.error.issues }, 400);
  }
  const destination = await updateDestination(c.env.DB, id, parsed.data);
  if (!destination) return c.json({ error: "Not found" }, 404);
  return c.json({ destination });
});

adminRoute.delete("/api/admin/destinations/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteDestination(c.env.DB, id);
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});

// ---- Mappings ----

adminRoute.get("/api/admin/mappings", async (c) => {
  const mappings = await listMappings(c.env.DB);
  return c.json({ mappings });
});

adminRoute.post("/api/admin/mappings", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = MappingInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid mapping", issues: parsed.error.issues }, 400);
  }
  const mapping = await createMapping(c.env.DB, parsed.data);
  return c.json({ mapping }, 201);
});

adminRoute.put("/api/admin/mappings/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = MappingInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid mapping", issues: parsed.error.issues }, 400);
  }
  const mapping = await updateMapping(c.env.DB, id, parsed.data);
  if (!mapping) return c.json({ error: "Not found" }, 404);
  return c.json({ mapping });
});

adminRoute.delete("/api/admin/mappings/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteMapping(c.env.DB, id);
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});

// ---- Status ----

adminRoute.get("/api/admin/status", async (c) => {
  const statuses = await listDestinationStatuses(c.env.DB);
  return c.json({ statuses });
});

// ---- Test send ----

// Sample records for every dataset with a built-in default mapping (see
// DEFAULT_MAPPING_RULES in shared/cef-defaults.ts) — populates every field
// each dataset's mapping rules reference, so "Test send" produces a fully
// filled-in CEF message instead of one with mostly-empty extensions.
// Built fresh per call (not at module scope) because Date.now() and
// crypto.randomUUID() outside a request context return fixed/deterministic
// values in the Workers runtime.
const SAMPLE_RECORD_BUILDERS: Record<string, () => Record<string, unknown>> = {
  http_requests: () => ({
    RayID: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    EdgeStartTimestamp: Date.now() * 1_000_000,
    ClientIP: "203.0.113.1",
    ClientCountry: "TH",
    ClientSrcPort: 54321,
    ClientRequestMethod: "GET",
    ClientRequestHost: "example.com",
    ClientRequestURI: "/api/v1/data",
    ClientRequestProtocol: "HTTP/2",
    ClientRequestUserAgent: "Mozilla/5.0 (logpush-syslog-hub test-send)",
    ClientSSLProtocol: "TLSv1.3",
    EdgeResponseStatus: 200,
    EdgeResponseBytes: 4096,
    EdgeColoCode: "SIN",
    EdgeTimeToFirstByteMs: 18,
    CacheCacheStatus: "MISS",
    ZoneName: "example.com",
  }),
  firewall_events: () => ({
    RayID: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    Datetime: new Date().toISOString(),
    ClientIP: "203.0.113.2",
    ClientCountry: "US",
    ClientRequestHost: "example.com",
    ClientRequestPath: "/wp-login.php",
    ClientRequestMethod: "POST",
    ClientRequestQuery: "",
    ClientRequestUserAgent: "curl/8.4.0",
    EdgeColoCode: "SIN",
    ZoneName: "example.com",
    EdgeResponseStatus: 403,
    Action: "block",
    RuleID: "1a2b3c4d5e6f7g8h",
    Source: "waf",
  }),
  dns_logs: () => ({
    Timestamp: new Date().toISOString(),
    SourceIP: "203.0.113.3",
    QueryName: "example.com",
    QueryType: 1,
    ResponseCode: 0,
    ColoCode: "SIN",
    ResponseCached: true,
    EDNSSubnet: "203.0.113.0",
  }),
  spectrum_events: () => ({
    Timestamp: new Date().toISOString(),
    ClientIP: "203.0.113.4",
    ClientPort: 51234,
    OriginIP: "198.51.100.10",
    OriginPort: 22,
    Event: "disconnect",
    Application: "test-send-app",
    ClientProto: "tcp",
    ClientCountry: "US",
    ClientTlsStatus: "OK",
    ClientMatchedIpFirewall: "UNKNOWN",
    Status: 0,
    ClientBytes: 1024,
    OriginBytes: 2048,
  }),
  gateway_http: () => ({
    Datetime: new Date().toISOString(),
    SourceIP: "203.0.113.5",
    SourcePort: 54321,
    DestinationIP: "198.51.100.20",
    DestinationPort: 443,
    HTTPHost: "example.com",
    URL: "https://example.com/api/v1/data",
    HTTPMethod: "GET",
    UserAgent: "Mozilla/5.0 (logpush-syslog-hub test-send)",
    Action: "allow",
    Email: "user@example.com",
    HTTPStatusCode: 200,
    PolicyName: "Default HTTP Policy",
    DeviceName: "Laptop MB810",
    SourceIPCountryCode: "US",
    RequestID: crypto.randomUUID(),
    PolicyID: crypto.randomUUID(),
  }),
  gateway_dns: () => ({
    Datetime: new Date().toISOString(),
    SrcIP: "203.0.113.6",
    SrcPort: 0,
    DstIP: "198.51.100.30",
    DstPort: 0,
    Email: "user@example.com",
    ResolverDecision: "allow",
    QueryName: "example.com",
    QueryTypeName: "A",
    RCode: 0,
    PolicyName: "Default DNS Policy",
    DeviceName: "Laptop MB810",
    Location: "Office NYC",
    QueryID: crypto.randomUUID(),
    PolicyID: crypto.randomUUID(),
  }),
  gateway_network: () => ({
    Datetime: new Date().toISOString(),
    SourceIP: "203.0.113.7",
    SourcePort: 51234,
    DestinationIP: "198.51.100.40",
    DestinationPort: 443,
    Email: "user@example.com",
    Action: "allow",
    TransportProtocol: "tcp",
    SNI: "example.com",
    DetectedProtocol: "tls",
    PolicyName: "Default Network Policy",
    DeviceName: "Laptop MB810",
    SourceIPCountryCode: "US",
    SessionID: crypto.randomUUID(),
    PolicyID: crypto.randomUUID(),
  }),
  audit_logs: () => ({
    When: new Date().toISOString(),
    ActorEmail: "admin@example.com",
    ActorIP: "203.0.113.8",
    ActionType: "update",
    ActionResult: true,
    ResourceType: "zone",
    ActorType: "user",
    Interface: "dash",
    ID: crypto.randomUUID(),
    ResourceID: crypto.randomUUID(),
    OwnerID: crypto.randomUUID(),
  }),
  nel_reports: () => ({
    Timestamp: new Date().toISOString(),
    Type: "tcp.timed_out",
    Phase: "connection",
    ClientIPASNDescription: "EXAMPLE-AS",
    ClientIPCountry: "US",
    LastKnownGoodColoCode: "SIN",
    ClientIPASN: 64500,
  }),
};

function buildSampleHttpRequestRecord(): Record<string, unknown> {
  return SAMPLE_RECORD_BUILDERS.http_requests!();
}

function buildSampleRecord(dataset: string): Record<string, unknown> {
  const builder = SAMPLE_RECORD_BUILDERS[dataset];
  return builder ? builder() : buildSampleHttpRequestRecord();
}

adminRoute.post("/api/admin/test-send", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = TestSendInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
  }

  const destination = await getDestination(c.env.DB, parsed.data.destinationId);
  if (!destination) return c.json({ error: "Destination not found" }, 404);

  const sampleDataset = destination.dataset === "all" ? "http_requests" : destination.dataset;
  const record = parsed.data.record ?? buildSampleRecord(sampleDataset);
  const mapping = destination.mappingId ? await getMapping(c.env.DB, destination.mappingId) : null;
  const rules = mapping?.rules ?? GENERIC_FALLBACK_RULES;

  const message = buildCefMessage({
    dataset: sampleDataset,
    record,
    rules,
    syslogHostname: destination.syslogHostname,
    format: destination.format,
    facility: destination.facility,
  });

  try {
    const vpcBinding = (c.env as unknown as Record<string, unknown>)["SYSLOG_VPC"] as
      | Parameters<typeof sendSyslogMessage>[2]
      | undefined;
    const info = await sendSyslogMessage(destination, message, vpcBinding);
    await recordDeliverySuccess(c.env.DB, destination.id);
    // Surface the real TCP peer we connected to. If `remoteAddress` doesn't
    // match the origin you expect (e.g. it's a Cloudflare anycast IP), the
    // destination hostname is proxied and the bytes aren't reaching your box.
    return c.json({ ok: true, message, remoteAddress: info.remoteAddress });
  } catch (err) {
    const errorMessage = err instanceof SyslogDeliveryError || err instanceof Error
      ? err.message
      : "Unknown delivery error";
    await recordDeliveryFailure(c.env.DB, destination.id, errorMessage);
    return c.json({ ok: false, error: errorMessage, message }, 502);
  }
});
