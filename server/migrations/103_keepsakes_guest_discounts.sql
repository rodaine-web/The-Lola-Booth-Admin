CREATE TABLE keepsakes_discounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN('PERCENT','AMOUNT')), value integer NOT NULL CHECK(value>0),
 minimum_cents integer NOT NULL DEFAULT 0 CHECK(minimum_cents>=0), expires_at timestamptz,
 active boolean NOT NULL DEFAULT true, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind<>'PERCENT' OR value<=10000)
);
