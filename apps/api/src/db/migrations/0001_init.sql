-- Initial schema for logpush-syslog-hub
-- Keep the seeded `rules` JSON in sync with
-- packages/shared/src/cef-defaults.ts (DEFAULT_MAPPING_RULES).

CREATE TABLE IF NOT EXISTS mappings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dataset TEXT NOT NULL,
  rules TEXT NOT NULL, -- JSON array of MappingRule
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'tcp',
  transport TEXT NOT NULL DEFAULT 'direct', -- 'direct' | 'vpc'
  frame TEXT NOT NULL DEFAULT 'rfc6587',    -- 'rfc6587' | 'newline'
  dataset TEXT NOT NULL,                    -- dataset name or 'all'
  mapping_id TEXT REFERENCES mappings(id),
  syslog_hostname TEXT NOT NULL DEFAULT 'cloudflare',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS destination_status (
  destination_id TEXT PRIMARY KEY REFERENCES destinations(id) ON DELETE CASCADE,
  last_error TEXT,
  last_success TEXT,
  events_forwarded INTEGER NOT NULL DEFAULT 0,
  events_dropped INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_destinations_dataset ON destinations(dataset);
CREATE INDEX IF NOT EXISTS idx_destinations_enabled ON destinations(enabled);

-- Seed generic, vendor-agnostic default mappings (CEF standard keys only).
INSERT INTO mappings (id, name, dataset, rules) VALUES
(
  'default-http-requests',
  'Generic HTTP Requests (CEF)',
  'http_requests',
  '[{"cefKey":"rt","sourceField":"EdgeStartTimestamp"},{"cefKey":"src","sourceField":"ClientIP"},{"cefKey":"spt","sourceField":"ClientSrcPort"},{"cefKey":"dhost","sourceField":"ClientRequestHost"},{"cefKey":"request","sourceField":"ClientRequestURI"},{"cefKey":"requestMethod","sourceField":"ClientRequestMethod"},{"cefKey":"requestClientApplication","sourceField":"ClientRequestUserAgent"},{"cefKey":"cs1","label":"protocol","sourceField":"ClientRequestProtocol"},{"cefKey":"cs2","label":"sslProto","sourceField":"ClientSSLProtocol"},{"cefKey":"cs3","label":"cacheStatus","sourceField":"CacheCacheStatus"},{"cefKey":"cs4","label":"country","sourceField":"ClientCountry"},{"cefKey":"cs5","label":"coloCode","sourceField":"EdgeColoCode"},{"cefKey":"cs6","label":"zone","sourceField":"ZoneName"},{"cefKey":"cn1","label":"status","sourceField":"EdgeResponseStatus"},{"cefKey":"cn2","label":"bytes","sourceField":"EdgeResponseBytes"},{"cefKey":"cn3","label":"ttfbMs","sourceField":"EdgeTimeToFirstByteMs"},{"cefKey":"externalId","sourceField":"RayID"},{"cefKey":"act","sourceField":"WAFAction"},{"cefKey":"deviceExternalId","sourceField":"WAFRuleID"}]'
),
(
  'default-firewall-events',
  'Generic Firewall Events (CEF)',
  'firewall_events',
  '[{"cefKey":"rt","sourceField":"Datetime"},{"cefKey":"src","sourceField":"ClientIP"},{"cefKey":"dhost","sourceField":"ClientRequestHost"},{"cefKey":"request","sourceField":"ClientRequestPath"},{"cefKey":"requestMethod","sourceField":"ClientRequestMethod"},{"cefKey":"requestClientApplication","sourceField":"ClientRequestUserAgent"},{"cefKey":"cs1","label":"querystring","sourceField":"ClientRequestQuery"},{"cefKey":"cs4","label":"country","sourceField":"ClientCountry"},{"cefKey":"cs5","label":"coloCode","sourceField":"EdgeColoCode"},{"cefKey":"cs6","label":"zone","sourceField":"ZoneName"},{"cefKey":"cn1","label":"status","sourceField":"EdgeResponseStatus"},{"cefKey":"externalId","sourceField":"RayID"},{"cefKey":"act","sourceField":"Action"},{"cefKey":"deviceExternalId","sourceField":"RuleID"},{"cefKey":"cs2","label":"source","sourceField":"Source"}]'
);
