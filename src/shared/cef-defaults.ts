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
 * Generic, vendor-agnostic CEF field mappings — no SIEM-specific tuning,
 * just the standard CEF extension dictionary (src, spt, dhost, request,
 * act, cs1-15, cn1-3, flexString1-2, fileHash/fileName/fileType/fileSize,
 * externalId, deviceExternalId) so that any CEF-aware SIEM or syslog
 * collector can parse the output without vendor-specific configuration.
 *
 * These are curated for SOC monitoring across six priority use cases —
 * bot/automation, WAF tuning, DDoS, credential-leak detection, insider
 * threat, and 0-day/emerging-threat hunting — see SOC_USE_CASES.md for the
 * detection scenarios each field enables. CEF only has 15 `cs` (custom
 * string) and 3 `cn` (custom number) slots per dataset, so this is a
 * curated subset, not the full field list Cloudflare emits.
 *
 * Every field Logpush sends — including ones not named here, and any
 * fields Cloudflare adds to a dataset in the future — still reaches the
 * SOC: buildCefMessage() always appends a `raw=<full record JSON>`
 * extension (see includeRaw in cef.ts / DestinationSchema). Nothing is
 * ever silently dropped; these mappings exist purely to put the highest-
 * value fields into named, SIEM-searchable keys for fast correlation and
 * dashboards.
 *
 * NOTE: `rt` (event time) and `cat` (dataset) are populated automatically
 * by buildCefMessage() from well-known timestamp fields — do not add an
 * explicit `rt` rule here or it will be emitted twice.
 */
