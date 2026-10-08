# LOLA External Integrations Hub — setup and UAT

Implementation date: 2026-10-06. This sprint is local only: no deployment, real account authorization, provider dashboard changes, or production credentials were performed.

## Ownership and scope

The existing System → Integrations page, integration_connections registry, encrypted_credentials abstraction, integration_jobs/integration_attempts worker, webhook_events history, notifications and audit logs are extended. Native LOLA campaigns, email, SMS, payment adapters, website inquiry intake and the sales lifecycle remain independent.

CRM owns contacts, identities, consent and sales. Mailchimp is downstream audience delivery; it cannot automatically overwrite core CRM identities or remove CRM suppression. GA4 is aggregate reporting, never person-level attribution. Meta/TikTok supply lead data through the existing normalization pipeline.

## CODEX CAN IMPLEMENT — implemented in this checkout

- Four provider cards with account details, real API test, account/property/audience selection, reconnect, local disconnect, sync and filtered logs.
- OAuth authorization-code flow with single-use, expiring database state; hashed browser cookie binding; Google PKCE; callback permission recheck; exact configured callback paths; encrypted token storage. Tokens never appear in browser responses or audit/log summaries.
- Existing read:integrations and write:integrations permissions reused; no new permission model.
- Google Analytics Admin API account/property discovery, Data API reports, configurable primary inquiry event and refresh-token rotation. Reports use property timezone. Worker-generated caches support Today, Week to Date, MTD, YTD and Custom up to one year.
- Reports include users, sessions, engaged sessions, engagement rate, key-event conversions, inquiry-event count, session conversion rate, traffic over time, source/medium/channel, campaign, landing page, top page and UTM content where supported. GA inquiry events and CRM inquiry counts remain separate. Campaign/source/medium matching is aggregate and may be incomplete due to attribution windows, consent and tagging differences.
- Mailchimp OAuth metadata validates its region before using a fixed API host; authorized audience discovery/selection; stable normalized email hashes; 50-contact worker batches and continuation; consent/suppression recheck; existing provider opt-outs are never re-subscribed. Existing contacts have no status override. FNAME/LNAME and available COMPANY/PHONE audience fields are mapped; lifecycle/source are tagged.
- Mailchimp unsubscribe/cleaned events suppress marketing in CRM and native campaigns without disabling transactional email. Subscribe, profile and changed-email evidence is stored for review; core contact identities and consent are not blindly replaced. A subscribe webhook alone never clears a prior opt-out.
- Mailchimp reports have an explicit provider label, separate from native campaign analytics. Delivery count is sent minus hard/soft bounces, not an independently verified delivery receipt. Opens/clicks are provider metrics and may include privacy proxies/bots.
- Signed Meta notifications are stored and queued before field retrieval. Selected Page/account is checked. Lead fields are retrieved via Graph API, with optional ad/campaign enrichment. Existing lead ID/email/phone matching uses advisory locks and prevents duplicate social leads/tasks/creation automations.
- TikTok Business OAuth/advertiser selection and signed-envelope intake foundation. Approval is explicit. **ID-only TikTok lead retrieval is not implemented/certified:** the approved Lead Generation webhook signature/payload/retrieval contract must be obtained from the app's product documentation. The currently supported t/s signature envelope is documented for TikTok webhooks and must not be assumed to cover every Lead Ads product (some have different headers). ID-only deliveries fail visibly with TIKTOK_LEAD_FIELDS_REQUIRED and remain in review logs. Do not enable this connector until this contract has been confirmed and an end-to-end lead test passes.
- Jobs share existing SKIP LOCKED claims and retry with exponential 60/120-second backoff, max three attempts. Transient network/429/5xx failures retry; authorization/permission/validation failures require review. Connection generations invalidate old jobs/callbacks after disconnect/reconnect. Disconnect cancels queued external jobs and erases local tokens/caches.
- Google refresh jobs run when expiry is within one minute. Other provider expiration/revocation requires reconnect; there is no undocumented refresh API assumption.
- Noncritical provider health extends System Health; transient provider outages do not change overall critical application health. Repeated failures or expiration notify active users granted integration management permissions, using existing preferences/email behavior; notification cooldown is one day. Disconnect is audited and notified.

