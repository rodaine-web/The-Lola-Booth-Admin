-- Retain existing campaign keys and accept per-package catalog offers.
ALTER TABLE campaign_interests DROP CONSTRAINT IF EXISTS campaign_interests_package_check;
ALTER TABLE campaign_interests ADD CONSTRAINT campaign_interests_package_check
CHECK (package IN ('GLAM','360','DUO','GENERAL')
  OR package ~ '^EXPERIENCE_[0-9a-f-]{36}(_PACKAGE_[0-9a-f-]{36})?$');
