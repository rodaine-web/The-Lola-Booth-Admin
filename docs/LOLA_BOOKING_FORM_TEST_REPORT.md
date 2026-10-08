# One-page booking inquiry verification

2026-10-08. Status: PARTIAL; not deployed; production NO-GO.

| Check | Status | Evidence |
|---|---|---|
| Existing Admin automated suite plus new booking tests | COMPLETE | 613 tests: 603 pass, 0 fail, 10 database-dependent skips |
| Admin build | COMPLETE | Vite build with configLoader runner; default loader blocked by external symlink write permissions |
| Existing static website tests | COMPLETE | 18 pass, 0 fail |
| Runtime dependency security audit | COMPLETE | npm audit --omit=dev: zero reported vulnerabilities |
| Fresh staging backup and separate restore | COMPLETE | encrypted 9,213,407-byte archive; pg_restore --exit-on-error; migration history comparison; local encryption/decryption checksum verification |
| Migration 054 | COMPLETE on restore only | Application staging database not migrated |
| Concurrent requests | COMPLETE on restore only | Six service requests, one lead, one task; unchanged retries succeed |
| Changed idempotent payload / distinct event | COMPLETE on restore only | Changed key rejected; new key gives separate inquiry |
| Persistence / consent | COMPLETE on restore only | Both experiences, quantities, false consent and version persist |
| Stale inactive package | COMPLETE on restore only | Rejected server-side |
| Distributed quotas | COMPLETE on restore only | Concurrent increments from two stores; hashed keys; expiry reset |
| HTTP endpoint failures | COMPLETE on restore only | 201/replay, 400 honeypot, 403 origin, 413 size, 429 quota; GET remains available |
| Actual form interactions | COMPLETE locally | Native browser: checkbox enables own package; independent Glam/360 choices; quantity 2 survives adding another experience; incompatible print choice removed on unchecking Glam; unchecked marketing consent |
| Generated add-on visuals | COMPLETE locally | Ten individual illustrations, ten successful image loads; optimized JPEG total 831,789 bytes; source PNGs retained outside shipped assets |
| Owner supplied Glam / 360 photos | COMPLETE locally | Exact supplied photos used in matching cards |
| Narrow layout | COMPLETE at observed 773px | No horizontal overflow; two experience columns and three add-on columns |
| Explicit 375px and desktop breakpoint | BLOCKED | Browser viewport capability returned without changing observed viewport; do not count as passed |
| Hosted staging browser → API → database → Admin → proposal → invoice | PARTIAL | Shared prefill unit test passes; hosted browser journey not run for this release |
| Actual approved email delivery | BLOCKED | Dispatch remains paused; queue persistence alone is not delivery |
| Add-on compatibility configuration | PARTIAL | Documented fallback rules; no editable catalog matrix |
| Package images/durations | PARTIAL | Existing package features shown; some catalog durations/images absent; no invented values |
| Full privacy retention/suppression qualification | PARTIAL | Consent captured and unchecked by default; external marketing/suppression journey not exercised |

The local preview uses a public-field catalog snapshot from the restored database, filters qualification-only fixture records, and returns 503 on submission. It cannot create an inquiry, reserve dates or send email. Backend HTTP tests ran separately against the disposable restore using the real router and PostgreSQL persistence.

Qualification artifacts: work/booking-full-tests.log, work/booking-build.log, work/booking-db-evidence.log, work/booking-security-audit.json, and the outer outputs/booking-addons-2026-10-08.jpg. Work files and encrypted backups must not be committed; reports contain no access tokens, credentials or customer PII.
