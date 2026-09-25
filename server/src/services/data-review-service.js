import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {writeAudit} from './audit-service.js';
import {AppError} from '../utils/errors.js';
const types={leads:{label:"concat_ws(' ',first_name,last_name)",permission:'write:sales'},clients:{label:'name',permission:'write:sales'},events:{label:'event_name',permission:'write:events'},bookings:{label:"'Booking'",permission:'write:events'},proposals:{label:"COALESCE(proposal_number,proposal_title,'Legacy proposal')",permission:'write:sales'},invoices:{label:"COALESCE(invoice_number,'Legacy invoice')",permission:'write:finance'},payments:{label:"COALESCE(reference_number,provider||' payment')",permission:'write:finance'},tasks:{label:'title',permission:'write:tasks'}};
export async function reviewData(input={},user){
 const type=z.enum(Object.keys(types)).parse(input.type||'leads'),page=Math.max(1,Math.min(10000,Number(input.page)||1));
 if(user&&!user.permissions.includes('*')&&!user.permissions.includes(types[type].permission.replace('write:','read:')))throw new AppError('You cannot review this record type.',403,'CLASSIFICATION_FORBIDDEN');
 const filter=input.scope==='all'?'TRUE':"data_classification='UNREVIEWED'";
 const rows=await query(`SELECT id,${types[type].label} AS label,data_classification,created_at FROM ${type} WHERE deleted_at IS NULL AND ${filter} ORDER BY created_at DESC,id LIMIT 50 OFFSET $1`,[(page-1)*50]);
 const count=(await query(`SELECT count(*)::int total FROM ${type} WHERE deleted_at IS NULL AND ${filter}`)).rows[0].total;
 return {data:rows.rows,type,pagination:{page,pageSize:50,total:count}};
}
export async function classifyData(req){
 const type=z.enum(Object.keys(types)).parse(req.params.type),id=z.string().uuid().parse(req.params.id);
 if(!req.user.permissions.includes('*')&&!req.user.permissions.includes(types[type].permission))throw new AppError('You cannot classify this type of business record.',403,'CLASSIFICATION_FORBIDDEN');
 const body=z.object({classification:z.enum(['BUSINESS','UNREVIEWED','QA','SEED','LEGACY_FIXTURE']),reason:z.string().trim().min(10).max(500)}).parse(req.body);
 return transaction(async client=>{
  const before=(await client.query(`SELECT id,data_classification FROM ${type} WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[id])).rows[0];if(!before)throw new AppError('Record not found.',404,'NOT_FOUND');
  const after=(await client.query(`UPDATE ${type} SET data_classification=$1 WHERE id=$2 RETURNING id,data_classification`,[body.classification,id])).rows[0];
  await writeAudit({req,action:'data_classification_changed',entity:type,entityId:id,before,after:{...after,review_reason:body.reason}});
  return after;
 });
}
