CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_deliveries_unique_recipient
ON proposal_deliveries(proposal_id, recipient_email, delivery_method);
