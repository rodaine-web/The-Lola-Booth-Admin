# Development data classification

Migration 024 creates explicit BUSINESS, UNREVIEWED, QA, SEED and LEGACY_FIXTURE classifications. It is a local migration only; no production migration was run.

Existing records remain UNREVIEWED. Newly created business records default to BUSINESS. No names, email addresses or historical financial values are used to automatically relabel or delete records. Explicit QA/SEED/LEGACY_FIXTURE rows are excluded through reporting views shared by Dashboard and its core Analytics figures. Unreviewed records remain visible, with a Dashboard warning, until someone classifies them with reliable evidence.

Classification procedure: inventory the source and known fixture IDs; record proposed classification and reason; review affected relationships and totals; apply in development fixtures first. Historical invoices keep their original line items and numbers; missing history is labeled, never fabricated. Production classification requires a separate reviewed change and explicit authorization. The current production baseline has not been cleaned.

Remaining gate: provide an authorized Admin classification workflow and finish reviewing historical rows before using metrics as an operational business baseline. The current strategy prevents explicitly classified test data entering metrics; it cannot prove that all unreviewed history is genuine business data.
