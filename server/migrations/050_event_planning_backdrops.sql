-- Existing events/clients/files/communications remain the system of record.
CREATE TABLE backdrops (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',image_url TEXT,
 category TEXT NOT NULL CHECK(category IN ('CLASSIC','GLAM','MODERN','FLORAL','CORPORATE')),
 kind TEXT NOT NULL DEFAULT 'PHYSICAL' CHECK(kind IN ('PHYSICAL','DIGITAL')),
 premium BOOLEAN NOT NULL DEFAULT false,upgrade_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(upgrade_price>=0),
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','MAINTENANCE','ARCHIVED')),
 dimensions TEXT,notes TEXT,tags TEXT[] NOT NULL DEFAULT '{}',display_order INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO backdrops(name,category,display_order) VALUES ('LOLA Ivory','CLASSIC',1),('Midnight','CLASSIC',2),('Champagne Glow','GLAM',3),('Silver Luxe','GLAM',4),('Modern Arch','MODERN',5),('Garden Romance','FLORAL',6),('Blush','CLASSIC',7),('Emerald Luxe','GLAM',8),('Celebration','MODERN',9),('Studio White','CLASSIC',10);
CREATE TABLE event_planning (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_id UUID NOT NULL UNIQUE REFERENCES events(id),client_id UUID NOT NULL REFERENCES clients(id),
 status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED','INVITED','IN_PROGRESS','SUBMITTED','NEEDS_REVIEW','CREATIVE_IN_PROGRESS','CLIENT_REVIEW','CHANGES_REQUESTED','APPROVED','COMPLETE')),
 brief JSONB NOT NULL DEFAULT '{}',change_requests JSONB NOT NULL DEFAULT '{}',requirements JSONB NOT NULL DEFAULT '[]',
 backdrop_id UUID REFERENCES backdrops(id),backdrop_path TEXT CHECK(backdrop_path IN ('COLLECTION','OWN','CUSTOM')),
 backdrop_review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(backdrop_review_status IN ('NEEDS_REVIEW','CONFIRMED','CHANGES_REQUIRED')),
 token_hash TEXT UNIQUE,token_ciphertext JSONB,expires_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,
 creative_task_id UUID REFERENCES tasks(id),submission_communication_id UUID REFERENCES communications(id),opened_at TIMESTAMPTZ,
 invitation_communication_id UUID REFERENCES communications(id),invited_at TIMESTAMPTZ,started_at TIMESTAMPTZ,last_saved_at TIMESTAMPTZ,submitted_at TIMESTAMPTZ,
 planning_due_at DATE,creative_due_at DATE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX event_planning_backdrop ON event_planning(backdrop_id) WHERE backdrop_id IS NOT NULL;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_planning_due_days INTEGER NOT NULL DEFAULT 21 CHECK(default_planning_due_days>=0);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_creative_due_days INTEGER NOT NULL DEFAULT 14 CHECK(default_creative_due_days>=0);
