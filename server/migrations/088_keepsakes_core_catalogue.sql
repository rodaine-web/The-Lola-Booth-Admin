-- Staging rebuild: retire old public listings without altering order snapshots.
ALTER TABLE keepsakes_products ADD COLUMN catalogue_key text UNIQUE;
ALTER TABLE keepsakes_products ADD COLUMN retired_at timestamptz;
ALTER TABLE keepsakes_products ADD COLUMN operational_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE keepsakes_products ALTER COLUMN retail_cents DROP NOT NULL;
ALTER TABLE keepsakes_products DROP CONSTRAINT keepsakes_products_provider_check;
ALTER TABLE keepsakes_products ADD CONSTRAINT keepsakes_products_provider_check
 CHECK(provider IN('PRODIGI','LOB','DIGITAL','IN_HOUSE','DIGITAL_EDIT','WHCC','GELATO','GELATO_OR_WHCC'));
UPDATE keepsakes_products SET active=false,retired_at=now(),updated_at=now();
INSERT INTO keepsakes_products(catalogue_key,title,category,provider,retail_cents,active,verified) VALUES
 ('edited-photo','Edited Digital Photo','digital','DIGITAL_EDIT',NULL,false,false),
 ('edited-strip','Edited Digital Photo Strip','digital','DIGITAL_EDIT',NULL,false,false),
 ('edited-package','Edited Digital Package','bundle','DIGITAL_EDIT',NULL,false,false),
 ('keychain','Photo Keychain','keychain','IN_HOUSE',NULL,false,false),
 ('magnet','Photo Magnet','magnet','IN_HOUSE',NULL,false,false),
 ('acrylic-display','Simple Acrylic Photo Display','acrylic','IN_HOUSE',NULL,false,false),
 ('jacketed-print','Photo Prints in Jackets','print','IN_HOUSE',NULL,false,false),
 ('framed-photo','Framed Photos','frame','IN_HOUSE',NULL,false,false),
 ('postcard','Personalized Postcards','postcard','LOB',NULL,false,false),
 ('premium-acrylic','Premium Acrylic Photo Block','acrylic','WHCC',NULL,false,false),
 ('photo-book','Photo Books & Albums','book','GELATO_OR_WHCC',NULL,false,false),
 ('metal-print','Metal Photo Prints','metal','WHCC',NULL,false,false);
