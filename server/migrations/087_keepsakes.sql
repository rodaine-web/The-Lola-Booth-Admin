-- Opt-in commerce: existing galleries and gallery permissions remain unchanged.
CREATE TABLE keepsakes_gallery_settings (
 album_id uuid PRIMARY KEY REFERENCES gallery_albums(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false, branded_merchandise boolean NOT NULL DEFAULT false,
 original_sales boolean NOT NULL DEFAULT false, product_ids uuid[] NOT NULL DEFAULT '{}',
 return_address jsonb, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gallery_photo_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
 anchor_media_id uuid NOT NULL, source_ref text, confirmed_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,album_id), UNIQUE(anchor_media_id),
 FOREIGN KEY(anchor_media_id,album_id) REFERENCES gallery_media(id,album_id)
);
CREATE TABLE gallery_session_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL, album_id uuid NOT NULL,
 media_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN('COMPOSITE','ORIGINAL','PROCESSED','EXTRACTED_CROP')),
 label text NOT NULL, sort_order integer NOT NULL DEFAULT 0, branded boolean NOT NULL DEFAULT true,
 merchandise_eligible boolean NOT NULL DEFAULT false, digital_eligible boolean NOT NULL DEFAULT false,
 included boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,media_id), FOREIGN KEY(session_id,album_id) REFERENCES gallery_photo_sessions(id,album_id) ON DELETE CASCADE,
 FOREIGN KEY(media_id,album_id) REFERENCES gallery_media(id,album_id)
);
CREATE TABLE keepsakes_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, category text NOT NULL,
 provider text NOT NULL CHECK(provider IN('PRODIGI','LOB','DIGITAL')),
 active boolean NOT NULL DEFAULT false, verified boolean NOT NULL DEFAULT false,
 retail_cents integer NOT NULL CHECK(retail_cents>0), currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 tax_code text, variants jsonb NOT NULL DEFAULT '[]', verified_at timestamptz,
 verification jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE keepsakes_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES gallery_albums(id),
 scope_hash text NOT NULL, snapshot jsonb NOT NULL, contact_ciphertext jsonb NOT NULL,
 subtotal_cents integer NOT NULL, shipping_cents integer NOT NULL, tax_cents integer NOT NULL,
 total_cents integer NOT NULL, currency text NOT NULL DEFAULT 'USD', checkout_ready boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE keepsakes_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL UNIQUE REFERENCES keepsakes_quotes(id),
 album_id uuid NOT NULL REFERENCES gallery_albums(id), status text NOT NULL DEFAULT 'AWAITING_PAYMENT',
 token_hash text NOT NULL UNIQUE, contact_ciphertext jsonb NOT NULL, snapshot jsonb NOT NULL,
 subtotal_cents integer NOT NULL, shipping_cents integer NOT NULL, tax_cents integer NOT NULL, total_cents integer NOT NULL,
 currency text NOT NULL DEFAULT 'USD', stripe_session_id text UNIQUE, stripe_payment_intent text UNIQUE,
 stripe_refund_id text, tax_transaction_id text, tax_transactions jsonb NOT NULL DEFAULT '[]',
 tax_refund_status text NOT NULL DEFAULT 'NOT_REQUIRED', tax_reversals jsonb NOT NULL DEFAULT '[]',
 checkout_url text, paid_at timestamptz, refunded_cents integer NOT NULL DEFAULT 0,
 stripe_fee_cents integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_error text, mode text NOT NULL DEFAULT 'TEST' CHECK(mode='TEST')
);
CREATE TABLE keepsakes_fulfillments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES keepsakes_orders(id),
 item_index integer NOT NULL, recipient_index integer NOT NULL DEFAULT 0, copy_index integer NOT NULL DEFAULT 0,
 provider text NOT NULL, status text NOT NULL DEFAULT 'QUEUED',
 provider_order_id text, provider_cost_cents integer, shipping_cost_cents integer, tracking jsonb NOT NULL DEFAULT '[]',
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, last_error text, artwork jsonb NOT NULL DEFAULT '[]',
 submitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(order_id,item_index,recipient_index,copy_index)
);
CREATE TABLE keepsakes_entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES keepsakes_orders(id),
 media_id uuid NOT NULL REFERENCES gallery_media(id), checksum text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', revoked_at timestamptz,
 UNIQUE(order_id,media_id)
);
CREATE TABLE keepsakes_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES keepsakes_orders(id),
 action text NOT NULL, provider_event_id text UNIQUE, details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX keepsakes_fulfillments_queue ON keepsakes_fulfillments(status,next_attempt_at);
CREATE INDEX keepsakes_orders_album ON keepsakes_orders(album_id,created_at);
CREATE TABLE keepsakes_catalogue_variants (
 sku text PRIMARY KEY, data jsonb NOT NULL DEFAULT '{}', checked_at timestamptz,
 last_error text
);
