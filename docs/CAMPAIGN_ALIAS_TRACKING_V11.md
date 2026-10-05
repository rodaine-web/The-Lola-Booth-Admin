# Campaign sender alias and engagement tracking (V1.1)

The sender selector supports approved aliases from `MICROSOFT_FROM_ALIASES`. The Graph `/users/.../sendMail` endpoint always uses `MICROSOFT_SENDER_EMAIL`, the owning mailbox. For LOLA, the mailbox is `info@thelolabooth.com`; the alias is `Lola Masha <lola@thelolabooth.com>`. Arbitrary From addresses are rejected both before saving a campaign and before contacting Microsoft.

Exchange Online must have send-from-alias enabled (`SendFromAliasEnabled`). Verify the received message's actual From address before treating the alias as qualified; Microsoft acceptance does not establish that the tenant preserved the alias.

Set `CAMPAIGN_TRACKING_ORIGIN` to the public HTTPS **backend** origin on both API and worker, e.g. `https://stagingapi.thelolabooth.com`. Apply migration 044 before deploying the new application. New campaign queueing creates random recipient-specific click and open tokens and stores their hashes. HTML links and text fallback links use server redirects; unsubscribe, email and phone links remain direct. Email layout/styles remain intact.

The admin reports unique recipients who clicked and estimated opens, with first activity timestamps. HEAD, prefetch and known scanner requests do not count. Privacy proxies can inflate opens; unidentified scanners can inflate clicks. Tracking does not prove confirmed delivery. Microsoft Graph currently confirms acceptance only, so delivery stays unavailable. Existing sent emails and preview/test emails are not retroactively tracked. Unsubscribed recipients stop adding tracking activity.

Campaign interest submissions continue to record structured responses independently. Unsubscribe continues to suppress future sends. Click redirects only use destinations stored when the email was generated, never a URL supplied in a query string. Public tokens are redacted from application request logs.

Production live-email hotfix: `PRODUCTION_EMAIL_ENABLED=true` permits normal customer recipients, without staging QA allowlists or QA subject tagging. A leading legacy `[LOLA PRODUCTION QA]` tag is removed when a previously queued communication is sent/retried. Staging retains its QA limits and prefix. The production pause switch and marketing consent/suppression rules remain available.

Validation: sender transport unit tests; campaign queue/token and scanner/duplicate tests; real PostgreSQL API journey in CI including alias persistence, redirects, pixel, counts, legacy delivery reporting and unsubscribe. No additional email-provider account is required.
