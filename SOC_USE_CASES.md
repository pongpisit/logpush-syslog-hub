# SOC Use Cases

A field-to-detection-scenario reference for SOC teams consuming CEF output
from logpush-syslog-hub. It covers six monitoring priorities: **bot /
automated-traffic detection**, **WAF tuning & effectiveness**, **DDoS /
network-layer attacks**, **credential-leak & account-takeover detection**,
**insider threat**, and **0-day / emerging-threat hunting**.

This document is intentionally **SIEM-agnostic** — detection logic is
written as generic boolean conditions over CEF extension keys. Translate
`AND`/`OR`/`contains` into your SIEM's query language (Splunk SPL, Sentinel
KQL, Elastic EQL, QRadar AQL, etc.).

## How to read this document

Every field below is written as `<cefKey> (<label>) — <Logpush source
field>, dataset: <dataset>`. The `label` is what the field is tagged as in
the CEF output (e.g. `cs9=waf,botManagement cs9Label=securitySources`), so
you can search for the human-readable label instead of memorizing `cs9`.

**Nothing is ever silently dropped.** Every mapped record also carries a
`raw=<full Logpush record as JSON>` extension — see [Syslog Output
Format](README.md#syslog-output-format) in the README. If a use case below
needs a field that isn't in a named CEF key, it's still in `raw=`; extract
it with a JSON-path expression in your SIEM (most support querying JSON
inside a string field) rather than waiting for this mapping to be updated.

---

## 1. Bot / Automated-Traffic Detection

**Primary dataset:** `http_requests` · **Secondary:** `firewall_events`

| Field | Source | Meaning |
|---|---|---|
| `cn2` (`botScore`) | `BotScore` | 1-99. **Lower = more likely automated.** Scores <30 are commonly bots. |
| `cs12` (`botScoreSrc`) | `BotScoreSrc` | Detection engine: Heuristics / Machine Learning / Behavioral Analysis / Verified Bot / JS Fingerprinting |
| `cs13` (`botTags`) | `BotTags` | Bot category tags (JSON array) |
| `cs14` (`ja3Hash`) | `JA3Hash` | TLS client fingerprint — same value across requests even if the source IP rotates |
| `flexString2` (`ja4`) | `JA4` | Newer TLS+HTTP client fingerprint, more resistant to JA3 randomization evasion |
| `cs9` (`securitySources`, firewall_events: `cs2` `securitySource`) | `SecuritySources` / `Source` | Includes `botManagement`, `botFight` when a bot product made the decision |

### Detection scenarios

**Low-score bot traffic bypassing mitigation**
```
cn2 < 30 AND act NOT IN ("block", "challenge", "managedchallenge")
```
Bot Score below the automated-traffic threshold, but the request wasn't
blocked or challenged — either a bot-mitigation rule is misconfigured, or
this traffic needs a new rule.

**Fingerprint-based bot tracking across rotating IPs**
```
GROUP BY cs14 (ja3Hash) HAVING count(DISTINCT src) > 20 within 5m
```
The same TLS fingerprint appearing from many distinct source IPs in a
short window is a strong distributed-bot/credential-stuffing signal — more
reliable than IP-based rate limiting, since IP rotation doesn't change the
fingerprint.

**Verified-bot allowlist drift**
```
cs13 (botTags) contains "verified" AND cn1 (status) >= 400
```
A verified bot (e.g. a known search engine crawler) is receiving errors —
worth checking whether a WAF/rate-limit rule is unintentionally catching
allowlisted crawlers.

**Recommended alert severity:** Medium for isolated low-score events;
escalate to High when the JA3/JA4 group-by threshold is exceeded (indicates
coordinated automation, not a single bot).

---

## 2. WAF Tuning & Effectiveness

**Primary dataset:** `firewall_events` (per-rule-match granularity) ·
**Secondary:** `http_requests` (per-request summary)

| Field | Source | Meaning |
|---|---|---|
| `act` | `Action` (firewall_events) / `SecurityAction` (http_requests) | Final action: allow / block / challenge / jschallenge / managedchallenge / log |
| `deviceExternalId` | `RuleID` / `SecurityRuleID` | The rule that made the decision |
| `reason` | `Description` / `SecurityRuleDescription` | Human-readable rule description |
| `cs2` (`securitySource`, firewall_events) | `Source` | Which Cloudflare product: `waf`, `firewallManaged`, `firewallCustom`, `rateLimit`, `l7ddos`, `botManagement`, `apiShield`, etc. |
| `cs7`/`cs8`/`cs9` (http_requests: `securityActions`/`securityRuleIds`/`securitySources`) | `SecurityActions`/`SecurityRuleIDs`/`SecuritySources` | **All** products/rules/actions that matched a request, not just the terminating one — critical for seeing near-misses |
| `flexString1` (`matchIndex`, firewall_events) | `MatchIndex` | Position in the rule-match chain (0 = the rule that actually terminated the request) |
| `cn3` (`wafAttackScore`, http_requests) | `WAFAttackScore` | ML-based overall attack likelihood score, independent of rule matches |

### Detection scenarios

**Rules matching but not enforcing (tuning candidates)**
```
cs9 (securitySources) contains "waf" AND act = "log"
```
Requests where the WAF matched a rule in `log` mode. Review volume per
`deviceExternalId` (rule ID) — high-volume log-only matches are candidates
to promote to `block`, assuming false-positive review passes.

**High attack score with no terminating rule (false-negative gap)**
```
cn3 (wafAttackScore) < 20 AND act = "allow"
```
Per Cloudflare's WAF Attack Score, lower scores indicate a higher
likelihood of attack. Requests scored as highly likely attacks that were
still allowed through indicate a coverage gap — no managed or custom rule
currently catches this pattern.

**Rule-chain analysis (why a request wasn't blocked earlier)**
```
GROUP BY externalId (RayID) ORDER BY flexString1 (matchIndex)
```
For a given RayID, all `firewall_events` rows sorted by `matchIndex` show
the full chain of rules that matched, in evaluation order — useful for
understanding why a request was allowed despite matching several
lower-priority rules (only `matchIndex=0` terminates).

**Recommended alert severity:** Low for individual log-mode matches
(tuning signal, not an incident); High for the attack-score false-negative
gap (active exploitation risk).

---

## 3. DDoS / Network-Layer Attacks

**Primary datasets:** `firewall_events`, `http_requests` (L7) ·
`spectrum_events` (L4/L4 proxy) · `gateway_network` (Zero Trust egress)

| Field | Source | Dataset | Meaning |
|---|---|---|---|
| `cs10`/`cs7` (`clientAsn`) | `ClientASN` | http_requests / firewall_events | Source network — DDoS traffic often clusters on a small number of ASNs |
| `cs11`/`cs9` (`clientIpClass`) | `ClientIPClass` | http_requests / firewall_events | `scan`, `tor`, `noRecord` classifications correlate with abusive traffic |
| `cn1` (`status`) | `EdgeResponseStatus` / `OriginResponseStatus` (firewall_events `cn2`) | all HTTP datasets | A spike in 5xx / 429 responses across many source IPs indicates capacity exhaustion |
| `cs5` (`clientAsn`, spectrum_events) | `ClientAsn` | spectrum_events | Source ASN for non-HTTP (L4) attacks |
| `cn2`/`cn3` (`clientBytes`/`originBytes`) | `ClientBytes`/`OriginBytes` | spectrum_events | Byte-volume asymmetry is a signature of amplification attacks |
| `cs2` (`securitySource`) contains `"l7ddos"` | `Source` | firewall_events | Cloudflare's own L7 DDoS mitigation already engaged |
| `dst`/`dpt` | `OriginIP`/`OriginPort` | http_requests/spectrum_events | Which origin is under load |

### Detection scenarios

**Origin-impacting attack already mitigated at the edge**
```
cs2 (securitySource) contains "l7ddos" AND cn2 (originStatus) >= 500
```
Cloudflare's DDoS mitigation is engaging *and* the origin is still
returning errors — the attack volume is high enough to be affecting origin
capacity even with edge mitigation active. Escalate immediately; this is
not "handled, no action needed."

**Distributed attack across many ASNs vs. concentrated single-source**
```
GROUP BY cs10 (clientAsn) HAVING count(*) > threshold within 1m
```
A high match count concentrated in one or two ASNs suggests a rentable
botnet or single hosting provider you can rate-limit/block by ASN; a flat
distribution across hundreds of ASNs suggests a genuinely distributed
attack requiring Cloudflare's network-level mitigation rather than
customer-side rules.

**L4 amplification signature**
```
(originBytes / clientBytes) > 10  AND  ClientProto = "udp"
```
A large response-to-request byte ratio on UDP-based Spectrum applications
is the classic amplification-attack signature.

**Recommended alert severity:** High whenever origin status codes spike
concurrently with elevated request volume, regardless of whether edge
mitigation is engaged.

---

## 4. Credential-Leak & Account-Takeover Detection

**Primary datasets:** `http_requests`, `firewall_events` · **Secondary:**
`gateway_http` (Zero Trust identity context)

| Field | Source | Dataset | Meaning |
|---|---|---|---|
| `cs15`/`cs10` (`leakedCredResult`) | `LeakedCredentialCheckResult` | http_requests / firewall_events | `password_leaked`, `username_and_password_leaked`, `username_password_similar`, `username_leaked`, `clean` |
| `cn2` (`botScore`) | `BotScore` | http_requests | Credential-stuffing traffic is almost always low-score automated traffic |
| `cs14` (`ja3Hash`) | `JA3Hash` | http_requests | Fingerprint clustering across many login attempts |
| `dhost`/`request` | `ClientRequestHost`/`ClientRequestURI` | http_requests | Confirms the traffic targeted a login/auth endpoint |
| `suser` (`gateway_http`) | `Email` | gateway_http | If the same identity also shows anomalous Zero Trust activity, correlate here |

### Detection scenarios

**Active credential-stuffing campaign**
```
cs15 (leakedCredResult) IN ("password_leaked", "username_and_password_leaked")
  AND cn2 (botScore) < 30
```
A request using known-leaked credentials from low-score automated traffic
— the highest-confidence account-takeover signal this dataset can produce.
Alert per-account, not just per-request: if this fires for a privileged
account, treat as a P1.

**Pre-attack reconnaissance (leaked but not yet automated)**
```
cs15 (leakedCredResult) != "clean" AND cn2 (botScore) > 70
```
A leaked credential used from what looks like human/manual traffic — could
be the attacker manually validating a credential list before automating
the attack at scale. Lower urgency than the fully-automated case, but worth
tracking as an early-warning indicator.

**Fingerprint-linked credential stuffing across accounts**
```
GROUP BY cs14 (ja3Hash) HAVING count(DISTINCT <username-in-request-body>) > N
```
The same client fingerprint attempting many distinct usernames against a
login endpoint in a short window — classic credential-stuffing pattern,
independent of source IP.

**Recommended alert severity:** High/P1 for any hit on a privileged or
high-value account; Medium for bulk low-value account attempts (still
worth blocking, lower urgency for manual SOC triage).

---

## 5. Insider Threat

**Primary datasets:** `audit_logs` (admin activity) · `gateway_http` /
`gateway_network` / `gateway_dns` (Zero Trust user activity)

| Field | Source | Dataset | Meaning |
|---|---|---|---|
| `suser`/`src`/`duser` | `ActorEmail`/`ActorIP`/`OwnerID` | audit_logs | Who did what, from where, on whose behalf |
| `cs6`/`cs7` (`oldValue`/`newValue`) | `OldValue`/`NewValue` | audit_logs | **The exact before/after diff of an admin change** — JSON object |
| `outcome` | `ActionResult` | audit_logs | Whether the action succeeded — repeated `false` outcomes can indicate probing for permissions |
| `cs8`/`cs9` (`dlpDownloadProfiles`/`dlpUploadProfiles`) | `DownloadMatchedDlpProfiles`/`UploadMatchedDlpProfiles` | gateway_http | DLP policy matches on file transfers — the core data-exfiltration signal |
| `cs4` (`userId`, gateway_http/gateway_network/gateway_dns) | `UserID` | gateway_* | Stable identity across HTTP/DNS/Network Zero Trust logs, for cross-dataset correlation |
| `cs10`/`cs11` (`applicationNames`/`categoryNames`) | `ApplicationNames`/`CategoryNames` | gateway_http/gateway_network | Shadow-IT / policy-violating destination categories |
| `flexString1` (`sourceInternalIp`) | `SourceInternalIP` | gateway_http/gateway_network | Internal LAN IP behind a tunnel on-ramp — narrows a cloud identity down to a physical location/device |
| `cs7` (`matchedIndicatorFeedNames`, gateway_dns) | `MatchedIndicatorFeedNames` | gateway_dns | If an insider's device is also resolving known-malicious domains, may indicate compromise rather than intentional insider action |

### Detection scenarios

**Privilege escalation / security control weakening**
```
dataset = audit_logs AND resourceType IN ("zone_settings", "access_policy", "firewall_rule")
  AND cs6 (oldValue) more-restrictive-than cs7 (newValue)
```
Diff `oldValue` against `newValue` for security-relevant resource types
(security level lowered, an Access policy widened, a firewall rule
disabled). This is the single highest-value insider-threat signal in this
dataset — most SIEMs can do this as a lookup/enrichment rule per
`resourceType` rather than a generic string diff.

**Off-hours or geographically anomalous admin activity**
```
dataset = audit_logs AND hour(rt) NOT IN business_hours
  AND src NOT IN known_admin_ip_ranges
```
Correlate `suser` (actor) against expected working hours / expected
source IP ranges for that identity.

**Data exfiltration via file upload/download**
```
dataset = gateway_http AND (cs8 (dlpDownloadProfiles) IS PRESENT OR cs9 (dlpUploadProfiles) IS PRESENT)
```
Empty-array fields are omitted from the CEF message entirely, so "any DLP
match" is simply "the key is present." Cross-reference `cs4` (`userId`) against
HR data for employees on a performance-improvement plan, recently
terminated, or otherwise flagged — DLP matches from those identities
warrant immediate review regardless of volume.

**Shadow IT / policy bypass**
```
dataset = gateway_network AND cs10 (categoryNames) contains high-risk category
  AND act = "allow"
```
Traffic to an unsanctioned category (e.g. "File Sharing", "Anonymizers")
that was allowed rather than blocked — either the policy needs
tightening, or this is a specific user bypassing an otherwise-correct
policy (check `cs7`/`userId` for a device-specific policy override).

**Recommended alert severity:** High for security-control-weakening audit
events and DLP matches from flagged identities; Medium for shadow-IT
category access (policy-tuning signal unless repeated/escalating).

---

## 6. 0-Day / Emerging-Threat Hunting

**Primary datasets:** `http_requests`, `firewall_events` (attack-surface
signals) · `gateway_dns` (threat-intel feed matches) · `spectrum_events`
(origin integrity)

| Field | Source | Dataset | Meaning |
|---|---|---|---|
| `cn3` (`wafAttackScore`, http_requests) | `WAFAttackScore` | http_requests | ML-based anomaly score — flags attack *patterns*, not just known signatures, so it can surface novel/0-day payloads that don't match any existing rule |
| `cn3` (`aiInjectionScore`, firewall_events) | `AISecurityInjectionScore` | firewall_events | Prompt-injection score (1-99), same convention as WAF Attack Score: **lower = higher likelihood of a prompt-injection attack.** Relevant if you expose an LLM-backed endpoint. |
| `cs14`/`flexString2` (`ja3Hash`/`ja4`) | `JA3Hash`/`JA4` | http_requests | Attacker infrastructure fingerprinting — tracks a threat actor's tooling across campaigns and IP rotations, independent of any signature |
| `cs7` (`matchedIndicatorFeedNames`, gateway_dns) | `MatchedIndicatorFeedNames` | gateway_dns | Direct hit against a configured threat-intel IOC feed — by definition, feeds are curated from newly-observed/emerging threats |
| `cs7` (`originTlsFingerprint`, spectrum_events) | `OriginTlsFingerprint` | spectrum_events | SHA-256 of the origin certificate — an unexpected change can indicate origin compromise or a MITM position between Cloudflare and origin |
| `cs14`/`fileHash` (`untrustedCertAction`, gateway_http) | `UntrustedCertificateAction`/`BlockedFileHash` | gateway_http | Anomalous TLS chain to a destination, or a blocked file hash worth checking against external threat-intel (VirusTotal, etc.) |

### Detection scenarios

**Anomaly-score hunting for un-signatured attacks**
```
cn3 (wafAttackScore) < 10 AND cs9 (securitySources) IS ABSENT
```
Requests the ML attack-score model flags as highly likely attacks, but
that *no existing WAF rule matched* — note that `cs9` (and any other
array-valued field) is only emitted when non-empty, so "no rule matched"
means the key is missing from the message entirely, not present with an
empty value. This is precisely the gap where 0-day
exploitation attempts live — a novel payload structure that doesn't match
any known signature yet, but still looks anomalous by pattern. Route to a
human analyst for payload review before writing a new custom rule.

**Attacker-infrastructure correlation across separate incidents**
```
GROUP BY cs14 (ja3Hash) across time-range, cross-referenced against
known-incident RayIDs
```
If a JA3/JA4 fingerprint from a past confirmed-malicious incident
reappears — even from an entirely new IP/ASN — it's the same tooling/actor
returning. Maintain a running watchlist of fingerprints from prior
incidents and alert on any recurrence.

**Threat-intel feed hit on internal DNS resolution**
```
dataset = gateway_dns AND cs7 (matchedIndicatorFeedNames) IS PRESENT
```
A device on your network resolved a domain matching a threat-intel IOC
feed. Because feeds are updated continuously with newly-observed
infrastructure, this can be the very first internal signal of a new
campaign — treat every hit as a P1 until the endpoint is confirmed clean,
since it likely means active C2 callback or a phishing payload just
executed.

**Origin/MITM integrity check**
```
dataset = spectrum_events AND cs7 (originTlsFingerprint) != known_good_fingerprint
```
Maintain a known-good fingerprint per origin; any deviation not tied to a
planned certificate rotation warrants immediate investigation — could be
origin compromise, a misconfigured load balancer, or an interception
attempt on the Cloudflare-to-origin path.

**Recommended alert severity:** High/P1 for threat-intel feed hits and
origin-fingerprint mismatches (both are direct compromise indicators);
Medium routed-to-analyst for anomaly-score hunting (requires human
judgment, not auto-block, to avoid false-positive blocking of legitimate
novel traffic patterns).

---

## Cross-Use-Case Correlation Keys

These fields appear across multiple datasets specifically so you can pivot
between them for a single investigation:

- **`externalId` (RayID)** — links `http_requests` and `firewall_events`
  rows for the exact same request.
- **`cs4`/`cs7`/`cs10` (`userId`)** — the same Zero Trust identity across
  `gateway_http`, `gateway_dns`, and `gateway_network`.
- **`suser` (Email)** — links Zero Trust gateway activity to `audit_logs`
  admin actions by the same person.
- **`cs14` (`ja3Hash`)** — links otherwise-unrelated `http_requests` rows
  by client TLS fingerprint, independent of source IP.
- **`raw=`** — when none of the above is enough, the full original record
  is always present; extract any field with a JSON-path query.

## Extending These Mappings

Every field above comes from `src/shared/cef-defaults.ts`
(`DEFAULT_MAPPING_RULES`). If your SOC needs a field that's currently only
in `raw=` promoted to a named CEF key, either:

1. Create a **custom mapping** in the admin UI (Mappings → New) referencing
   any field name from the relevant [Logpush
   dataset](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/),
   or
2. Edit `DEFAULT_MAPPING_RULES` directly and add a migration (see
   `src/db/migrations/0004_soc_field_expansion.sql` for the pattern) so the
   change applies to every destination using the default mapping.

CEF gives you 15 `cs*` (string) and 3 `cn*` (numeric) slots per message,
plus `flexString1`/`flexString2`. If a dataset's mapping is already using
all of them, either free up a lower-priority slot or rely on `raw=` for
that field.