## Migration and deployment preparation — do not deploy yet

Migration: `server/migrations/046_external_integrations_hub.sql`.

It extends connection status/owner/generation/failure fields, adds integration_oauth_states and integration_report_cache, adds queue indexing, and adds marketing_opted_out_at to leads/clients. It creates no new lead tables or campaign engine.

Run the complete migration chain against a disposable LOCAL database first. No live database was migrated here. This execution sandbox blocked PostgreSQL shared-memory/server startup, so database-backed tests remain unexecuted.

```
EXTERNAL_TEST_DATABASE_URL=postgres://USER@127.0.0.1:PORT/DISPOSABLE_DB node --test test/external-integrations-db.test.js
V11_TEST_DATABASE_URL=postgres://USER@127.0.0.1:PORT/DISPOSABLE_DB npm test
npm run build -- --configLoader runner
```

The runner option avoids Vite writing a temporary config into the externally located dependency symlink. It does not alter the application build.

Before a staging deployment: review diff, confirm backup, run migration tests, apply migrations with the existing migration runner, provision staging-only secrets, start API and existing worker, then perform the manual UAT below. Production is not approved by this local test result.

## URLs and API routes

Replace API_ORIGIN with the existing backend origin. Staging: https://stagingapi.thelolabooth.com. Production (future, manual): https://api.thelolabooth.com. UI: /system/integrations and /insights/analytics?report=website.

| Provider | Authenticated connect API | Public callback | Webhook |
|---|---|---|---|
| Meta | GET /api/integrations/meta/connect | /api/integrations/meta/callback | /api/webhooks/meta |
| TikTok | GET /api/integrations/tiktok/connect | /api/integrations/tiktok/callback | /api/webhooks/tiktok |
| GA4 | GET /api/integrations/google-analytics/connect | /api/integrations/google-analytics/callback | None |
| Mailchimp | GET /api/integrations/mailchimp/connect | /api/integrations/mailchimp/callback | /api/webhooks/mailchimp?key=PRIVATE_RANDOM_SECRET |

Connect returns an authorization URL and sets an HttpOnly browser-binding cookie. The UI navigates to that URL. The callback consumes state, rechecks actor permission and redirects only to configured CLIENT_ORIGIN. The API and admin should use the same site (existing staging/production subdomains); CORS permits credentialed requests. Preserve Cookie/Set-Cookie headers through proxy layers.

Other routes, all under /api/integrations:

- GET /connections, /logs, /website-analytics, /mailchimp/reports — read:integrations.
- GET /:provider/accounts — write:integrations because it accesses authorization choices.
- POST /:provider/account `{id}`; /:provider/test; /:provider/disconnect — write:integrations.
- POST /:provider/sync — write:integrations. Mailchimp `{operation:'reports'}` queues stats, otherwise contact sync; GA4 accepts `{range,from,to}`; social refreshes account metadata.
- PATCH /google-analytics/settings `{primary_inquiry_event}` — write:integrations.
- POST /jobs/:id/retry — write:integrations; retries only same-generation failed external work.
- Existing general connection PATCH may disable targeted providers but cannot claim CONNECTED or change their selections without OAuth/API verification.
- Webhook endpoints are public, independently authenticated, bounded to 1MB and rate-limited to 300 requests/minute/IP. Callbacks have a separate 30/10-minute rate limit. Provider delivery replay is deduplicated in webhook_events and integration_jobs.

## Server environment variables

Never put these in VITE_* variables, frontend settings, Git, screenshots or chat. Use staging-specific app registrations and secret manager entries. Existing INTEGRATION_SECRET_KEY (minimum 32 random characters) is reused; keep it stable while encrypted records exist. Rotation requires re-encryption/reconnection, not silent replacement.

