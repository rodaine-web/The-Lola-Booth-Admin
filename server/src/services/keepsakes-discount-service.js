import {z} from 'zod';
import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertKeepsakes} from './keepsakes-service.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
import {writeAudit} from './audit-service.js';
const code=z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/);
const input=z.object({code,kind:z.enum(['PERCENT','AMOUNT']),value:z.number().int().min(1).max(1000000),minimumCents:z.number().int().min(0).max(10000000).default(0),expiresAt:z.iso.datetime().nullable().default(null)}).strict().refine(v=>v.kind!=='PERCENT'||v.value<=10000,'Percentage must be at most 100%.');
const invalid=()=>new AppError('This discount code is unavailable or does not apply to your order.',422,'KEEPSAKES_DISCOUNT_INVALID');
export async function resolveKeepsakesDiscount(raw,subtotal,{lock=false}={}){
 if(!raw)return null;const parsed=code.safeParse(raw);if(!parsed.success)throw invalid();
 const row=(await query('SELECT * FROM keepsakes_discounts WHERE code=$1'+(lock?' FOR SHARE':''),[parsed.data])).rows[0];
 if(!row?.active||row.expires_at&&new Date(row.expires_at)<=new Date()||subtotal<row.minimum_cents)throw invalid();
 const cents=row.kind==='PERCENT'?Math.floor(subtotal*row.value/10000):Math.min(row.value,subtotal);
 if(cents<1||subtotal-cents<50)throw new AppError('This code requires at least $0.50 of merchandise remaining after the discount.',422,'KEEPSAKES_DISCOUNT_MINIMUM');
 return {id:row.id,code:row.code,kind:row.kind,value:row.value,cents,configurationVersion:new Date(row.updated_at).toISOString()};
}
export async function listKeepsakesDiscounts(user){assertKeepsakes();assertKeepsakesManager(user);return {discounts:(await query('SELECT * FROM keepsakes_discounts ORDER BY created_at DESC LIMIT 200')).rows};}
export async function createKeepsakesDiscount(raw,user){assertKeepsakes();assertKeepsakesManager(user);const v=input.parse(raw);if((await query('SELECT 1 FROM keepsakes_discounts WHERE code=$1',[v.code])).rowCount)throw new AppError('This code already exists. Choose a different code.',409,'KEEPSAKES_DISCOUNT_EXISTS');const row=(await query('INSERT INTO keepsakes_discounts(code,kind,value,minimum_cents,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[v.code,v.kind,v.value,v.minimumCents,v.expiresAt,user.id])).rows[0];await writeAudit({req:{user},action:'keepsakes_discount_created',entity:'keepsakes_discount',entityId:row.id,after:v});return row;}
export async function toggleKeepsakesDiscount(id,raw,user){assertKeepsakes();assertKeepsakesManager(user);const v=z.object({active:z.boolean()}).strict().parse(raw),row=(await query('UPDATE keepsakes_discounts SET active=$2,updated_at=now() WHERE id=$1 RETURNING id',[id,v.active])).rows[0];if(!row)throw invalid();await writeAudit({req:{user},action:'keepsakes_discount_updated',entity:'keepsakes_discount',entityId:id,after:v});return {saved:true};}
