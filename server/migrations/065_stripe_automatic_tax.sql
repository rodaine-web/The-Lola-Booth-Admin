-- Stripe tax is separate from the immutable service price and booking threshold.
ALTER TABLE payments ADD COLUMN tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(tax_amount>=0 AND tax_amount<=amount);
ALTER TABLE payments ADD COLUMN tax_details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE invoice_items ADD COLUMN stripe_tax_code text CHECK(stripe_tax_code IS NULL OR stripe_tax_code ~ '^txcd_[0-9]{8}$');
ALTER TABLE invoices ADD COLUMN stripe_tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(stripe_tax_amount>=0);
CREATE OR REPLACE VIEW reporting_payments AS SELECT * FROM payments WHERE deleted_at IS NULL AND data_classification IN ('BUSINESS','UNREVIEWED');
CREATE OR REPLACE FUNCTION payment_net_received(p payments) RETURNS numeric AS $$
 SELECT greatest(0,p.amount-p.refunded_amount-p.disputed_amount-p.tax_amount);
$$ LANGUAGE SQL IMMUTABLE;
-- Partial taxed refunds/disputes need provider tax allocation, not an invented local rate.
-- Full refunds remove all principal and tax. Untaxed legacy behavior is unchanged.
CREATE OR REPLACE FUNCTION invoice_payment_review(target uuid) RETURNS boolean AS $$
 SELECT EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=target AND p.deleted_at IS NULL AND
 ((p.tax_amount>0 AND ((p.refunded_amount>0 AND p.refunded_amount<p.amount) OR p.disputed_amount>0)) OR
 EXISTS(SELECT 1 FROM payment_disputes d WHERE d.payment_id=p.id AND
 (d.status IN ('warning_needs_response','warning_under_review','needs_response','under_review','lost') OR d.funds_withheld>0))));
$$ LANGUAGE SQL STABLE;
