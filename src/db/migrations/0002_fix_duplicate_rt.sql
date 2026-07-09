-- Fix: the seeded default mappings included an explicit "rt" rule, but
-- buildCefMessage() already auto-populates `rt` from well-known timestamp
-- fields (EdgeStartTimestamp / Datetime). This caused a duplicate `rt=`
-- extension key in the generated CEF message. Remove the redundant rule
-- from the two seeded mappings; user-created custom mappings are untouched.

UPDATE mappings
SET rules = '[{"cefKey":"src","sourceField":"ClientIP"},{"cefKey":"spt","sourceField":"ClientSrcPort"},{"cefKey":"dhost","sourceField":"ClientRequestHost"},{"cefKey":"request","sourceField":"ClientRequestURI"},{"cefKey":"requestMethod","sourceField":"ClientRequestMethod"},{"cefKey":"requestClientApplication","sourceField":"ClientRequestUserAgent"},{"cefKey":"cs1","label":"protocol","sourceField":"ClientRequestProtocol"},{"cefKey":"cs2","label":"sslProto","sourceField":"ClientSSLProtocol"},{"cefKey":"cs3","label":"cacheStatus","sourceField":"CacheCacheStatus"},{"cefKey":"cs4","label":"country","sourceField":"ClientCountry"},{"cefKey":"cs5","label":"coloCode","sourceField":"EdgeColoCode"},{"cefKey":"cs6","label":"zone","sourceField":"ZoneName"},{"cefKey":"cn1","label":"status","sourceField":"EdgeResponseStatus"},{"cefKey":"cn2","label":"bytes","sourceField":"EdgeResponseBytes"},{"cefKey":"cn3","label":"ttfbMs","sourceField":"EdgeTimeToFirstByteMs"},{"cefKey":"externalId","sourceField":"RayID"},{"cefKey":"act","sourceField":"WAFAction"},{"cefKey":"deviceExternalId","sourceField":"WAFRuleID"}]',
    updated_at = datetime('now')
WHERE id = 'default-http-requests';

UPDATE mappings
SET rules = '[{"cefKey":"src","sourceField":"ClientIP"},{"cefKey":"dhost","sourceField":"ClientRequestHost"},{"cefKey":"request","sourceField":"ClientRequestPath"},{"cefKey":"requestMethod","sourceField":"ClientRequestMethod"},{"cefKey":"requestClientApplication","sourceField":"ClientRequestUserAgent"},{"cefKey":"cs1","label":"querystring","sourceField":"ClientRequestQuery"},{"cefKey":"cs4","label":"country","sourceField":"ClientCountry"},{"cefKey":"cs5","label":"coloCode","sourceField":"EdgeColoCode"},{"cefKey":"cs6","label":"zone","sourceField":"ZoneName"},{"cefKey":"cn1","label":"status","sourceField":"EdgeResponseStatus"},{"cefKey":"externalId","sourceField":"RayID"},{"cefKey":"act","sourceField":"Action"},{"cefKey":"deviceExternalId","sourceField":"RuleID"},{"cefKey":"cs2","label":"source","sourceField":"Source"}]',
    updated_at = datetime('now')
WHERE id = 'default-firewall-events';
