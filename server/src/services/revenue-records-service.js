import {z} from 'zod';
import {reportingQuery} from './reporting-query.js';
import {query} from '../db/pool.js';
export async function revenueRecords(input){
 const {from,to,bucket}=z.object({from:z.string().datetime(),to:z.string().datetime(),bucket:z.string().regex(/^\d{4}-\d{2}(-\d{2}( \d{2}:00)?)?$/)}).parse(input);
 const timezone=(await query('SELECT timezone FROM business_settings LIMIT 1')).rows[0]?.timezone||'America/Chicago';
 const format=bucket.length===7?'YYYY-MM':bucket.length===10?'YYYY-MM-DD':'YYYY-MM-DD HH24:00';
 const bookings=await reportingQuery(`SELECT b.id,b.event_id,e.event_name AS label,b.total AS amount,b.created_at AS occurred_at FROM bookings b LEFT JOIN events e ON e.id=b.event_id
 WHERE b.created_at >= $1 AND b.created_at < $2 AND to_char(b.created_at AT TIME ZONE $3,$4)=$5 ORDER BY b.created_at,b.id`,[from,to,timezone,format,bucket]);
 const payments=await reportingQuery(`SELECT p.id,p.invoice_id,i.invoice_number AS label,(p.amount-p.refunded_amount) AS amount,COALESCE(p.paid_at,p.payment_date::timestamptz,p.created_at) AS occurred_at FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id
 WHERE COALESCE(p.paid_at,p.payment_date::timestamptz,p.created_at)>=$1 AND COALESCE(p.paid_at,p.payment_date::timestamptz,p.created_at)<$2 AND to_char(COALESCE(p.paid_at,p.payment_date::timestamptz,p.created_at) AT TIME ZONE $3,$4)=$5 AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY occurred_at,p.id`,[from,to,timezone,format,bucket]);
 return {bucket,bookings:bookings.rows,payments:payments.rows};
}