| Provider | Variables actually used |
|---|---|
| Shared | INTEGRATION_SECRET_KEY, CLIENT_ORIGIN; STAGING_EXTERNAL_INTEGRATIONS_ENABLED=false by default |
| Meta | META_CLIENT_ID, META_CLIENT_SECRET, META_REDIRECT_URI, existing META_GRAPH_VERSION (default v24.0), existing META_WEBHOOK_VERIFY_TOKEN |
| TikTok | TIKTOK_CLIENT_ID (Business app_id), TIKTOK_CLIENT_SECRET (Business secret), TIKTOK_REDIRECT_URI, existing TIKTOK_WEBHOOK_SECRET, TIKTOK_LEAD_ACCESS_APPROVED=false |
| Google | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ANALYTICS_REDIRECT_URI |
| Mailchimp | MAILCHIMP_CLIENT_ID, MAILCHIMP_CLIENT_SECRET, MAILCHIMP_REDIRECT_URI, MAILCHIMP_WEBHOOK_SECRET (random URL key), MAILCHIMP_WEBHOOK_SIGNING_SECRET (provider-generated HMAC secret) |

Complete each app's client ID/secret/redirect together. Exact callback paths are validated; HTTPS is required except localhost/127.0.0.1 for development. env:check catalogs credentials as secrets; it must not print their values. URI validation includes *_REDIRECT_URI.

STAGING_EXTERNAL_INTEGRATIONS_ENABLED=true opts the staging worker into **external-mode jobs only**, even while regular staging automation is paused. It does not enable staging emails or legacy pixel/CAPI ingestion. Production keeps the existing PRODUCTION_AUTOMATIONS_ENABLED safety gate. No switches were changed in provider deployments during this sprint.

## I MUST DO IN PROVIDER DASHBOARD

### Google Analytics

1. Use a Google Cloud project with Analytics Data API and Analytics Admin API enabled.
2. Configure OAuth consent screen, branding and required external verification if applicable. Use staging test users while app is in testing; testing authorizations may expire sooner.
3. Create Web OAuth client. Register exactly https://stagingapi.thelolabooth.com/api/integrations/google-analytics/callback.
4. Put credentials and the exact redirect in staging secrets. The scope is analytics.readonly; no analytics edit/posting access is requested.
5. In LOLA Integrations, Connect, authorize the account with Viewer-or-higher GA property access, choose the account/property, save and test.
6. Set the site's actual inquiry event name. Refresh reports, verify GA totals/date/timezone, tagged campaign sessions, and separately compare CRM inquiry totals. No service-account path was added because OAuth fits current admin ownership.

Official references: [runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport), [accountSummaries](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list).

### Mailchimp

1. Register an OAuth app in the authorized account; configure exact staging callback https://stagingapi.thelolabooth.com/api/integrations/mailchimp/callback. Put client credentials in server secrets.
2. Connect from LOLA, select the authorized audience and save. Audience merge fields FNAME/LNAME/COMPANY/PHONE are used only when present; make mandatory custom fields compatible before syncing.
3. Generate a separate random MAILCHIMP_WEBHOOK_SECRET. Create an audience webhook pointing to https://stagingapi.thelolabooth.com/api/webhooks/mailchimp?key=THAT_SECRET. Never publish that URL/key.
4. Enable HMAC signing, copy the one-time signing secret into MAILCHIMP_WEBHOOK_SIGNING_SECRET. Enable subscribe/unsubscribe/profile/upemail/cleaned events. GET verification uses the URL key; signed deliveries verify timestamp and raw bytes via X-Mailchimp-Signature. Legacy unsigned webhooks with a URL key are supported only when no signing key is configured; signed mode is recommended.
5. Test with consented synthetic contacts. Include unsubscribed, cleaned, local-suppressed and nonconsented contacts; verify none are re-subscribed. Unsubscribe a test member and verify marketing-only suppression in LOLA. Subscribe/profile/email-change signals remain review evidence and do not automatically grant new consent/change CRM identity.
6. Refresh reports and compare with Mailchimp. Keep native campaigns independent.

