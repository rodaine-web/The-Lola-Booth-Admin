import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
const input=z.object({id:z.string().uuid().optional(),equipmentId:z.string().uuid(),bookingKind:z.enum(['STANDALONE','ADDON']),method:z.enum(['LOCAL','SHIPPING']),dispatchAt:z.string().datetime({offset:true}),expectedReturnAt:z.string().datetime({offset:true}),readyAt:z.string().datetime({offset:true}),returnShippingIncluded:z.boolean().default(false),notes:z.string().max(3000).default('')}).strict().refine(x=>Date.parse(x.dispatchAt)<Date.parse(x.expectedReturnAt)&&Date.parse(x.expectedReturnAt)<=Date.parse(x.readyAt),{message:'Dispatch must precede return; inspection-ready must follow return.'}).refine(x=>x.method!=='SHIPPING'||x.returnShippingIncluded,{message:'Shipping rentals must include return shipping.'});
export async function audioFulfillment(eventId){
 if(!(await query('SELECT id FROM events WHERE id=$1 AND deleted_at IS NULL',[eventId])).rowCount)throw notFound('Event');
 const [records,inventory,demand]=await Promise.all([query('SELECT f.*,e.name AS equipment_name,e.asset_uid FROM audio_guestbook_fulfillments f JOIN equipment e ON e.id=f.equipment_id WHERE f.event_id=$1 ORDER BY f.created_at DESC',[eventId]),query("SELECT id,name,status,asset_uid FROM equipment WHERE inventory_pool='AUDIO_GUESTBOOK' AND deleted_at IS NULL ORDER BY name"),query('SELECT event_requests_audio_guestbook($1) AS required',[eventId])]);
 return {records:records.rows,inventory:inventory.rows,required:demand.rows[0].required};
}
export async function saveAudioFulfillment(eventId,raw,req){
 const b=input.parse(raw);
 return transaction(async()=>{
  await query('SELECT pg_advisory_xact_lock(7811051)');
  const ev=(await query('SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[eventId])).rows[0];if(!ev)throw notFound('Event');if(['CANCELLED','COMPLETED'].includes(ev.status))throw new AppError('This event is closed.',409,'EVENT_CLOSED');
  const unit=(await query("SELECT * FROM equipment WHERE id=$1 AND inventory_pool='AUDIO_GUESTBOOK' AND deleted_at IS NULL AND status NOT IN ('MAINTENANCE','RETIRED') FOR UPDATE",[b.equipmentId])).rows[0];if(!unit)throw new AppError('Choose an available Audio Guestbook inventory unit.',422,'AUDIO_INVENTORY_INVALID');
  const previous=b.id?(await query("SELECT * FROM audio_guestbook_fulfillments WHERE id=$1 AND event_id=$2 FOR UPDATE",[b.id,eventId])).rows[0]:null;if(b.id&&!previous)throw notFound('Audio fulfillment');
  if(previous&&!['RESERVED','DISPATCHED','RETURNED'].includes(previous.status))throw new AppError('This reservation is closed. Create a new reservation if needed.',409,'AUDIO_STATE_CHANGED');
  if(previous&&previous.equipment_id!==b.equipmentId)throw new AppError('Cancel this unit reservation before choosing a different unit.',409,'AUDIO_UNIT_CHANGED');
  const values=[eventId,b.equipmentId,b.bookingKind,b.method,b.dispatchAt,b.expectedReturnAt,b.readyAt,b.returnShippingIncluded,b.notes,req.user.id];
  const row=previous?(await query('UPDATE audio_guestbook_fulfillments SET equipment_id=$2,booking_kind=$3,method=$4,dispatch_at=$5,expected_return_at=$6,ready_at=$7,return_shipping_included=$8,notes=$9,updated_by=$10,updated_at=now() WHERE event_id=$1 AND id=$11 RETURNING *',[...values,previous.id])).rows[0]:(await query('INSERT INTO audio_guestbook_fulfillments(event_id,equipment_id,booking_kind,method,dispatch_at,expected_return_at,ready_at,return_shipping_included,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *',values)).rows[0];
  await query("INSERT INTO equipment_assignments(event_id,equipment_id,assigned_by,lifecycle_status) SELECT $1,$2,$3,'RESERVED' WHERE NOT EXISTS(SELECT FROM equipment_assignments WHERE event_id=$1 AND equipment_id=$2 AND released_at IS NULL)",[eventId,row.equipment_id,req.user.id]);
  await writeAudit({req,action:'audio_fulfillment_reserved',entity:'event',entityId:eventId,before:previous,after:row});return row;
 });
}
export async function transitionAudioFulfillment(eventId,id,action,body,req){
 const b=z.object({inspected:z.boolean().optional(),notes:z.string().max(3000).default('')}).strict().parse(body);
 return transaction(async()=>{
  await query('SELECT pg_advisory_xact_lock(7811051)');
  const previous=(await query('SELECT * FROM audio_guestbook_fulfillments WHERE id=$1 AND event_id=$2 FOR UPDATE',[id,eventId])).rows[0];if(!previous)throw notFound('Audio fulfillment');
  const transition={dispatch:['RESERVED','DISPATCHED','dispatched_at'],return:['DISPATCHED','RETURNED','returned_at'],inspect:['RETURNED','READY','inspected_at'],cancel:['RESERVED','CANCELLED',null]}[action];if(!transition)throw new AppError('Unsupported fulfillment action.',422,'AUDIO_ACTION_INVALID');
  if(previous.status===transition[1])return previous;if(previous.status!==transition[0])throw new AppError('This rental changed. Reload its current state.',409,'AUDIO_STATE_CHANGED');
  if(action==='inspect'){
   if(!(await query("SELECT id FROM events WHERE id=$1 AND (status='CANCELLED' OR deleted_at IS NOT NULL OR upper(event_unavailable_range(id))<=clock_timestamp())",[eventId])).rowCount)throw new AppError('The event window has not ended. Cancel or reschedule the rental before releasing this unit.',409,'AUDIO_EVENT_NOT_FINISHED');
   if(!b.inspected)throw new AppError('Confirm the unit was returned and inspected before making it available.',422,'AUDIO_INSPECTION_REQUIRED');
   if((await query("SELECT status FROM equipment WHERE id=$1 AND status IN ('MAINTENANCE','RETIRED')",[previous.equipment_id])).rowCount)throw new AppError('Resolve this equipment’s maintenance status before releasing it.',409,'EQUIPMENT_MAINTENANCE');
  }
  if(action==='dispatch'&&!(await query("SELECT id FROM events WHERE id=$1 AND deleted_at IS NULL AND status NOT IN ('CANCELLED','COMPLETED')",[eventId])).rowCount)throw new AppError('This event is closed.',409,'EVENT_CLOSED');
  const row=(await query(`UPDATE audio_guestbook_fulfillments SET status=$3,${transition[2]?transition[2]+'=now(),':''}inspection_notes=CASE WHEN $3='READY' THEN $4 ELSE inspection_notes END,updated_by=$5,updated_at=now() WHERE id=$1 AND event_id=$2 RETURNING *`,[id,eventId,transition[1],b.notes,req.user.id])).rows[0];
  if(action==='dispatch')await query("UPDATE equipment_assignments SET lifecycle_status='CHECKED_OUT',checked_out_at=now(),checked_out_by=$3 WHERE event_id=$1 AND equipment_id=$2 AND released_at IS NULL",[eventId,row.equipment_id,req.user.id]);
  if(action==='return')await query("UPDATE equipment_assignments SET lifecycle_status='RETURNED',returned_at=now(),returned_by=$3 WHERE event_id=$1 AND equipment_id=$2 AND released_at IS NULL",[eventId,row.equipment_id,req.user.id]);
  if(['READY','CANCELLED'].includes(row.status))await query("UPDATE equipment_assignments SET released_at=now(),lifecycle_status=CASE WHEN $3='READY' THEN 'RETURNED' ELSE lifecycle_status END WHERE event_id=$1 AND equipment_id=$2 AND released_at IS NULL",[eventId,row.equipment_id,row.status]);
  await writeAudit({req,action:'audio_fulfillment_'+action,entity:'event',entityId:eventId,before:previous,after:row});return row;
 });
}

export async function syncAudioEquipmentLifecycle(assignment,action,user){
 if(!['checkout','return'].includes(action))return;
 const f=(await query("SELECT * FROM audio_guestbook_fulfillments WHERE event_id=$1 AND equipment_id=$2 AND status NOT IN ('READY','CANCELLED')",[assignment.event_id,assignment.equipment_id])).rows[0];if(!f)return;
 const status=action==='checkout'?'DISPATCHED':'RETURNED';
 if((action==='checkout'&&f.status!=='RESERVED')||(action==='return'&&f.status!=='DISPATCHED'))return;
 await query(`UPDATE audio_guestbook_fulfillments SET status=$2,${action==='checkout'?'dispatched_at':'returned_at'}=now(),updated_by=$3,updated_at=now() WHERE id=$1`,[f.id,status,user.id]);
}
