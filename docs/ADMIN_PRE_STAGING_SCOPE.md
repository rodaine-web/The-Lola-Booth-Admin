# Local pre-staging acceptance pass

This pass begins after the separately authorized Admin deployment of revision 4019a6e. The new completion brief supersedes deployment permission for further work: production deployment is not authorized. Do not create staging or change frozen website V1.

The acceptance suites use isolated local PostgreSQL databases, synthetic people and businesses, the development email provider, local browser controls and provider simulators. An archived website contact page is served only inside the isolated browser to exercise inquiry submission without editing or visiting production. No hosted Stripe, Microsoft inbox, Twilio, or live marketing qualification occurs here.

Evidence folder: `audit-output/admin-pre-staging-review/`. Service assertions may inspect database state; browser business transitions must use UI controls. Fixture setup and controlled failure injection are explicitly separate. Mock payment provider callbacks are signed and handled by the actual webhook service after browser confirmation.

Local verification command:

```
npm test
npm run build
LOG_LEVEL=silent node server/src/scripts/verify-platform-hardening.js --completion --pre-staging --visual
```

Requires disposable PostgreSQL on local socket `/private/tmp` port 55439 and local Chrome. The script creates and drops a dedicated database. Marketing flags are forcibly disabled in the test harness; network requests to providers are blocked or handled by explicit mocks.