Official references: [OAuth setup](https://mailchimp.com/developer/marketing/build/start-developing/set-up-an-oauth-app), [signed webhooks and audience sync](https://mailchimp.com/developer/marketing/guides/sync-audience-data-webhooks/), [API fundamentals](https://mailchimp.com/developer/marketing/docs/fundamentals/).

### Meta / Instagram

1. Create/select a Meta Business app, add Facebook Login/business and lead/webhook products as applicable; set trusted domains and exact staging callback https://stagingapi.thelolabooth.com/api/integrations/meta/callback.
2. Configure Page webhook callback https://stagingapi.thelolabooth.com/api/webhooks/meta and server META_WEBHOOK_VERIFY_TOKEN. Enable leadgen. POST requires X-Hub-Signature-256 verified with the app secret.
3. Arrange business verification/app review/Advanced Access for pages_show_list, pages_read_engagement, pages_manage_metadata, leads_retrieval and instagram_basic as required for the account. Page user must have lead access; link an Instagram Professional account to the Page.
4. Connect in LOLA, approve permissions and choose a Page. Save subscribes that Page to leadgen using its encrypted Page token. Optional ad enrichment may require additional approved ad-read permission; it must not block lead fields if denied.
5. Use Meta's Lead Ads Testing Tool. Verify fetched email/phone, Instagram/Facebook source, form/ad/campaign metadata where granted, received time, task, activity and replay deduplication. Repeat provider-ID and same-email/phone deliveries; verify one CRM lead.
6. Test invalid signature rejection and provider outage retry. Tokens expire or can be revoked independently of expiry dates; test reconnect.

Official references: [Meta lead retrieval](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/), [Meta webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/), [official Lead SDK](https://github.com/facebook/facebook-java-business-sdk/blob/main/src/main/java/com/facebook/ads/sdk/Lead.java). Meta documentation pages returned throttling errors during this run; live API permissions and payload behavior remain unverified.

### TikTok — approval and product contract still required

1. Register a **TikTok API for Business** application. Consumer Login Kit authorization is not a substitute for advertising lead access.
2. Configure trusted domains, the exact staging callback https://stagingapi.thelolabooth.com/api/integrations/tiktok/callback, and approved advertiser access. TIKTOK_CLIENT_ID is the Business app_id, not a consumer client_key.
3. Request the Lead Generation product/scopes and obtain its current webhook/retrieval documentation. Confirm signing header and algorithm for this product. Do not set TIKTOK_LEAD_ACCESS_APPROVED=true just because a Login/Ads app exists.
4. Current foundation exchanges auth_code at /open_api/v1.3/oauth2/access_token/, lists authorized advertisers and supports the documented TikTok t/s signed envelope. Leads containing approved fields can enter the shared normalization pipeline. **A different Lead Ads signing scheme or ID-only retrieval requires a follow-up adapter after the approved product contract is supplied.** This is not production-certified.
5. Configure staging webhook only after validation, then perform a real synthetic lead UAT and verify account/form/ad/adgroup/campaign/UTM identity and replay behavior.

Official references: [Business authorization](https://business-api.tiktok.com/gateway/docs/index?doc_id=1738373141733378), [official Business SDK authentication](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AuthenticationApi.md), [TikTok webhook verification](https://developers.tiktok.com/docs/en/webhooks-verification), [Business API v1.3 lead endpoint migration](https://ads.tiktok.com/gateway/docs/index?doc_id=1740579480076290).

## Disconnect and revocation

Disconnect erases LOLA's encrypted credentials, clears report cache, cancels queued external jobs and invalidates outstanding OAuth states. It does not delete CRM contacts or native campaigns. In-flight serialized operations finish before disconnect takes the connection lock. For provider-side revocation, remove the authorized app in the provider dashboard as well; local disconnect is not a claim of remote grant revocation.

## Acceptance/UAT gates

- [ ] All migrations pass on disposable PostgreSQL; repeat legacy DB/HTTP suites.
- [ ] UI browser review on desktop/mobile, admin and read-only user, API/cookie/proxy behavior.
- [ ] OAuth cancellation, stale state, wrong browser, permission removal, token refresh/revoke and reconnect.
- [ ] GA property selection, real report accuracy/timezone and inquiry event.
- [ ] Mailchimp real audience sync, suppression, signed unsubscribe and separate report accuracy.
- [ ] Meta approved permissions, real lead-field retrieval, optional attribution and duplicate delivery.
- [ ] TikTok product approval, verified signing contract and ID-only lead retrieval if required.
- [ ] Worker outage/recovery, bounded retries, logs and one notification per cooldown.
- [ ] Legacy email/SMS/payments/campaigns/inquiry UAT on staging remains passing.

These gates are intentionally unchecked: no real provider accounts were connected, and local automated evidence is not external-provider certification.
