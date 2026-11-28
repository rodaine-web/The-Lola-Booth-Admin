import {refundedOrderHold,remainingItemUnits} from '../../../shared/keepsakes-refunds.js';
import {query,transaction} from '../db/pool.js';
import {createNotification} from './notification-service.js';

// Call under the caller's order lock when advancing a job. Row locking also
// serializes worker reconciliation; no external provider calls occur here.
export async function syncKeepsakesOrder(orderId){
 return transaction(async()=>{
  const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!order?.paid_at||refundedOrderHold(order)||['CANCELLED','REFUNDED','REFUND_PENDING'].includes(order.status))return;
  if(order.status==='REQUIRES_REVIEW'&&/dispute|refund|payment/i.test(order.last_error||''))return;
  const jobs=(await query("SELECT provider,status,last_error FROM keepsakes_fulfillments WHERE order_id=$1 AND status<>'CANCELLED'",[orderId])).rows;
  const physical=jobs.filter(j=>j.provider==='IN_HOUSE');
  const all=(rows,states)=>rows.length>0&&rows.every(j=>states.includes(j.status));
  const fulfilled=all(physical,['FULFILLED','SHIPPED','COMPLETE']);
  const shipped=all(physical,['SHIPPED','COMPLETE']),delivered=all(physical,['COMPLETE']);
  const status=jobs.some(j=>j.status==='REQUIRES_REVIEW')?'REQUIRES_REVIEW':all(jobs,['COMPLETE'])?'COMPLETE':all(jobs,['SHIPPED','COMPLETE'])?'SHIPPED':all(jobs,['FULFILLED','SHIPPED','COMPLETE'])?'FULFILLED':jobs.length?(order.status==='PAID'&&jobs.every(j=>j.status==='QUEUED')?'PAID':'FULFILLING'):order.status;
  await query(`UPDATE keepsakes_orders SET status=$2,last_error=CASE WHEN $2='REQUIRES_REVIEW' THEN $6 ELSE CASE WHEN tax_refund_status='REQUIRES_REVIEW' THEN last_error ELSE NULL END END,fulfilled_at=CASE WHEN $3 THEN COALESCE(fulfilled_at,now()) ELSE fulfilled_at END,
   shipped_at=CASE WHEN $4 THEN COALESCE(shipped_at,now()) ELSE shipped_at END,
   delivered_at=CASE WHEN $5 THEN COALESCE(delivered_at,now()) ELSE delivered_at END,updated_at=CASE WHEN status<>$2 THEN now() ELSE updated_at END WHERE id=$1`,[orderId,status,fulfilled,shipped,delivered,jobs.find(j=>j.status==='REQUIRES_REVIEW')?.last_error||order.last_error]);
  for(const kind of ['CONFIRMATION',...(shipped?['SHIPPED']:[]),...(delivered?['DELIVERED']:[])]){
   const inserted=await query('INSERT INTO keepsakes_order_milestones(order_id,kind) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING kind',[orderId,kind]);
   if(!inserted.rowCount)continue;
   await query('INSERT INTO keepsakes_events(order_id,action,provider_event_id,details) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[orderId,'order_'+kind.toLowerCase(),`milestone:${orderId}:${kind}`,{message:kind==='DELIVERED'?'All in-house items have confirmed delivery.':kind==='SHIPPED'?'All in-house items have been dispatched.':'Payment received; order ready for fulfillment.'}]);
   await createNotification({roleTarget:'OWNER_ADMIN',category:'EVENTS',title:kind==='CONFIRMATION'?'New Keepsakes order':kind==='SHIPPED'?'Keepsakes order shipped':'Keepsakes order delivered',body:`Order ${orderId.slice(0,8).toUpperCase()} · ${kind==='CONFIRMATION'?'Paid and awaiting fulfillment':kind==='SHIPPED'?'Shipment dispatched':'Delivery confirmed'}`,entityType:'keepsakes_order',entityId:orderId,actionUrl:`/sales/keepsakes?tab=orders&order=${orderId}`,metadata:{milestone:kind}});
  }
  return {status};
 });
}
