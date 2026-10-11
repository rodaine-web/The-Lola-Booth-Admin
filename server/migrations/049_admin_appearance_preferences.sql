-- Personal preferences never change business/public branding.
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_appearance JSONB NOT NULL DEFAULT '{"mode":"DAY","background":"#faf8f4","palette":"LOLA"}'::jsonb;
ALTER TABLE users ADD CONSTRAINT users_admin_appearance_object CHECK (jsonb_typeof(admin_appearance)='object');
