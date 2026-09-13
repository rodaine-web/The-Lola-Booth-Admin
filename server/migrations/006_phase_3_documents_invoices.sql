ALTER TABLE proposals ADD COLUMN IF NOT EXISTS proposal_number TEXT UNIQUE;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages(id);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS experience_id UUID REFERENCES experiences(id);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS secure_token TEXT UNIQUE;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS valid_through DATE;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS accepted_by_name TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS accepted_ip INET;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS accepted_user_agent TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS accepted_version_id UUID;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS content JSONB NOT NULL DEFAULT '{}';
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB NOT NULL DEFAULT '{}';
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS line_items_snapshot JSONB NOT NULL DEFAULT '[]';

DO $$
BEGIN
  ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
  ALTER TABLE proposals ADD CONSTRAINT proposals_status_check CHECK (status IN (
    'DRAFT', 'READY', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED', 'ARCHIVED'
  ));
END $$;

UPDATE proposals
SET proposal_number = COALESCE(proposal_number, 'PROP-' || lpad(row_number::text, 5, '0')),
    secure_token = COALESCE(secure_token, encode(gen_random_bytes(24), 'hex')),
    valid_through = COALESCE(valid_through, (created_at::date + interval '14 days')::date)
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS row_number
  FROM proposals
  WHERE proposal_number IS NULL OR secure_token IS NULL
) numbered
WHERE proposals.id = numbered.id;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS secure_token TEXT UNIQUE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES proposals(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issue_date DATE NOT NULL DEFAULT current_date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_outstanding NUMERIC(12,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS terms TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB NOT NULL DEFAULT '{}';

UPDATE invoices
SET secure_token = COALESCE(secure_token, encode(gen_random_bytes(24), 'hex')),
    amount_outstanding = COALESCE(amount_outstanding, balance_due)
WHERE secure_token IS NULL OR amount_outstanding IS NULL;

DO $$
BEGIN
  ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
  ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN (
    'DRAFT', 'SENT', 'VIEWED', 'PARTIALLY_PAID', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID', 'REFUNDED'
  ));
END $$;

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS taxable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(12,2);
UPDATE invoice_items SET line_total = COALESCE(line_total, total);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id);

ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS next_invoice_number INTEGER NOT NULL DEFAULT 1001;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS next_proposal_number INTEGER NOT NULL DEFAULT 1001;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS proposal_default_intro TEXT NOT NULL DEFAULT 'Thank you for considering LOLA Booths for your event.

We create elevated photo booth experiences designed to bring people together, capture the energy of the celebration, and give your guests something worth keeping.

Based on the details you shared with us, we have put together the experience below for your event.';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS proposal_default_next_steps TEXT NOT NULL DEFAULT '1. Accept your proposal.
2. Complete your booking requirements.
3. Pay the required deposit.
4. We will confirm your event.
5. Before the event we will collect final logistics and creative details.
6. LOLA arrives, sets up, and gets the party started.';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS proposal_default_terms TEXT NOT NULL DEFAULT 'Proposal pricing is valid through the date shown. Dates are reserved after booking requirements and deposit are completed.';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS proposal_default_validity_days INTEGER NOT NULL DEFAULT 14;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS proposal_acceptance_wording TEXT NOT NULL DEFAULT 'I confirm that I have reviewed and accept the proposal above.';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS invoice_default_payment_terms TEXT NOT NULL DEFAULT 'Payment is due by the due date shown on this invoice.';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS invoice_default_notes TEXT NOT NULL DEFAULT 'Questions? Reply to this invoice email and the LOLA team will help.';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS invoice_default_due_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS brand_line TEXT NOT NULL DEFAULT 'Good people. Better photos.';

UPDATE business_settings
SET next_invoice_number = GREATEST(next_invoice_number, COALESCE((SELECT max((regexp_match(invoice_number, '([0-9]+)$'))[1]::int) + 1 FROM invoices WHERE invoice_number IS NOT NULL), next_invoice_number)),
    next_proposal_number = GREATEST(next_proposal_number, COALESCE((SELECT max((regexp_match(proposal_number, '([0-9]+)$'))[1]::int) + 1 FROM proposals WHERE proposal_number IS NOT NULL), next_proposal_number));

CREATE INDEX IF NOT EXISTS idx_proposals_number ON proposals(proposal_number);
CREATE INDEX IF NOT EXISTS idx_proposals_owner ON proposals(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_proposals_valid ON proposals(valid_through);
CREATE INDEX IF NOT EXISTS idx_proposals_secure_token ON proposals(secure_token);
CREATE INDEX IF NOT EXISTS idx_invoices_secure_token ON invoices(secure_token);
CREATE INDEX IF NOT EXISTS idx_invoices_proposal ON invoices(proposal_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
