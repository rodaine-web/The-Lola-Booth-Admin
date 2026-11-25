# Production release — November 24, 2026

Owner authorized deployment of reviewed staging work, with WHCC/Gelato completion deferred.

Candidate combines main-staging 27762ea with main-prod 63bdd56, preserving production postcard resend/Excel fixes, analytics and hosting configuration. Existing production Gallery implementation is retained separately; new discovery landing remains staging-only. No Events/Gallery CMS records are published. Production Shop provides catalogue, photo discovery and draft/quotation workflows; all retail checkout and manufacturing remain disabled by the existing staging-only guards. Premium supplier credentials are not copied from staging.

Daily encrypted production PostgreSQL backup passed 2026-11-24 08:04 UTC, including private Azure upload/readback, 177 tables. Pre-release API deployment: 26bb52e5-0c44-4405-a86b-6baa1484fb44; worker: 68194ccc-6c0a-4805-89dd-44cfc7cdb2f5. Additive migrations 087–093 use the existing identity-checked migration runner; existing 086 is retained.

Local tracked unit suite: 899 tests, 836 passed, 63 environment-gated skips, no failures. Production build passed. Full disposable database/browser qualification runs in PR CI before merge. No production test payments, manufacturing or customer email tests. Rollback is application-only to recorded deployments; do not remove additive tables or customer data.
