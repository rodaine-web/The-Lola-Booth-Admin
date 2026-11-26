-- Owner supplied actual insert dimensions on 2026-11-26.
-- Preserve IDs, prices, stock, shipping, tax and historical order snapshots.
UPDATE keepsakes_products p SET variants=(
 SELECT jsonb_agg(v || jsonb_build_object(
  'dimensions',CASE WHEN p.catalogue_key='keychain' THEN '2 × 2 in' ELSE '2 × 3 in' END,
  'printSpec',jsonb_build_object('widthPx',600,'heightPx',CASE WHEN p.catalogue_key='keychain' THEN 600 ELSE 900 END,'dpi',300,'bleedPx',0,'safePx',0)) ORDER BY ord)
 FROM jsonb_array_elements(p.variants) WITH ORDINALITY AS x(v,ord)
),updated_at=now()
WHERE catalogue_key IN('keychain','magnet') AND provider='IN_HOUSE' AND retired_at IS NULL AND jsonb_array_length(variants)>0;
