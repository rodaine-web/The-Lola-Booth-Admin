-- An explicit, bounded qualification queue. Ordinary automation remains paused.
CREATE TABLE staging_email_qualification_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 run_key TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('CONTACT_ACK','BOOKING_ACK','CONTACT_OWNER','BOOKING_OWNER','PROPOSAL','INVOICE','PAYMENT_TEMPLATE','MANUAL')),
 communication_id UUID NOT NULL UNIQUE REFERENCES communications(id),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','COMPLETED','FAILED','HELD_FOR_REVIEW')),
 attempt_count INTEGER NOT NULL DEFAULT 0,
 history JSONB NOT NULL DEFAULT '[{"status":"PENDING"}]',
 last_error TEXT,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(run_key,purpose)
);
