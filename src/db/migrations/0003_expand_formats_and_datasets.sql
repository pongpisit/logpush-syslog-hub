-- Adds per-destination syslog format/facility/TLS controls, and seeds
-- generic default mappings for newly-supported Logpush datasets.
-- Keep the seeded `rules` JSON in sync with
-- src/shared/cef-defaults.ts (DEFAULT_MAPPING_RULES).

ALTER TABLE destinations ADD COLUMN format TEXT NOT NULL DEFAULT 'rfc3164';   -- 'rfc3164' | 'rfc5424'
ALTER TABLE destinations ADD COLUMN facility INTEGER NOT NULL DEFAULT 16;     -- syslog facility 0-23 (16 = local0)
ALTER TABLE destinations ADD COLUMN tls INTEGER NOT NULL DEFAULT 0;          -- 0|1, transport="direct" only

INSERT INTO mappings (id, name, dataset, rules) VALUES
(
  'default-dns-logs',
  'Generic DNS Logs (CEF)',
  'dns_logs',
  '[{"cefKey":"src","sourceField":"SourceIP"},{"cefKey":"cs1","label":"queryName","sourceField":"QueryName"},{"cefKey":"cs2","label":"queryTypeId","sourceField":"QueryType"},{"cefKey":"cn1","label":"responseCode","sourceField":"ResponseCode"},{"cefKey":"cs3","label":"coloCode","sourceField":"ColoCode"},{"cefKey":"cs4","label":"cached","sourceField":"ResponseCached"},{"cefKey":"cs5","label":"ednsSubnet","sourceField":"EDNSSubnet"}]'
),
(
  'default-spectrum-events',
  'Generic Spectrum Events (CEF)',
  'spectrum_events',
  '[{"cefKey":"src","sourceField":"ClientIP"},{"cefKey":"spt","sourceField":"ClientPort"},{"cefKey":"dst","sourceField":"OriginIP"},{"cefKey":"dpt","sourceField":"OriginPort"},{"cefKey":"act","sourceField":"Event"},{"cefKey":"cs1","label":"application","sourceField":"Application"},{"cefKey":"cs2","label":"proto","sourceField":"ClientProto"},{"cefKey":"cs3","label":"country","sourceField":"ClientCountry"},{"cefKey":"cs4","label":"tlsStatus","sourceField":"ClientTlsStatus"},{"cefKey":"cs5","label":"ipFirewallMatch","sourceField":"ClientMatchedIpFirewall"},{"cefKey":"cn1","label":"status","sourceField":"Status"},{"cefKey":"cn2","label":"clientBytes","sourceField":"ClientBytes"},{"cefKey":"cn3","label":"originBytes","sourceField":"OriginBytes"}]'
),
(
  'default-gateway-http',
  'Generic Gateway HTTP (CEF)',
  'gateway_http',
  '[{"cefKey":"src","sourceField":"SourceIP"},{"cefKey":"spt","sourceField":"SourcePort"},{"cefKey":"dst","sourceField":"DestinationIP"},{"cefKey":"dpt","sourceField":"DestinationPort"},{"cefKey":"dhost","sourceField":"HTTPHost"},{"cefKey":"request","sourceField":"URL"},{"cefKey":"requestMethod","sourceField":"HTTPMethod"},{"cefKey":"requestClientApplication","sourceField":"UserAgent"},{"cefKey":"act","sourceField":"Action"},{"cefKey":"suser","sourceField":"Email"},{"cefKey":"cn1","label":"status","sourceField":"HTTPStatusCode"},{"cefKey":"cs1","label":"policyName","sourceField":"PolicyName"},{"cefKey":"cs2","label":"deviceName","sourceField":"DeviceName"},{"cefKey":"cs4","label":"srcCountry","sourceField":"SourceIPCountryCode"},{"cefKey":"externalId","sourceField":"RequestID"},{"cefKey":"deviceExternalId","sourceField":"PolicyID"}]'
),
(
  'default-gateway-dns',
  'Generic Gateway DNS (CEF)',
  'gateway_dns',
  '[{"cefKey":"src","sourceField":"SrcIP"},{"cefKey":"spt","sourceField":"SrcPort"},{"cefKey":"dst","sourceField":"DstIP"},{"cefKey":"dpt","sourceField":"DstPort"},{"cefKey":"suser","sourceField":"Email"},{"cefKey":"act","sourceField":"ResolverDecision"},{"cefKey":"cs1","label":"queryName","sourceField":"QueryName"},{"cefKey":"cs2","label":"queryType","sourceField":"QueryTypeName"},{"cefKey":"cn1","label":"rcode","sourceField":"RCode"},{"cefKey":"cs3","label":"policyName","sourceField":"PolicyName"},{"cefKey":"cs4","label":"deviceName","sourceField":"DeviceName"},{"cefKey":"cs6","label":"location","sourceField":"Location"},{"cefKey":"externalId","sourceField":"QueryID"},{"cefKey":"deviceExternalId","sourceField":"PolicyID"}]'
),
(
  'default-gateway-network',
  'Generic Gateway Network (CEF)',
  'gateway_network',
  '[{"cefKey":"src","sourceField":"SourceIP"},{"cefKey":"spt","sourceField":"SourcePort"},{"cefKey":"dst","sourceField":"DestinationIP"},{"cefKey":"dpt","sourceField":"DestinationPort"},{"cefKey":"suser","sourceField":"Email"},{"cefKey":"act","sourceField":"Action"},{"cefKey":"proto","sourceField":"TransportProtocol"},{"cefKey":"cs1","label":"sni","sourceField":"SNI"},{"cefKey":"cs2","label":"detectedProtocol","sourceField":"DetectedProtocol"},{"cefKey":"cs3","label":"policyName","sourceField":"PolicyName"},{"cefKey":"cs4","label":"deviceName","sourceField":"DeviceName"},{"cefKey":"cs5","label":"srcCountry","sourceField":"SourceIPCountryCode"},{"cefKey":"externalId","sourceField":"SessionID"},{"cefKey":"deviceExternalId","sourceField":"PolicyID"}]'
),
(
  'default-audit-logs',
  'Generic Audit Logs (CEF)',
  'audit_logs',
  '[{"cefKey":"suser","sourceField":"ActorEmail"},{"cefKey":"src","sourceField":"ActorIP"},{"cefKey":"act","sourceField":"ActionType"},{"cefKey":"outcome","sourceField":"ActionResult"},{"cefKey":"cs1","label":"resourceType","sourceField":"ResourceType"},{"cefKey":"cs2","label":"actorType","sourceField":"ActorType"},{"cefKey":"cs3","label":"interface","sourceField":"Interface"},{"cefKey":"externalId","sourceField":"ID"},{"cefKey":"deviceExternalId","sourceField":"ResourceID"},{"cefKey":"duser","sourceField":"OwnerID"}]'
),
(
  'default-nel-reports',
  'Generic NEL Reports (CEF)',
  'nel_reports',
  '[{"cefKey":"act","sourceField":"Type"},{"cefKey":"cs1","label":"phase","sourceField":"Phase"},{"cefKey":"cs2","label":"asnDescription","sourceField":"ClientIPASNDescription"},{"cefKey":"cs3","label":"country","sourceField":"ClientIPCountry"},{"cefKey":"cs4","label":"coloCode","sourceField":"LastKnownGoodColoCode"},{"cefKey":"cn1","label":"asn","sourceField":"ClientIPASN"}]'
);
