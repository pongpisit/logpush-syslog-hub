import type { MappingRule } from "./schemas.js";

/**
 * Human-friendly CEF "name" field per Logpush dataset.
 * Falls back to the raw dataset string when not listed here.
 */
export const DATASET_LABELS: Record<string, string> = {
  http_requests: "HTTP Request",
  firewall_events: "Firewall Event",
  dns_logs: "DNS Query",
  spectrum_events: "Spectrum Event",
  gateway_http: "Gateway HTTP Event",
  gateway_dns: "Gateway DNS Query",
  gateway_network: "Gateway Network Session",
  audit_logs: "Audit Log Event",
  nel_reports: "Network Error Report",
};

/**
 * Generic, vendor-agnostic CEF field mappings. These use only the
 * standard CEF extension dictionary (src, spt, dhost, request, act, cs1-6,
 * cn1-3, externalId, deviceExternalId) so that any CEF-aware SIEM or syslog
 * collector can parse the output without vendor-specific configuration.
 *
 * NOTE: `rt` (event time) and `cat` (dataset) are populated automatically
 * by buildCefMessage() from well-known timestamp fields — do not add an
 * explicit `rt` rule here or it will be emitted twice.
 */
export const DEFAULT_MAPPING_RULES: Record<string, MappingRule[]> = {
  http_requests: [
    { cefKey: "src", sourceField: "ClientIP" },
    { cefKey: "spt", sourceField: "ClientSrcPort" },
    { cefKey: "dhost", sourceField: "ClientRequestHost" },
    { cefKey: "request", sourceField: "ClientRequestURI" },
    { cefKey: "requestMethod", sourceField: "ClientRequestMethod" },
    { cefKey: "requestClientApplication", sourceField: "ClientRequestUserAgent" },
    { cefKey: "cs1", label: "protocol", sourceField: "ClientRequestProtocol" },
    { cefKey: "cs2", label: "sslProto", sourceField: "ClientSSLProtocol" },
    { cefKey: "cs3", label: "cacheStatus", sourceField: "CacheCacheStatus" },
    { cefKey: "cs4", label: "country", sourceField: "ClientCountry" },
    { cefKey: "cs5", label: "coloCode", sourceField: "EdgeColoCode" },
    { cefKey: "cs6", label: "zone", sourceField: "ZoneName" },
    { cefKey: "cn1", label: "status", sourceField: "EdgeResponseStatus" },
    { cefKey: "cn2", label: "bytes", sourceField: "EdgeResponseBytes" },
    { cefKey: "cn3", label: "ttfbMs", sourceField: "EdgeTimeToFirstByteMs" },
    { cefKey: "externalId", sourceField: "RayID" },
    { cefKey: "act", sourceField: "WAFAction" },
    { cefKey: "deviceExternalId", sourceField: "WAFRuleID" },
  ],
  firewall_events: [
    { cefKey: "src", sourceField: "ClientIP" },
    { cefKey: "dhost", sourceField: "ClientRequestHost" },
    { cefKey: "request", sourceField: "ClientRequestPath" },
    { cefKey: "requestMethod", sourceField: "ClientRequestMethod" },
    { cefKey: "requestClientApplication", sourceField: "ClientRequestUserAgent" },
    { cefKey: "cs1", label: "querystring", sourceField: "ClientRequestQuery" },
    { cefKey: "cs4", label: "country", sourceField: "ClientCountry" },
    { cefKey: "cs5", label: "coloCode", sourceField: "EdgeColoCode" },
    { cefKey: "cs6", label: "zone", sourceField: "ZoneName" },
    { cefKey: "cn1", label: "status", sourceField: "EdgeResponseStatus" },
    { cefKey: "externalId", sourceField: "RayID" },
    { cefKey: "act", sourceField: "Action" },
    { cefKey: "deviceExternalId", sourceField: "RuleID" },
    { cefKey: "cs2", label: "source", sourceField: "Source" },
  ],
  // Zone-level recursive DNS query log.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/dns_logs/
  dns_logs: [
    { cefKey: "src", sourceField: "SourceIP" },
    { cefKey: "cs1", label: "queryName", sourceField: "QueryName" },
    { cefKey: "cs2", label: "queryTypeId", sourceField: "QueryType" },
    { cefKey: "cn1", label: "responseCode", sourceField: "ResponseCode" },
    { cefKey: "cs3", label: "coloCode", sourceField: "ColoCode" },
    { cefKey: "cs4", label: "cached", sourceField: "ResponseCached" },
    { cefKey: "cs5", label: "ednsSubnet", sourceField: "EDNSSubnet" },
  ],
  // Spectrum TCP/UDP proxy connection events.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/spectrum_events/
  spectrum_events: [
    { cefKey: "src", sourceField: "ClientIP" },
    { cefKey: "spt", sourceField: "ClientPort" },
    { cefKey: "dst", sourceField: "OriginIP" },
    { cefKey: "dpt", sourceField: "OriginPort" },
    { cefKey: "act", sourceField: "Event" },
    { cefKey: "cs1", label: "application", sourceField: "Application" },
    { cefKey: "cs2", label: "proto", sourceField: "ClientProto" },
    { cefKey: "cs3", label: "country", sourceField: "ClientCountry" },
    { cefKey: "cs4", label: "tlsStatus", sourceField: "ClientTlsStatus" },
    { cefKey: "cs5", label: "ipFirewallMatch", sourceField: "ClientMatchedIpFirewall" },
    { cefKey: "cn1", label: "status", sourceField: "Status" },
    { cefKey: "cn2", label: "clientBytes", sourceField: "ClientBytes" },
    { cefKey: "cn3", label: "originBytes", sourceField: "OriginBytes" },
  ],
  // Zero Trust Gateway HTTP filtering decisions.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/gateway_http/
  gateway_http: [
    { cefKey: "src", sourceField: "SourceIP" },
    { cefKey: "spt", sourceField: "SourcePort" },
    { cefKey: "dst", sourceField: "DestinationIP" },
    { cefKey: "dpt", sourceField: "DestinationPort" },
    { cefKey: "dhost", sourceField: "HTTPHost" },
    { cefKey: "request", sourceField: "URL" },
    { cefKey: "requestMethod", sourceField: "HTTPMethod" },
    { cefKey: "requestClientApplication", sourceField: "UserAgent" },
    { cefKey: "act", sourceField: "Action" },
    { cefKey: "suser", sourceField: "Email" },
    { cefKey: "cn1", label: "status", sourceField: "HTTPStatusCode" },
    { cefKey: "cs1", label: "policyName", sourceField: "PolicyName" },
    { cefKey: "cs2", label: "deviceName", sourceField: "DeviceName" },
    { cefKey: "cs4", label: "srcCountry", sourceField: "SourceIPCountryCode" },
    { cefKey: "externalId", sourceField: "RequestID" },
    { cefKey: "deviceExternalId", sourceField: "PolicyID" },
  ],
  // Zero Trust Gateway DNS filtering decisions.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/gateway_dns/
  gateway_dns: [
    { cefKey: "src", sourceField: "SrcIP" },
    { cefKey: "spt", sourceField: "SrcPort" },
    { cefKey: "dst", sourceField: "DstIP" },
    { cefKey: "dpt", sourceField: "DstPort" },
    { cefKey: "suser", sourceField: "Email" },
    { cefKey: "act", sourceField: "ResolverDecision" },
    { cefKey: "cs1", label: "queryName", sourceField: "QueryName" },
    { cefKey: "cs2", label: "queryType", sourceField: "QueryTypeName" },
    { cefKey: "cn1", label: "rcode", sourceField: "RCode" },
    { cefKey: "cs3", label: "policyName", sourceField: "PolicyName" },
    { cefKey: "cs4", label: "deviceName", sourceField: "DeviceName" },
    { cefKey: "cs6", label: "location", sourceField: "Location" },
    { cefKey: "externalId", sourceField: "QueryID" },
    { cefKey: "deviceExternalId", sourceField: "PolicyID" },
  ],
  // Zero Trust Gateway Network (L3/L4) filtering decisions.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/gateway_network/
  gateway_network: [
    { cefKey: "src", sourceField: "SourceIP" },
    { cefKey: "spt", sourceField: "SourcePort" },
    { cefKey: "dst", sourceField: "DestinationIP" },
    { cefKey: "dpt", sourceField: "DestinationPort" },
    { cefKey: "suser", sourceField: "Email" },
    { cefKey: "act", sourceField: "Action" },
    { cefKey: "proto", sourceField: "TransportProtocol" },
    { cefKey: "cs1", label: "sni", sourceField: "SNI" },
    { cefKey: "cs2", label: "detectedProtocol", sourceField: "DetectedProtocol" },
    { cefKey: "cs3", label: "policyName", sourceField: "PolicyName" },
    { cefKey: "cs4", label: "deviceName", sourceField: "DeviceName" },
    { cefKey: "cs5", label: "srcCountry", sourceField: "SourceIPCountryCode" },
    { cefKey: "externalId", sourceField: "SessionID" },
    { cefKey: "deviceExternalId", sourceField: "PolicyID" },
  ],
  // Account-level administrative audit trail.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/audit_logs/
  audit_logs: [
    { cefKey: "suser", sourceField: "ActorEmail" },
    { cefKey: "src", sourceField: "ActorIP" },
    { cefKey: "act", sourceField: "ActionType" },
    { cefKey: "outcome", sourceField: "ActionResult" },
    { cefKey: "cs1", label: "resourceType", sourceField: "ResourceType" },
    { cefKey: "cs2", label: "actorType", sourceField: "ActorType" },
    { cefKey: "cs3", label: "interface", sourceField: "Interface" },
    { cefKey: "externalId", sourceField: "ID" },
    { cefKey: "deviceExternalId", sourceField: "ResourceID" },
    { cefKey: "duser", sourceField: "OwnerID" },
  ],
  // Browser-reported Network Error Logging reports.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/nel_reports/
  nel_reports: [
    { cefKey: "act", sourceField: "Type" },
    { cefKey: "cs1", label: "phase", sourceField: "Phase" },
    { cefKey: "cs2", label: "asnDescription", sourceField: "ClientIPASNDescription" },
    { cefKey: "cs3", label: "country", sourceField: "ClientIPCountry" },
    { cefKey: "cs4", label: "coloCode", sourceField: "LastKnownGoodColoCode" },
    { cefKey: "cn1", label: "asn", sourceField: "ClientIPASN" },
  ],
};

/**
 * Minimal fallback used for any dataset without an explicit default mapping
 * above and without a custom mapping configured by the user. It preserves
 * the raw record as `msg` so no data is silently dropped.
 */
export const GENERIC_FALLBACK_RULES: MappingRule[] = [
  { cefKey: "externalId", sourceField: "RayID" },
  { cefKey: "src", sourceField: "ClientIP" },
];
