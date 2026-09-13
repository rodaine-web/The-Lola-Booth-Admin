ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS business_week_start INTEGER NOT NULL DEFAULT 1 CHECK (business_week_start BETWEEN 0 AND 6);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_equipment_turnaround_buffer_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_staff_travel_buffer_minutes INTEGER NOT NULL DEFAULT 30;

CREATE INDEX IF NOT EXISTS idx_events_event_date_status ON events(event_date, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON tasks(due_date, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_status_dates ON proposals(status, sent_at, accepted_at, valid_through) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_balance_due ON invoices(due_date, amount_outstanding, balance_due, status) WHERE deleted_at IS NULL;
