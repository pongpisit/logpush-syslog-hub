import type { MappingRule } from "./schemas.js";

/**
 * Human-friendly CEF "name" field per Logpush dataset.
 * Falls back to the raw dataset string when not listed here.
 */
export const DATASET_LABELS: Record<string, string> = {
  http_requests: "HTTP Request",
  firewall_events: "Firewall Event",
  gateway_http: "Gateway HTTP Event",
  dns_logs: "DNS Query",
  spectrum_events: "Spectrum Event",
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
