# Simple individual booking and business quote requests

The booking form returns to its earlier event details, contact details, experiences/packages and add-ons layout. A single customer choice asks Individual or Business. Individuals retain the familiar price summary; business options, package details, add-ons and summary omit prices and submit through Request a Quote. Switching modes retains selections. No customer-facing catalog selector, print configuration, travel calculator or live quote calculation remains.

Both paths submit catalog IDs and customer type. Authoritative catalog prices and the immutable internal pricing quote remain available to Admin for proposal review. Business requests are identified on the lead. Custom preferences can accompany standard experiences while remaining subject to explicit scope and price approval; unrelated fixed-price catalogs cannot be mixed. Existing Custom package links and production conversion callback remain supported.

Validation: 745 tests, 711 passed, 34 conditional skips, zero failures; production build passed. Real PostgreSQL/API browser journeys passed at desktop 1440px and mobile 390px, including a business inquiry saved from the actual form, internal package/add-on price retention, no visible business prices, preserved selections, and Custom links. Local QA uses disposable schemas and development delivery.

Staging candidate only. No production deployment is included in this change.
