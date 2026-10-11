CREATE TABLE planning_reminder_ledger (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id UUID NOT NULL REFERENCES events(id),
 kind TEXT NOT NULL CHECK(kind IN ('PLANNING','CREATIVE')),
 entity_id UUID NOT NULL,
 grant_version TEXT NOT NULL,
 period INTEGER NOT NULL CHECK(period BETWEEN 0 AND 2),
 communication_id UUID UNIQUE REFERENCES communications(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(kind,entity_id,grant_version,period)
);
