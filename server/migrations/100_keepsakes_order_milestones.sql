-- Durable milestones survive fast state changes and worker restarts.
ALTER TABLE keepsakes_orders ADD COLUMN fulfilled_at timestamptz;
ALTER TABLE keepsakes_orders ADD COLUMN shipped_at timestamptz;
ALTER TABLE keepsakes_orders ADD COLUMN delivered_at timestamptz;
CREATE TABLE keepsakes_order_milestones (
 order_id uuid NOT NULL REFERENCES keepsakes_orders(id),
 kind text NOT NULL CHECK(kind IN('CONFIRMATION','SHIPPED','DELIVERED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(order_id,kind)
);
