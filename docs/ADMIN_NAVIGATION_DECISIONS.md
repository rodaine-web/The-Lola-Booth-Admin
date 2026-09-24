# Local navigation changes

Before: Dashboard; Sales (Leads, Clients, Proposals, Communications); Events (Events, Calendar, Equipment, Staff); Finance (Payments, Invoices); Website (13 destinations); Catalog (Add-ons); Operations (Live, Tasks, Files, Client Galleries); Insights; System (5 destinations).

After:
- Dashboard
- Sales: Leads, Clients, Proposals, Invoices, Add-ons
- Events: Events, Calendar, Tasks
- Operations: Live Board, Staff, Equipment
- Communications: history/composer, templates and automations remain tabs of one workspace
- Website: existing unique CMS routes retained in a collapsible group
- Reporting: Analytics
- System: Users, Integrations, Health, Audit Log, Settings

Groups expand for the current route. All existing URLs remain valid. The desktop/mobile navigation uses the same permission filtering.

| Page/area | Purpose / unique function | Action |
|---|---|---|
| Invoices | Create and manage customer financial documents | KEEP, NEST in Sales |
| Payments | Existing receipts and settlement records; execution deferred | REMOVE FROM NAV for this sprint; preserve direct route/history links |
| Receipts | Document within payment detail, not a separate primary page | KEEP nested; do not duplicate invoice navigation |
| Reconciliation | Existing finance service, not a duplicate invoice page | KEEP backend; no new primary destination |
| Add-ons | Catalog pricing used by sales | NEST in Sales |
| Equipment / Staff | Event resources and assignment history | MOVE to Operations |
| Tasks | Daily work associated with events and sales | MOVE to Events |
| Files | Incomplete standalone management surface | HIDE primary navigation until lifecycle/authorization UAT passes; event/document files remain accessible in context |
| Client Galleries | Incomplete standalone management surface | HIDE primary navigation; existing event delivery functions preserved |
| CMS sections | Different content types with unique publication semantics | KEEP; COLLAPSE Website group, improve page/section filters rather than delete unique controls |
| Insights | Reporting terminology | RENAME to Reporting |

No production navigation has changed. Hiding Files/Galleries is an intentional scope choice allowed by the brief, not a claim that their full standalone workflows are complete.