export const DEFAULT_MAPPING_RULES: Record<string, MappingRule[]> = {
  // Zone-level edge HTTP request log — the primary dataset for WAF tuning,
  // bot/automation detection, credential-stuffing, and 0-day/attack-score
  // hunting at the HTTP layer.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/
  http_requests: [
    { cefKey: "src", sourceField: "ClientIP" },
    { cefKey: "spt", sourceField: "ClientSrcPort" },
    { cefKey: "dst", sourceField: "OriginIP" },
    { cefKey: "dhost", sourceField: "ClientRequestHost" },
    { cefKey: "request", sourceField: "ClientRequestURI" },
    { cefKey: "requestMethod", sourceField: "ClientRequestMethod" },
    { cefKey: "requestClientApplication", sourceField: "ClientRequestUserAgent" },
    { cefKey: "externalId", sourceField: "RayID" },
    // WAF / security decision — SecurityAction/SecurityRuleID are the
    // current field names (WAFAction/WAFRuleID are deprecated).
    { cefKey: "act", sourceField: "SecurityAction" },
    { cefKey: "deviceExternalId", sourceField: "SecurityRuleID" },
    { cefKey: "reason", sourceField: "SecurityRuleDescription" },
    // Numeric signals: HTTP status (WAF tuning/DDoS error-rate spikes),
    // Bot Score (bot/automation), WAF Attack Score (0-day/anomaly ML score).
    { cefKey: "cn1", label: "status", sourceField: "EdgeResponseStatus" },
    { cefKey: "cn2", label: "botScore", sourceField: "BotScore" },
    { cefKey: "cn3", label: "wafAttackScore", sourceField: "WAFAttackScore" },
    { cefKey: "cs1", label: "protocol", sourceField: "ClientRequestProtocol" },
    { cefKey: "cs2", label: "sslProto", sourceField: "ClientSSLProtocol" },
    { cefKey: "cs3", label: "cacheStatus", sourceField: "CacheCacheStatus" },
    { cefKey: "cs4", label: "country", sourceField: "ClientCountry" },
    { cefKey: "cs5", label: "coloCode", sourceField: "EdgeColoCode" },
    { cefKey: "cs6", label: "zone", sourceField: "ZoneName" },
    // WAF tuning: every security product/rule/action that matched, not
    // just the one that terminated the request.
    { cefKey: "cs7", label: "securityActions", sourceField: "SecurityActions" },
    { cefKey: "cs8", label: "securityRuleIds", sourceField: "SecurityRuleIDs" },
    { cefKey: "cs9", label: "securitySources", sourceField: "SecuritySources" },
    // DDoS / network-origin attribution.
    { cefKey: "cs10", label: "clientAsn", sourceField: "ClientASN" },
    { cefKey: "cs11", label: "clientIpClass", sourceField: "ClientIPClass" },
    // Bot/automation detection.
    { cefKey: "cs12", label: "botScoreSrc", sourceField: "BotScoreSrc" },
    { cefKey: "cs13", label: "botTags", sourceField: "BotTags" },
    // TLS client fingerprint — tracks an attacker across rotating IPs,
    // core to 0-day/APT hunting.
    { cefKey: "cs14", label: "ja3Hash", sourceField: "JA3Hash" },
    // Credential-leak detection.
    { cefKey: "cs15", label: "leakedCredResult", sourceField: "LeakedCredentialCheckResult" },
    { cefKey: "flexString1", label: "edgePathingSrc", sourceField: "EdgePathingSrc" },
    { cefKey: "flexString2", label: "ja4", sourceField: "JA4" },
  ],
  // Zone-level firewall/WAF decision log — one row per rule match, the
  // primary dataset for WAF rule-tuning and bot/DDoS product attribution.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/firewall_events/
  firewall_events: [
    { cefKey: "src", sourceField: "ClientIP" },
    { cefKey: "dhost", sourceField: "ClientRequestHost" },
    { cefKey: "request", sourceField: "ClientRequestPath" },
    { cefKey: "requestMethod", sourceField: "ClientRequestMethod" },
    { cefKey: "requestClientApplication", sourceField: "ClientRequestUserAgent" },
    { cefKey: "externalId", sourceField: "RayID" },
    { cefKey: "act", sourceField: "Action" },
    { cefKey: "deviceExternalId", sourceField: "RuleID" },
    { cefKey: "reason", sourceField: "Description" },
    { cefKey: "cn1", label: "status", sourceField: "EdgeResponseStatus" },
    { cefKey: "cn2", label: "originStatus", sourceField: "OriginResponseStatus" },
    // 0-day: Firewall for AI prompt-injection score, when applicable.
    { cefKey: "cn3", label: "aiInjectionScore", sourceField: "AISecurityInjectionScore" },
    { cefKey: "cs1", label: "querystring", sourceField: "ClientRequestQuery" },
    // Which Cloudflare security product fired (waf, botManagement,
    // rateLimit, l7ddos, apiShield, etc.) — the key field for attributing
    // an event to bot/WAF/DDoS.
    { cefKey: "cs2", label: "securitySource", sourceField: "Source" },
    { cefKey: "cs3", label: "country", sourceField: "ClientCountry" },
    { cefKey: "cs4", label: "coloCode", sourceField: "EdgeColoCode" },
    { cefKey: "cs5", label: "zone", sourceField: "ZoneName" },
    { cefKey: "cs6", label: "ruleRef", sourceField: "Ref" },
    // DDoS source attribution.
    { cefKey: "cs7", label: "clientAsn", sourceField: "ClientASN" },
    { cefKey: "cs8", label: "clientAsnDescription", sourceField: "ClientASNDescription" },
    { cefKey: "cs9", label: "clientIpClass", sourceField: "ClientIPClass" },
    { cefKey: "cs10", label: "leakedCredResult", sourceField: "LeakedCredentialCheckResult" },
    // Correlates a solved/bypassed challenge back to the request that
    // issued it — useful for bot-mitigation-flow analysis.
    { cefKey: "cs11", label: "originatorRayId", sourceField: "OriginatorRayID" },
    { cefKey: "flexString1", label: "matchIndex", sourceField: "MatchIndex" },
    { cefKey: "flexString2", label: "fraudUserId", sourceField: "FraudUserID" },
  ],
  // Zone-level recursive DNS query log.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/dns_logs/
  dns_logs: [
    { cefKey: "src", sourceField: "SourceIP" },
    { cefKey: "request", sourceField: "QueryName" },
    { cefKey: "cn1", label: "responseCode", sourceField: "ResponseCode" },
    { cefKey: "cn2", label: "queryTypeId", sourceField: "QueryType" },
    { cefKey: "cs1", label: "coloCode", sourceField: "ColoCode" },
    { cefKey: "cs2", label: "cached", sourceField: "ResponseCached" },
    { cefKey: "cs3", label: "ednsSubnet", sourceField: "EDNSSubnet" },
  ],
  // Spectrum TCP/UDP proxy connection events — L4 visibility, primarily
  // used for DDoS/anomaly detection on non-HTTP protocols.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/spectrum_events/
  spectrum_events: [
    { cefKey: "src", sourceField: "ClientIP" },
    { cefKey: "spt", sourceField: "ClientPort" },
    { cefKey: "dst", sourceField: "OriginIP" },
    { cefKey: "dpt", sourceField: "OriginPort" },
    { cefKey: "act", sourceField: "Event" },
    { cefKey: "proto", sourceField: "ClientProto" },
    { cefKey: "cn1", label: "status", sourceField: "Status" },
    { cefKey: "cn2", label: "clientBytes", sourceField: "ClientBytes" },
    { cefKey: "cn3", label: "originBytes", sourceField: "OriginBytes" },
    { cefKey: "cs1", label: "application", sourceField: "Application" },
    { cefKey: "cs2", label: "country", sourceField: "ClientCountry" },
    { cefKey: "cs3", label: "tlsStatus", sourceField: "ClientTlsStatus" },
    { cefKey: "cs4", label: "ipFirewallMatch", sourceField: "ClientMatchedIpFirewall" },
    // DDoS source attribution (note the API's own casing: "ClientAsn").
    { cefKey: "cs5", label: "clientAsn", sourceField: "ClientAsn" },
    // Target identification for TLS-based L4 DDoS/abuse.
    { cefKey: "cs6", label: "sni", sourceField: "ClientTlsClientHelloServerName" },
    // Origin cert integrity check — a changed fingerprint can indicate a
    // MITM/origin-compromise 0-day.
    { cefKey: "cs7", label: "originTlsFingerprint", sourceField: "OriginTlsFingerprint" },
    { cefKey: "cs8", label: "originTlsStatus", sourceField: "OriginTlsStatus" },
    { cefKey: "cs9", label: "ipFirewallEnabled", sourceField: "IpFirewall" },
  ],
  // Zero Trust Gateway HTTP filtering decisions — the primary dataset for
  // insider-threat (DLP, file transfers, shadow IT) and endpoint malware
  // (blocked-file) detection.
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
    { cefKey: "externalId", sourceField: "RequestID" },
    { cefKey: "deviceExternalId", sourceField: "PolicyID" },
    // Endpoint malware / file-blocking (0-day payload delivery attempts).
    { cefKey: "reason", sourceField: "BlockedFileReason" },
    { cefKey: "fileHash", sourceField: "BlockedFileHash" },
    { cefKey: "fileName", sourceField: "BlockedFileName" },
    { cefKey: "fileType", sourceField: "BlockedFileType" },
    { cefKey: "fileSize", sourceField: "BlockedFileSize" },
    { cefKey: "cn1", label: "status", sourceField: "HTTPStatusCode" },
    { cefKey: "cs1", label: "policyName", sourceField: "PolicyName" },
    { cefKey: "cs2", label: "deviceName", sourceField: "DeviceName" },
    // Insider-threat: identity/device correlation.
    { cefKey: "cs3", label: "deviceId", sourceField: "DeviceID" },
    { cefKey: "cs4", label: "userId", sourceField: "UserID" },
    { cefKey: "cs5", label: "srcCountry", sourceField: "SourceIPCountryCode" },
    { cefKey: "cs6", label: "quarantined", sourceField: "Quarantined" },
    { cefKey: "cs7", label: "isIsolated", sourceField: "IsIsolated" },
    // DLP — data exfiltration is the core insider-threat signal.
    { cefKey: "cs8", label: "dlpDownloadProfiles", sourceField: "DownloadMatchedDlpProfiles" },
    { cefKey: "cs9", label: "dlpUploadProfiles", sourceField: "UploadMatchedDlpProfiles" },
    // Shadow IT / risky-category access.
    { cefKey: "cs10", label: "applicationNames", sourceField: "ApplicationNames" },
    { cefKey: "cs11", label: "categoryNames", sourceField: "CategoryNames" },
    { cefKey: "cs12", label: "sessionId", sourceField: "SessionID" },
    { cefKey: "cs13", label: "virtualNetworkName", sourceField: "VirtualNetworkName" },
    // Untrusted origin cert action — possible MITM/0-day cert anomaly.
    { cefKey: "cs14", label: "untrustedCertAction", sourceField: "UntrustedCertificateAction" },
    { cefKey: "cs15", label: "forensicCopyStatus", sourceField: "ForensicCopyStatus" },
    { cefKey: "flexString1", label: "sourceInternalIp", sourceField: "SourceInternalIP" },
    { cefKey: "flexString2", label: "registrationId", sourceField: "RegistrationID" },
  ],
  // Zero Trust Gateway DNS filtering decisions — malicious/C2 domain
  // detection (threat-intel feed matches) and DNS-based data-exfiltration
  // (insider threat) visibility.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/gateway_dns/
  gateway_dns: [
    { cefKey: "src", sourceField: "SrcIP" },
    { cefKey: "spt", sourceField: "SrcPort" },
    { cefKey: "dst", sourceField: "DstIP" },
    { cefKey: "dpt", sourceField: "DstPort" },
    { cefKey: "suser", sourceField: "Email" },
    { cefKey: "act", sourceField: "ResolverDecision" },
    { cefKey: "request", sourceField: "QueryName" },
    { cefKey: "externalId", sourceField: "QueryID" },
    { cefKey: "deviceExternalId", sourceField: "PolicyID" },
    { cefKey: "cn1", label: "rcode", sourceField: "RCode" },
    { cefKey: "cn2", label: "querySize", sourceField: "QuerySize" },
    { cefKey: "cn3", label: "responseTimeMs", sourceField: "ResponseTimeMs" },
    { cefKey: "cs1", label: "queryType", sourceField: "QueryTypeName" },
    { cefKey: "cs2", label: "policyName", sourceField: "PolicyName" },
    { cefKey: "cs3", label: "deviceName", sourceField: "DeviceName" },
    { cefKey: "cs4", label: "location", sourceField: "Location" },
    { cefKey: "cs5", label: "srcCountry", sourceField: "SrcIPCountryCode" },
    // Malware/phishing category and threat-intel IOC feed matches — the
    // core 0-day/emerging-threat signal for DNS.
    { cefKey: "cs6", label: "matchedCategoryNames", sourceField: "MatchedCategoryNames" },
    { cefKey: "cs7", label: "matchedIndicatorFeedNames", sourceField: "MatchedIndicatorFeedNames" },
    { cefKey: "cs8", label: "resolvedIps", sourceField: "ResolvedIPs" },
    { cefKey: "cs9", label: "resolvedIpCountryCodes", sourceField: "ResolvedIPCountryCodes" },
    // Insider-threat: identity/device correlation.
    { cefKey: "cs10", label: "userId", sourceField: "UserID" },
    { cefKey: "cs11", label: "deviceId", sourceField: "DeviceID" },
    // CNAME-cloaking detection.
    { cefKey: "cs12", label: "cnames", sourceField: "CNAMEs" },
    { cefKey: "cs13", label: "applicationName", sourceField: "ApplicationName" },
    { cefKey: "cs14", label: "isResponseCached", sourceField: "IsResponseCached" },
    // DoH/DoT protocol — relevant to detecting DNS-tunneling/exfil attempts.
    { cefKey: "cs15", label: "protocol", sourceField: "Protocol" },
    { cefKey: "flexString1", label: "tenantId", sourceField: "TenantID" },
    { cefKey: "flexString2", label: "edeErrors", sourceField: "EDEErrors" },
  ],
  // Zero Trust Gateway Network (L3/L4) filtering decisions — insider
  // threat (shadow IT, risky egress) and DDoS/anomaly visibility for
  // non-HTTP Zero Trust traffic.
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/gateway_network/
  gateway_network: [
    { cefKey: "src", sourceField: "SourceIP" },
    { cefKey: "spt", sourceField: "SourcePort" },
    { cefKey: "dst", sourceField: "DestinationIP" },
    { cefKey: "dpt", sourceField: "DestinationPort" },
    { cefKey: "suser", sourceField: "Email" },
    { cefKey: "act", sourceField: "Action" },
    { cefKey: "proto", sourceField: "TransportProtocol" },
    { cefKey: "externalId", sourceField: "SessionID" },
    { cefKey: "deviceExternalId", sourceField: "PolicyID" },
    { cefKey: "cs1", label: "sni", sourceField: "SNI" },
    { cefKey: "cs2", label: "detectedProtocol", sourceField: "DetectedProtocol" },
    { cefKey: "cs3", label: "policyName", sourceField: "PolicyName" },
    { cefKey: "cs4", label: "deviceName", sourceField: "DeviceName" },
    { cefKey: "cs5", label: "srcCountry", sourceField: "SourceIPCountryCode" },
    { cefKey: "cs6", label: "dstCountry", sourceField: "DestinationIPCountryCode" },
    // Insider-threat: identity/device correlation.
    { cefKey: "cs7", label: "userId", sourceField: "UserID" },
    { cefKey: "cs8", label: "deviceId", sourceField: "DeviceID" },
    // Shadow IT / risky-category egress.
    { cefKey: "cs9", label: "applicationNames", sourceField: "ApplicationNames" },
    { cefKey: "cs10", label: "categoryNames", sourceField: "CategoryNames" },
    { cefKey: "cs11", label: "virtualNetworkName", sourceField: "VirtualNetworkName" },
    { cefKey: "cs12", label: "overrideIp", sourceField: "OverrideIP" },
    { cefKey: "cs13", label: "tenantId", sourceField: "TenantID" },
    { cefKey: "cs14", label: "sourceInternalIp", sourceField: "SourceInternalIP" },
    { cefKey: "cs15", label: "registrationId", sourceField: "RegistrationID" },
  ],
  // Account-level administrative audit trail — the primary dataset for
  // insider-threat detection (privilege escalation, unauthorized config
  // changes, off-hours admin activity).
  // https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/audit_logs/
  audit_logs: [
    { cefKey: "suser", sourceField: "ActorEmail" },
    { cefKey: "src", sourceField: "ActorIP" },
    { cefKey: "act", sourceField: "ActionType" },
    { cefKey: "outcome", sourceField: "ActionResult" },
    { cefKey: "externalId", sourceField: "ID" },
    { cefKey: "deviceExternalId", sourceField: "ResourceID" },
    { cefKey: "duser", sourceField: "OwnerID" },
    { cefKey: "cs1", label: "resourceType", sourceField: "ResourceType" },
    { cefKey: "cs2", label: "actorType", sourceField: "ActorType" },
    { cefKey: "cs3", label: "interface", sourceField: "Interface" },
    { cefKey: "cs4", label: "actorId", sourceField: "ActorID" },
    { cefKey: "cs5", label: "metadata", sourceField: "Metadata" },
    // The before/after diff of an admin action — this is what lets a SOC
    // analyst see *exactly* what an insider changed (e.g. a permission
    // escalation or a firewall rule disabled to let an attack through).
    { cefKey: "cs6", label: "oldValue", sourceField: "OldValue" },
    { cefKey: "cs7", label: "newValue", sourceField: "NewValue" },
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
