# Goal 2 execution record

Authorized scope: existing Admin/API/Worker is staging; qualify Microsoft email, two forms and isolated CMS. Public website V1 content and production hosting remain frozen. No production environment or Stripe execution.

Approved recipients: the three QA inboxes authorized in the task. Keep the actual recipient allowlist in runtime configuration, not this public repository. Do not substitute another inbox without authorization.

Implementation plan:
1. Inventory the current public pages and capture hashes. Keep legacy public CMS/API reads unchanged. Add explicit STAGING channel records separately from shared operational packages/settings so CMS edits cannot change business or public records. Block legacy public CMS mutation paths during staging.
2. Reuse the existing website staging source as a /staging-site/ rendering target with a staging-only content endpoint. Keep its edits in the staging repo as required by that repo's AGENTS.md; the new user authorization explicitly allows the reclassified API and controlled QA emails. Do not publish hidden Events/Gallery to production; staging qualification only.
3. Import current approved visible copy/assets/prices as explicit published staging records; audit parity. Generic channel records use the existing draft/published/archived lifecycle (unpublish returns to draft).
4. Test lifecycle per type, approved image fallback keyed by identity, and unchanged public output for every mutation; revert temporary visual changes.
5. Enable controlled email only after tests/guards. Select individual communication IDs for worker delivery, with a send budget and immutable delivery ledger. Contact and booking customer acknowledgments count toward the six requested template tests, not extra duplicate sends. Two owner notifications are additional form evidence; one Gmail-to-lola inbound test is separate.
6. Verify actual inboxes/rendering/trace via signed-in Gmail/Outlook/Exchange browser UI; distinguish Graph acceptance from inbox receipt. DNS is read-only inspection, not automatic mutation.
7. Restore email disabled and worker heartbeat-only. Retain clearly marked QA records, list IDs, report evidence and remaining conditions.

Current baseline commit: cf00d46; migration 026. No email sent for Goal 2 yet. Working audit evidence: audit-output/goal2/.

## Implementation checkpoint — September 25
- Current capture maps 847 published staging records: pageItems721, media25, hero6, experiences4, packages16, eventTypes6, testimonials3, FAQs40, page SEO10, settings16. These counts describe the new manifest, not hosted import completion.
- Imported into isolated LOCAL `lola_goal2_qualification`; migrations027/028 tested. No hosted migration or import yet.
- Local lifecycle service checks passed for all11 types, including a separately labeled gallery fixture. Legacy public projection remained identical after each mutation.
- CUA browser checked ten local pages. No broken img elements/horizontal overflow found. Pricing page uses all16CMS records. Empty published dataset hid all managed homepage/package/FAQ elements after reload; republish restored40FAQs.
- Local authenticated contact/availability API tests persisted test-mode leads, queued exactly2messages each, rejected unapproved recipients, and deduplicated replay. No external sends.
- Local mocked qualification worker: explicit selection, PENDING→PROCESSING→COMPLETED, no resend on next process, safe rejection/retry, ambiguous/stale claim holds passed. No external sends.
- Hosted deployment, hosted Admin UAT, actual six-template sends +2owner messages, mailbox receipt, Microsoft trace/DNS checks remain pending.

## Hosted preparation and approval checkpoint
- Final local regression: 206 tests passed; Vite build passed.
- Admin implementation committed as `ccd6db3` on `codex/goal2-staging-qualification`. It has NOT been pushed or deployed.
- Website staging source commit `6b30e71`; staging PR https://github.com/rodaine-web/staging/pull/1 merged. This private repository is verified as the existing owner-controlled staging target.
- Existing API verified APP_ENV=staging, EMAIL_PROVIDER=microsoft, STAGING_EMAIL_ENABLED=false. Applied additive migrations027/028 to the existing staging database; no legacy/public content rows changed. Hosted staging records have NOT been imported yet.
- Configured API and Worker QA recipient allowlists to include the newly approved Microsoft inbox, with email still false and --skip-deploys. API QA owner inbox is configured separately from normal FORM_NOTIFICATION_EMAIL. These configuration changes take effect on the next deployment.
- Public DNS read: MX Microsoft; SPF secureserver.net → spf-0.secureserver.net → spf.protection.outlook.com; both Microsoft DKIM CNAME targets resolve to keys; DMARC p=none. Application acceptance, delivery and inbox authentication results remain unverified.
- Automatic approval review blocked `git push origin HEAD:main`: existing Admin repository is PUBLIC. A specific asynchronous user approval request is pending for publishing tested commit ccd6db3 to that destination and triggering STAGING deployment. Do not work around this rejection through another deployment path.
- The new personal QA inbox addresses were removed from the unpublished commit before this public-destination push attempt; private recipient details stay in runtime configuration/task context.
- No Goal 2 external messages sent. Email remains disabled; no production environment created. Resume hosted deployment/import/CMS UI and controlled six-template plus two-owner delivery tests only after the pending approval is answered.

## Approved deployment preparation
The owner explicitly approved pushing the Goal 2 code to the existing public Admin repository/main and updating the existing STAGING Admin/API/Worker. The earlier push block is resolved by this authorization. Fresh checks: 206 tests pass, build passes, release diff credential scan clean, and whitespace validation clean after normalizing generated preview JavaScript. Both services report staging with email/marketing/SMS disabled and no selected email jobs. API Stripe is TEST; worker has no Stripe key. This deployment phase does not enable email or run the controlled email qualification matrix.
