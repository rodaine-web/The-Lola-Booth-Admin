-- Draft versions are internal only. Publishing requires separate explicit approval.
CREATE TABLE keepsake_station_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version text NOT NULL UNIQUE,
 configuration jsonb NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED','RETIRED')),
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
