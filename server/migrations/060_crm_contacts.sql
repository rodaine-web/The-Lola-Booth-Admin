-- Contacts release is independent of the optional V1.2 Event Files migration 059.
CREATE TABLE crm_companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,normalized_name text NOT NULL UNIQUE,
 website text NOT NULL DEFAULT '',industry text NOT NULL DEFAULT '',company_size text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),first_name text NOT NULL DEFAULT '',last_name text NOT NULL DEFAULT '',display_name text NOT NULL,
 email text NOT NULL,email_normalized text GENERATED ALWAYS AS(lower(btrim(email))) STORED,secondary_email text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',company text NOT NULL DEFAULT '',company_id uuid REFERENCES crm_companies(id),job_title text NOT NULL DEFAULT '',
 website text NOT NULL DEFAULT '',city text NOT NULL DEFAULT '',state text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',
 contact_type text NOT NULL DEFAULT 'PROSPECT' CHECK(contact_type IN ('PROSPECT','CLIENT','PARTNER','VENDOR','OTHER')),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),source text NOT NULL DEFAULT 'MANUAL',source_detail text NOT NULL DEFAULT '',
 tags text[] NOT NULL DEFAULT '{}',owner_id uuid REFERENCES users(id),
 marketing_consent text NOT NULL DEFAULT 'UNKNOWN' CHECK(marketing_consent IN ('UNKNOWN','OPTED_IN','OPTED_OUT')),
 consent_source text NOT NULL DEFAULT '',consented_at timestamptz,marketing_opted_out_at timestamptz,
 last_contacted_at timestamptz,archived_at timestamptz,deleted_at timestamptz,
 import_batch_id uuid,microsoft_ids jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(marketing_consent<>'OPTED_IN' OR (consent_source<>'' AND consented_at IS NOT NULL))
);
CREATE UNIQUE INDEX crm_contacts_identity ON crm_contacts(email_normalized) WHERE deleted_at IS NULL;
CREATE INDEX crm_contacts_owner ON crm_contacts(owner_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX crm_contacts_tags ON crm_contacts USING gin(tags);
CREATE TABLE crm_contact_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid NOT NULL REFERENCES crm_contacts(id),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
 author_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz
);
CREATE TABLE crm_import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('CONTACTS','LEADS')),source text NOT NULL,filename text NOT NULL,
 request_id uuid NOT NULL,content_hash text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 state text NOT NULL DEFAULT 'PREVIEW' CHECK(state IN ('PREVIEW','QUEUED','PROCESSING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
 rows_json jsonb NOT NULL DEFAULT '[]',mapping jsonb NOT NULL DEFAULT '{}',options jsonb NOT NULL DEFAULT '{}',results jsonb NOT NULL DEFAULT '[]',
 cursor_position int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(created_by,request_id)
);
ALTER TABLE crm_contacts ADD CONSTRAINT crm_contact_import_batch FOREIGN KEY(import_batch_id) REFERENCES crm_import_batches(id);
ALTER TABLE leads ADD COLUMN contact_id uuid REFERENCES crm_contacts(id);
ALTER TABLE clients ADD COLUMN contact_id uuid REFERENCES crm_contacts(id);
ALTER TABLE communications ADD COLUMN contact_id uuid REFERENCES crm_contacts(id);
ALTER TABLE campaign_recipients ADD COLUMN contact_id uuid REFERENCES crm_contacts(id);
CREATE INDEX leads_contact_link ON leads(contact_id) WHERE deleted_at IS NULL;
CREATE INDEX clients_contact_link ON clients(contact_id) WHERE deleted_at IS NULL;
CREATE INDEX communications_contact_link ON communications(contact_id) WHERE deleted_at IS NULL;
-- Exact primary-email identity only; no fuzzy matching or business-record merges.
CREATE FUNCTION link_crm_contact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity text;contact uuid;person text;first text;last text;kind text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.email IS DISTINCT FROM OLD.email AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN NEW.contact_id:=NULL;END IF;
 identity:=lower(btrim(NEW.email));IF identity IS NULL OR identity='' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-contact:'||identity,600060));
 IF TG_TABLE_NAME='clients' THEN person:=NEW.name;first:=split_part(NEW.name,' ',1);last:=substr(NEW.name,length(first)+2);kind:='CLIENT';
 ELSE first:=NEW.first_name;last:=NEW.last_name;person:=btrim(first||' '||last);kind:='PROSPECT';END IF;
 IF NEW.contact_id IS NOT NULL THEN RETURN NEW;END IF;
 SELECT id INTO contact FROM crm_contacts WHERE deleted_at IS NULL AND (email_normalized=identity OR lower(btrim(secondary_email))=identity) LIMIT 1;
 IF contact IS NULL THEN
  INSERT INTO crm_contacts(first_name,last_name,display_name,email,phone,company,contact_type,source)
   VALUES(COALESCE(first,''),COALESCE(last,''),COALESCE(NULLIF(person,''),NEW.email),NEW.email,COALESCE(NEW.phone,''),COALESCE(NEW.company,''),kind,'EXISTING_CRM') RETURNING id INTO contact;
 ELSIF kind='CLIENT' THEN UPDATE crm_contacts SET contact_type='CLIENT',updated_at=now() WHERE id=contact AND contact_type='PROSPECT';END IF;
 NEW.contact_id:=contact;RETURN NEW;
END $$;
CREATE TRIGGER clients_contact_identity BEFORE INSERT OR UPDATE OF email ON clients FOR EACH ROW EXECUTE FUNCTION link_crm_contact();
CREATE TRIGGER leads_contact_identity BEFORE INSERT OR UPDATE OF email ON leads FOR EACH ROW EXECUTE FUNCTION link_crm_contact();
UPDATE clients SET email=email WHERE deleted_at IS NULL AND email IS NOT NULL AND btrim(email)<>'';
UPDATE leads SET email=email WHERE deleted_at IS NULL AND btrim(email)<>'';
-- Unknown consent stays unknown. Recorded historical opt-outs and suppressions win.
UPDATE crm_contacts c SET marketing_consent='OPTED_OUT',marketing_opted_out_at=now() WHERE
 EXISTS(SELECT 1 FROM campaign_suppressions s WHERE lower(s.email)=c.email_normalized) OR
 EXISTS(SELECT 1 FROM clients l WHERE l.contact_id=c.id AND l.marketing_opted_out_at IS NOT NULL) OR
 EXISTS(SELECT 1 FROM leads l WHERE l.contact_id=c.id AND l.marketing_opted_out_at IS NOT NULL);
INSERT INTO permissions(key,description) VALUES ('read:contacts','Read assigned CRM contacts'),('write:contacts','Edit assigned CRM contacts'),('manage:contacts','Manage all CRM contacts and deletion'),('import:contacts','Import CRM contacts and leads') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name IN ('OWNER','ADMIN','SUPER_ADMIN') AND p.key IN ('read:contacts','write:contacts','manage:contacts','import:contacts') ON CONFLICT DO NOTHING;
INSERT INTO integration_connections(category,provider,status,metadata) VALUES('EMAIL','MICROSOFT_CONTACTS','NOT_CONNECTED','{"mailbox":"info@thelolabooth.com","aliases":["lola@thelolabooth.com"],"sync_enabled":false}') ON CONFLICT(category,provider) DO NOTHING;
CREATE TABLE crm_mailbox_discoveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connection_id uuid NOT NULL REFERENCES integration_connections(id),generation uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),params jsonb NOT NULL,streams jsonb NOT NULL,stream_position int NOT NULL DEFAULT 0,
 cursor_ciphertext jsonb,page_count int NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'QUEUED',last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_mailbox_checkpoints (
 connection_id uuid NOT NULL REFERENCES integration_connections(id),stream text NOT NULL,configuration_hash text NOT NULL,
 cursor_ciphertext jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(connection_id,stream,configuration_hash)
);
CREATE TABLE crm_mailbox_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connection_id uuid NOT NULL REFERENCES integration_connections(id),email text NOT NULL,
 display_name text NOT NULL DEFAULT '',first_name text NOT NULL DEFAULT '',last_name text NOT NULL DEFAULT '',company text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',job_title text NOT NULL DEFAULT '',microsoft_ids jsonb NOT NULL DEFAULT '{}',
 UNIQUE(connection_id,email)
);
CREATE TABLE crm_mailbox_messages (
 connection_id uuid NOT NULL REFERENCES integration_connections(id),message_id text NOT NULL,sent_at timestamptz NOT NULL,
 PRIMARY KEY(connection_id,message_id)
);
CREATE TABLE crm_mailbox_message_recipients (
 connection_id uuid NOT NULL,message_id text NOT NULL,email text NOT NULL,
 PRIMARY KEY(connection_id,message_id,email),FOREIGN KEY(connection_id,message_id) REFERENCES crm_mailbox_messages(connection_id,message_id) ON DELETE CASCADE
);
CREATE INDEX crm_mailbox_recipient_email ON crm_mailbox_message_recipients(connection_id,email);
CREATE TABLE crm_mailbox_discovery_candidates (
 discovery_id uuid REFERENCES crm_mailbox_discoveries(id) ON DELETE CASCADE,candidate_id uuid REFERENCES crm_mailbox_candidates(id) ON DELETE CASCADE,
 PRIMARY KEY(discovery_id,candidate_id)
);
CREATE FUNCTION record_crm_contact_communication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contact uuid;
BEGIN
 contact:=COALESCE(NEW.contact_id,(SELECT contact_id FROM leads WHERE id=NEW.lead_id),(SELECT contact_id FROM clients WHERE id=NEW.client_id));
 IF contact IS NOT NULL AND NEW.direction='OUTBOUND' AND (NEW.type IN ('CALL','PHONE') OR NEW.status IN ('SENT_TO_PROVIDER','DELIVERED','SENT')) THEN
  UPDATE crm_contacts SET last_contacted_at=GREATEST(last_contacted_at,COALESCE(NEW.sent_at,NEW.occurred_at)),updated_at=now() WHERE id=contact;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER crm_contact_communications AFTER INSERT OR UPDATE OF status ON communications FOR EACH ROW EXECUTE FUNCTION record_crm_contact_communication();

ALTER TABLE crm_mailbox_message_recipients ADD COLUMN IF NOT EXISTS configuration_hash text NOT NULL DEFAULT '';
ALTER TABLE crm_mailbox_message_recipients DROP CONSTRAINT IF EXISTS crm_mailbox_message_recipients_pkey;
ALTER TABLE crm_mailbox_message_recipients ADD PRIMARY KEY(connection_id,message_id,email,configuration_hash);
CREATE TABLE IF NOT EXISTS crm_mailbox_cached_candidates(
 connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
 candidate_id uuid NOT NULL REFERENCES crm_mailbox_candidates(id) ON DELETE CASCADE,
 stream text NOT NULL CHECK(stream IN ('SENT','CONTACTS')),configuration_hash text NOT NULL,
 PRIMARY KEY(connection_id,candidate_id,stream,configuration_hash)
);
