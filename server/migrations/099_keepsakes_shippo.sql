CREATE TABLE keepsakes_shipping_config (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 config_ciphertext jsonb, revision uuid NOT NULL DEFAULT gen_random_uuid(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO keepsakes_shipping_config(id) VALUES(true);
CREATE TABLE keepsakes_shippo_labels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES keepsakes_orders(id),
 parcel_index integer NOT NULL CHECK(parcel_index>=0), status text NOT NULL,
 rate jsonb NOT NULL, quoted_at timestamptz NOT NULL DEFAULT now(),
 transaction_id text UNIQUE, label_url text, tracking jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(order_id,parcel_index)
);
