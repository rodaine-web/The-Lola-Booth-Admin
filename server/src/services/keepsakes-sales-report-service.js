import {query} from '../db/pool.js';
import {keepsakesStaging} from '../../../shared/keepsakes.js';
import {summarizeKeepsakesSales} from '../../../shared/keepsakes-sales-report.js';

export async function keepsakesSalesReport({user,range,bookingCollected=0}){
 const manager=user?.roles?.some(role=>['OWNER','ADMIN','SUPER_ADMIN'].includes(role));
 const finance=user?.permissions?.some(permission=>['*','read:finance'].includes(permission));
 if(!manager||!finance||!keepsakesStaging())return {available:false};
 const orders=(await query(`SELECT o.status,o.paid_at,o.total_cents,o.refunded_cents,o.subtotal_cents,o.shipping_cents,o.tax_cents,o.last_error,
 COALESCE((o.snapshot->'discount'->>'cents')::int,0) discount_cents,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('key',i->'product'->>'key','title',i->'product'->>'title','units',i->'units','cancelledUnits',i->'cancelledUnits')) FROM jsonb_array_elements(o.snapshot->'items') i),'[]') items,
 EXISTS(SELECT 1 FROM reporting_payments p WHERE p.provider='STRIPE' AND p.provider_payment_id=o.stripe_payment_intent AND p.deleted_at IS NULL AND p.status IN('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') AND COALESCE(p.paid_at,p.payment_date::timestamptz,p.created_at)>=$1 AND COALESCE(p.paid_at,p.payment_date::timestamptz,p.created_at)<$2) already_reported
 FROM keepsakes_orders o WHERE o.mode='TEST' AND o.paid_at>=$1 AND o.paid_at<$2`,[range.start,range.end])).rows;
 const inventory=(await query(`WITH committed AS (
 SELECT i->'product'->>'id' product_id,sum(GREATEST(0,(i->>'units')::int-COALESCE((i->>'cancelledUnits')::int,0)))::int units
 FROM keepsakes_orders o CROSS JOIN LATERAL jsonb_array_elements(o.snapshot->'items') WITH ORDINALITY AS line(i,n)
 WHERE o.mode='TEST' AND o.paid_at IS NOT NULL AND o.status NOT IN('CANCELLED','REFUNDED') AND o.refunded_cents<o.total_cents
 AND i->>'inventoryReserved'='true'
 AND NOT EXISTS(SELECT 1 FROM keepsakes_fulfillments f WHERE f.order_id=o.id AND f.item_index=line.n-1 AND f.status IN('FULFILLED','SHIPPED','COMPLETE','CANCELLED'))
 GROUP BY 1)
 SELECT p.id,p.catalogue_key AS key,p.title,p.active,p.operational_config->'stockUnits' AS available_units,
 COALESCE((p.operational_config->>'stockConfirmed')::boolean,false) supply_confirmed,COALESCE(c.units,0) committed_units
 FROM keepsakes_products p LEFT JOIN committed c ON c.product_id=p.id::text
 WHERE p.provider='IN_HOUSE' AND p.retired_at IS NULL ORDER BY p.title`)).rows;
 const summary=summarizeKeepsakesSales(orders);
 return {available:true,mode:'TEST',...summary,combinedCollectedPreviewCents:Math.round(Number(bookingCollected)*100)+summary.totals.additionalCollectedCents,inventory};
}
