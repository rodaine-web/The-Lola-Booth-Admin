ALTER TABLE campaign_interests ADD COLUMN offer_snapshot jsonb;
ALTER TABLE invoices ADD COLUMN lead_id uuid REFERENCES leads(id);
ALTER TABLE invoices ADD COLUMN campaign_interest_id uuid UNIQUE REFERENCES campaign_interests(id);
ALTER TABLE payments ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE payments ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE payments ADD CONSTRAINT payments_customer_context CHECK (invoice_id IS NOT NULL OR (client_id IS NOT NULL AND event_id IS NOT NULL));
CREATE INDEX invoices_lead ON invoices(lead_id) WHERE lead_id IS NOT NULL;
