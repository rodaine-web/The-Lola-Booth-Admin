CREATE TABLE backdrop_quotes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_id UUID NOT NULL REFERENCES events(id),client_id UUID NOT NULL REFERENCES clients(id),
 description TEXT NOT NULL,backdrop_path TEXT NOT NULL,backdrop_id UUID REFERENCES backdrops(id),
 total NUMERIC(12,2) NOT NULL CHECK(total>0),required_payment NUMERIC(12,2) NOT NULL CHECK(required_payment>0 AND required_payment<=total),
 status TEXT NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED','ACCEPTED','DECLINED','VOID')),
 invoice_id UUID UNIQUE REFERENCES invoices(id),accepted_by TEXT,accepted_at TIMESTAMPTZ,created_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX backdrop_quote_current ON backdrop_quotes(event_id) WHERE status IN ('ISSUED','ACCEPTED');
CREATE FUNCTION protect_backdrop_quote() RETURNS TRIGGER AS $$
BEGIN
 IF OLD.status IN ('ISSUED','ACCEPTED') AND (NEW.description IS DISTINCT FROM OLD.description OR NEW.total IS DISTINCT FROM OLD.total
  OR NEW.required_payment IS DISTINCT FROM OLD.required_payment OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.event_id IS DISTINCT FROM OLD.event_id
  OR NEW.backdrop_path IS DISTINCT FROM OLD.backdrop_path OR NEW.backdrop_id IS DISTINCT FROM OLD.backdrop_id)
  OR (OLD.status='ACCEPTED' AND (NEW.accepted_by IS DISTINCT FROM OLD.accepted_by OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)) THEN
  RAISE EXCEPTION 'Issued custom work terms are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER backdrop_quote_protect BEFORE UPDATE ON backdrop_quotes FOR EACH ROW EXECUTE FUNCTION protect_backdrop_quote();
