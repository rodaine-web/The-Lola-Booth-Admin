ALTER TABLE keepsakes_shippo_labels ADD COLUMN archived_at timestamptz;
ALTER TABLE keepsakes_shippo_labels DROP CONSTRAINT keepsakes_shippo_labels_order_id_parcel_index_key;
CREATE UNIQUE INDEX keepsakes_shippo_active_parcel ON keepsakes_shippo_labels(order_id,parcel_index) WHERE archived_at IS NULL;
CREATE TABLE keepsakes_postcard_proofs (
 fulfillment_id uuid PRIMARY KEY REFERENCES keepsakes_fulfillments(id), revision integer NOT NULL DEFAULT 1,
 front jsonb NOT NULL, back jsonb NOT NULL, validation jsonb NOT NULL DEFAULT '{}',
 address_fingerprint text NOT NULL, approved_revision integer, approved_fingerprint text,
 approved_by uuid REFERENCES users(id), approved_at timestamptz, submitted_at timestamptz,
 submitted_fingerprint text, dispatch_started_at timestamptz, dispatch_state text NOT NULL DEFAULT 'PREPARED', updated_at timestamptz NOT NULL DEFAULT now()
);
