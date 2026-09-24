import crypto from 'node:crypto';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {notFound,AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
const schemas={
 equipment:z.object({name:z.string().trim().min(1),category:z.string().trim().min(1),asset_uid:z.string().trim().min(1).optional(),serial_number:z.string().nullable().optional(),status:z.enum(['AVAILABLE','RESERVED','IN_USE','MAINTENANCE','RETIRED']).default('AVAILABLE')}),
 staff:z.object({name:z.string().trim().min(1),email:z.string().email().nullable().optional(),phone:z.string().nullable().optional(),role:z.string().trim().min(1).default('ATTENDANT'),active:z.boolean().default(true),notes:z.string().nullable().optional(),user_id:z.string().uuid().nullable().optional(),availability:z.object({unavailable_dates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([])}).optional()})
};
const tables={equipment:'equipment',staff:'staff_profiles'};
export async function saveRoster(kind,req){
 const table=tables[kind];if(!table)throw notFound('Resource');
 const data=(req.params.id?schemas[kind].partial():schemas[kind]).parse(req.body);
 if(data.availability)data.availability=JSON.stringify(data.availability);
 if(!req.params.id&&kind==='equipment'){data.asset_uid ||= `LB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;data.qr_token=crypto.randomBytes(24).toString('hex');}
 const result=await transaction(async client=>{
  let before=null;if(req.params.id){before=(await client.query(`SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[req.params.id])).rows[0];if(!before)throw notFound(kind);}
  if(!Object.keys(data).length)throw new AppError('No changes supplied.',422,'EMPTY_PATCH');
  const keys=Object.keys(data),values=Object.values(data);
  const sql=before?`UPDATE ${table} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_at=now() WHERE id=$${values.length+1} RETURNING *`:`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`;
  const after=(await client.query(sql,before?[...values,req.params.id]:values)).rows[0];return {before,after};
 });
 await writeAudit({req,action:`${kind}_${result.before?'updated':'created'}`,entity:kind,entityId:result.after.id,...result});return result.after;
}
export async function rosterDetail(kind,id){
 const table=tables[kind],assignment=kind==='staff'?'staff_assignments':'equipment_assignments',fk=kind==='staff'?'staff_profile_id':'equipment_id';
 const row=(await query(`SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL`,[id])).rows[0];if(!row)throw notFound(kind);
 const assignments=await query(`SELECT a.*,e.event_name,e.event_date,e.start_time,e.end_time FROM ${assignment} a JOIN events e ON e.id=a.event_id WHERE a.${fk}=$1 ORDER BY e.event_date DESC`,[id]);
 const history=await query('SELECT a.action,a.created_at,u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity_id=$1 ORDER BY a.created_at DESC LIMIT 50',[id]);
 return {...row,assignments:assignments.rows,history:history.rows};
}
