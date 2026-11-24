CREATE TABLE keepsakes_book_variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES keepsakes_products(id),
 label text NOT NULL,kind text NOT NULL CHECK(kind IN ('BOOK','ALBUM')), audience text NOT NULL CHECK(audience IN ('GUEST','CLIENT')),
 cover text NOT NULL,size text,retail_cents integer NOT NULL CHECK(retail_cents>0),
 provider text NOT NULL CHECK(provider IN ('GELATO','WHCC')),provider_product_id text,
 specification jsonb NOT NULL DEFAULT '{}',evidence jsonb NOT NULL DEFAULT '{}',
 provider_cost_cents integer,shipping_estimate_cents integer,target_margin numeric,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','VERIFIED','ACTIVE','RETIRED')),
 verified_at timestamptz,effective_from timestamptz,effective_to timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status NOT IN ('VERIFIED','ACTIVE') OR (verified_at IS NOT NULL AND provider_product_id IS NOT NULL))
);
INSERT INTO keepsakes_book_variants(product_id,label,kind,audience,cover,size,retail_cents,provider)
SELECT p.id,v.label,v.kind,v.audience,v.cover,v.size,v.price,v.provider FROM keepsakes_products p CROSS JOIN (VALUES
 ('Mini Softcover Photo Book','BOOK','GUEST','Softcover',NULL,3499,'GELATO'),
 ('Hardcover Photo Book','BOOK','GUEST','Hardcover',NULL,4999,'GELATO'),
 ('Premium Event Album — 8×8','ALBUM','CLIENT','Pending supported cover','8×8',44900,'WHCC'),
 ('Premium Event Album — 10×10','ALBUM','CLIENT','Pending supported cover','10×10',52900,'WHCC')
) AS v(label,kind,audience,cover,size,price,provider) WHERE p.catalogue_key='photo-book' AND p.retired_at IS NULL;
CREATE TABLE keepsakes_book_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_hash text NOT NULL,photo_session_id uuid NOT NULL REFERENCES keepsakes_photo_sessions(id),
 variant_id uuid NOT NULL REFERENCES keepsakes_book_variants(id),audience text NOT NULL,books jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1,proof_hash text,approved_at timestamptz,approved_revision integer,
 price_snapshot jsonb NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','ORDERED','REQUIRES_REVIEW')),
 supplier_order_id text,production_status text,shipment jsonb,updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX keepsakes_book_drafts_owner ON keepsakes_book_drafts(owner_hash,updated_at DESC);
CREATE TABLE keepsakes_book_revisions (
 draft_id uuid NOT NULL REFERENCES keepsakes_book_drafts(id),revision integer NOT NULL,configuration jsonb NOT NULL,
 price_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(draft_id,revision)
);
