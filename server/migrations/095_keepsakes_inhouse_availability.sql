-- Owner confirmed in-house supply availability on 2026-11-25.
-- Retail prices remain unchanged. Shipping and tax settings remain explicit Admin work.
UPDATE keepsakes_products SET active=true,verified=true,verified_at=now(),
 operational_config=operational_config || jsonb_build_object('stockConfirmed',true,'productionReady',provider='IN_HOUSE','editingReady',provider='DIGITAL_EDIT'),
 variants=CASE WHEN jsonb_array_length(variants)>0 THEN variants ELSE jsonb_build_array(jsonb_build_object('id','standard','label',CASE WHEN provider='DIGITAL_EDIT' THEN 'Professional edit' ELSE 'Standard' END,
 'dimensions',CASE WHEN catalogue_key IN('acrylic-display','jacketed-print','framed-photo') THEN '4 × 6 in' WHEN catalogue_key='postcard' THEN '6 × 4 in' ELSE NULL END)) END,
 updated_at=now()
 WHERE retired_at IS NULL AND catalogue_key IS NOT NULL AND provider IN('IN_HOUSE','DIGITAL_EDIT','LOB');
-- Existing approved 4 × 6 in-house inserts; keychain/magnet dimensions must be entered in Admin.
UPDATE keepsakes_products SET variants=jsonb_build_array(jsonb_build_object('id','standard','label','Standard 4 × 6','dimensions','4 × 6 in',
 'printSpec',jsonb_build_object('widthPx',1200,'heightPx',1800,'dpi',300,'bleedPx',0,'safePx',0)))
 WHERE catalogue_key IN('acrylic-display','jacketed-print','framed-photo') AND NOT (variants->0 ? 'printSpec');
UPDATE keepsakes_products SET variants=jsonb_build_array(jsonb_build_object('id','standard','label','Personalized postcard','dimensions','6 × 4 in','backTemplate','lola-connect-v2',
 'printSpec',jsonb_build_object('widthPx',1875,'heightPx',1275,'dpi',300,'bleedPx',37,'safePx',37)))
 WHERE catalogue_key='postcard' AND NOT (variants->0 ? 'printSpec');
