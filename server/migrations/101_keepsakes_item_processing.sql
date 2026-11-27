CREATE TABLE keepsakes_item_notices (
 fulfillment_id uuid NOT NULL REFERENCES keepsakes_fulfillments(id),
 kind text NOT NULL CHECK(kind IN('DIGITAL_READY','INTEGRATION_SUBMITTED','INTEGRATION_DELIVERED')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(fulfillment_id,kind)
);
CREATE TABLE keepsakes_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES keepsakes_orders(id),
 action text NOT NULL CHECK(action IN('CANCEL','REFUND')),
 scope text NOT NULL CHECK(scope IN('ORDER','ITEMS')), items jsonb NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>=0), tax_cents integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PROCESSING','PENDING','SUCCEEDED','REQUIRES_REVIEW','FAILED')),
 reason text NOT NULL, tax_plan jsonb NOT NULL DEFAULT '[]', tax_reversals jsonb NOT NULL DEFAULT '[]',
 stripe_refund_id text UNIQUE, last_error text, applied_at timestamptz,
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX keepsakes_adjustments_order ON keepsakes_adjustments(order_id,created_at);
ALTER TABLE keepsakes_orders ADD COLUMN item_refunds_managed boolean NOT NULL DEFAULT false;
