-- Multi-package / multi-experience event support.
-- Preserve events.package_id and events.experience_id as the primary/legacy selections
-- while allowing an event to carry additional packages and experiences.

CREATE TABLE IF NOT EXISTS event_packages (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES packages(id),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, package_id)
);

CREATE TABLE IF NOT EXISTS event_experiences (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  experience_id UUID NOT NULL REFERENCES experiences(id),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, experience_id)
);

CREATE INDEX IF NOT EXISTS idx_event_packages_package ON event_packages(package_id);
CREATE INDEX IF NOT EXISTS idx_event_experiences_experience ON event_experiences(experience_id);

-- Backfill existing single selections so existing events immediately participate
-- in the new multi-select model.
INSERT INTO event_packages (event_id, package_id, display_order)
SELECT id, package_id, 0
FROM events
WHERE package_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO event_experiences (event_id, experience_id, display_order)
SELECT id, experience_id, 0
FROM events
WHERE experience_id IS NOT NULL
ON CONFLICT DO NOTHING;
