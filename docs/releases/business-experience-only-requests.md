# Experience-only business quote requests

Business visitors provide business event details, company and contact information, requested experiences and optional add-ons. They never select a package or see pricing. Event types are restricted to Corporate Event, Conference, Brand Activation, Product Launch, Trade Show, Company Celebration and Other Business Event; the server enforces the same restriction.

Business preferences are validated against active experiences and compatible add-ons without requiring or assigning package IDs. No package pricing quote is generated. The saved request carries authoritative add-on data and all inquiry details into Admin proposal prefill, with empty package selections for staff curation. Existing manual review and explicit proposal delivery remain required. Individuals retain their package selection and pricing behavior.

The CMS event-type renderer respects business mode so a late response cannot restore personal event choices. Package-page business CTAs preselect the requested experience. The included package-page CMS timing fix also preserves original Individual cards.

Validation: targeted schema, selection and proposal-prefill tests; full suite and build; real PostgreSQL/API desktop/mobile form submission with no business package IDs or automatic package quote. Staging only; production unchanged.
