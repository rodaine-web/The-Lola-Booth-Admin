import {itemNetCents,itemRangeCents} from '../../../shared/keepsakes-discounts.js';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertKeepsakesManager,cancelKeepsakesOrder} from './keepsakes-admin-service.js';
import {keepsakesStripe} from './keepsakes-service.js';
import {withKeepsakesOrderLock} from './keepsakes-order-lock.js';
import {writeAudit} from './audit-service.js';
import {syncKeepsakesOrder} from './keepsakes-lifecycle-service.js';
import {remainingItemUnits} from '../../../shared/keepsakes-refunds.js';
const fail=(message,code='KEEPSAKES_ADJUSTMENT_REVIEW')=>{throw new AppError(message,409,code);};
const selection=z.object({scope:z.enum(['ORDER','ITEMS']),action:z.enum(['CANCEL','REFUND']),items:z.array(z.object({index:z.number().int().min(0),quantity:z.number().int().min(1).max(400)})).max(30).default([]),reason:z.string().trim().min(5).max(200)}).strict();
async function orderAndJobs(id){const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1',[id])).rows[0];if(!order)fail('Order unavailable.');const jobs=(await query('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 ORDER BY item_index,recipient_index,copy_index',[id])).rows;return {order,jobs};}
async function planItems(order,jobs,input){
 const selected=input.scope==='ORDER'?order.snapshot.items.map((item,index)=>({index,quantity:remainingItemUnits(item)})).filter(i=>i.quantity):input.items;
 if((!selected.length&&!(input.scope==='ORDER'&&order.item_refunds_managed))||new Set(selected.map(i=>i.index)).size!==selected.length)fail('Choose each item once and enter the quantity to remove.');
 const unsentProofs=new Set((await query("SELECT p.fulfillment_id FROM keepsakes_postcard_proofs p JOIN keepsakes_fulfillments f ON f.id=p.fulfillment_id WHERE f.order_id=$1 AND p.dispatch_state='PREPARED' AND p.dispatch_started_at IS NULL",[order.id])).rows.map(p=>p.fulfillment_id));
 const items=[];
 for(const chosen of selected){const item=order.snapshot.items[chosen.index],current=item&&remainingItemUnits(item);if(!item||chosen.quantity>current)fail('Item quantities changed. Review this order again.');
 const relevant=jobs.filter(j=>j.item_index===chosen.index&&j.status!=='CANCELLED');
 const covered=item.product.provider==='LOB'?relevant.slice(0,chosen.quantity):relevant;
 if(covered.some(j=>j.lease_until&&new Date(j.lease_until)>new Date()))fail('This item is being processed. Wait for its provider response before cancellation.');
 if(covered.some(j=>['LOB','PRODIGI','WHCC','GELATO'].includes(j.provider)&&j.attempts>0&&!j.provider_order_id&&!unsentProofs.has(j.id)&&!['KEEPSAKES_LOB_ARTWORK_SIZE','KEEPSAKES_LOB_FRONT_SPEC','KEEPSAKES_LOB_BACK_SPEC'].includes(j.last_error)))fail('The supplier request outcome is unresolved. Reconcile it before cancellation or refund.');
 if(covered.some(j=>j.provider_order_id&&!['DIGITAL','DIGITAL_EDIT','IN_HOUSE'].includes(j.provider)))fail('This item was submitted to its supplier. Review provider cancellation before issuing a refund.');
 if(covered.some(j=>['SHIPPED','COMPLETE'].includes(j.status))&&input.action==='CANCEL')fail('A shipped or completed item cannot be cancelled. Use refund after reviewing its delivery and return.');
 const labels=await query("SELECT 1 FROM keepsakes_shippo_labels WHERE order_id=$1 AND archived_at IS NULL AND status NOT IN('QUOTED','VOIDED','ERROR') AND parcel_index=ANY($2::int[]) LIMIT 1",[order.id,(order.snapshot.shipping?.parcels||[]).flatMap((p,index)=>p.itemIndices.includes(chosen.index)?[index]:[])]);
 if(labels.rowCount)fail('Review and void or reconcile the shipping label covering this item before cancelling or refunding it.','SHIPPO_CANCEL_REVIEW');
 items.push({...chosen,previousCancelled:item.cancelledUnits||0,unitCents:item.product.retailCents,amountCents:itemRangeCents(item,item.cancelledUnits||0,chosen.quantity),jobIds:covered.map(j=>j.id)});
 }return items;
}
async function taxPlan(order,items,jobs,whole){
 if(!order.tax_cents&&!order.tax_transactions?.length&&!order.tax_transaction_id)return {tax:0,plans:[]};
 const plans=[];let tax=0;
 if(order.snapshot.taxAtCheckout){
 const lines=await keepsakesStripe(`checkout/sessions/${order.stripe_session_id}/line_items?limit=100`);if(lines.has_more||lines.data?.length!==order.snapshot.items.length)fail('The digital tax lines need accounting review.');
 for(const chosen of items){const line=lines.data[chosen.index],original=order.snapshot.items[chosen.index];if(line.amount_subtotal!==itemNetCents(original)||!Number.isSafeInteger(line.amount_tax))fail('The original digital tax allocation could not be verified.');const net=itemNetCents(original);if(!net&&line.amount_tax)fail('A zero-price digital item has inconsistent tax.');tax+=net?Math.floor(line.amount_tax*itemRangeCents(original,0,chosen.previousCancelled+chosen.quantity)/net)-Math.floor(line.amount_tax*itemRangeCents(original,0,chosen.previousCancelled)/net):0;}
 return {tax,plans:[]}; // Checkout automatic tax manages its own refund accounting.
 }
 const transactions=order.tax_transactions?.length?order.tax_transactions:order.tax_transaction_id?[{index:0,id:order.tax_transaction_id}]:[];
 if(!transactions.length&&order.tax_cents)fail('Tax recording is still preparing. Refresh the order before requesting this refund.');
 let allocated=0;
 for(const tx of transactions){const lines=await keepsakesStripe(`tax/transactions/${tx.id}/line_items?limit=100`);if(lines.has_more||!Array.isArray(lines.data))fail('The original tax lines need accounting review.');const reversals=[];
 for(const line of lines.data){const [index,recipient]=String(line.reference).split(':').map(Number),chosen=items.find(i=>i.index===index);if(!chosen)continue;const original=order.snapshot.items[index];let count=chosen.quantity,previous=chosen.previousCancelled,total=original.units,offset=0;
 if(original.product.provider==='LOB'){const selectedJobs=jobs.filter(j=>chosen.jobIds.includes(j.id)&&j.recipient_index===recipient);count=selectedJobs.length;previous=jobs.filter(j=>j.item_index===index&&j.recipient_index===recipient&&j.status==='CANCELLED').length;total=original.quantity;offset=recipient*original.quantity;}
 if(!count)continue;const lineAmount=itemRangeCents(original,offset,total),before=itemRangeCents(original,offset,previous),after=itemRangeCents(original,offset,previous+count),amount=after-before;if(line.amount!==lineAmount||!Number.isSafeInteger(line.amount_tax))fail('The original item tax allocation could not be verified.');
 const amountTax=lineAmount?Math.floor(line.amount_tax*after/lineAmount)-Math.floor(line.amount_tax*before/lineAmount):0;tax+=amountTax;allocated+=amount;if(amount||amountTax)reversals.push({original_line_item:line.id,reference:`item-${index}-${line.id}`,amount:-amount,amount_tax:-amountTax});
 }
 let shipping;
 if(whole&&order.shipping_cents){const original=await keepsakesStripe(`tax/transactions/${tx.id}`);if(original.shipping_cost?.amount){if(!Number.isSafeInteger(original.shipping_cost.amount_tax))fail('Shipping tax could not be verified.');shipping={amount:-original.shipping_cost.amount,amount_tax:-original.shipping_cost.amount_tax};tax+=original.shipping_cost.amount_tax;}}
 if(reversals.length||shipping)plans.push({transaction:tx.id,lines:reversals,...(shipping?{shipping}:{})});
 }
 if(allocated!==items.reduce((sum,i)=>sum+i.amountCents,0)&&order.tax_cents)fail('Some item taxes could not be matched. Review accounting before refunding.');
 if(whole&&order.shipping_cents){
 // Full-order requests after prior item refunds retain the exact remaining total.
 // Shipping tax is not guessed: operator accounting review is required if any is unallocated.
 const previously=(await query("SELECT coalesce(sum(tax_cents),0)::int tax FROM keepsakes_adjustments WHERE order_id=$1 AND status='SUCCEEDED'",[order.id])).rows[0].tax;
 if(tax+previously!==order.tax_cents)fail('The remaining shipping tax needs accounting review before a whole-order refund. Select the product quantities or review accounting.');
 }
 return {tax,plans};
}
export async function previewKeepsakesAdjustment(id,raw,user){assertKeepsakesManager(user);const input=selection.parse(raw);return withKeepsakesOrderLock(id,async()=>{
 const {order,jobs}=await orderAndJobs(id);
 if(['CANCELLED','REFUNDED','REFUND_PENDING'].includes(order.status))fail('This order is already closed or awaiting a refund.');
 if((await query("SELECT 1 FROM keepsakes_adjustments WHERE order_id=$1 AND status IN('PROCESSING','PENDING','REQUIRES_REVIEW') LIMIT 1",[id])).rowCount)fail('Reconcile the existing refund request before creating another.');
 const items=await planItems(order,jobs,input);
 if(!order.paid_at&&input.scope==='ITEMS')fail('An unpaid checkout must be cancelled as a whole before a new checkout can be created.');
 if(!order.paid_at&&input.action==='REFUND')fail('There is no payment to refund.');
 const legacyWhole=input.scope==='ORDER'&&!order.item_refunds_managed;
 const taxes=order.paid_at&&!legacyWhole?await taxPlan(order,items,jobs,input.scope==='ORDER'):{tax:order.tax_cents,plans:[]};
 const amount=order.paid_at?(input.scope==='ORDER'?order.total_cents-order.refunded_cents:items.reduce((n,i)=>n+i.amountCents,0)+taxes.tax):0;
 if(amount<0||amount>order.total_cents-order.refunded_cents)fail('The refundable total changed. Refresh this order.');
 const row=(await query('INSERT INTO keepsakes_adjustments(order_id,action,scope,items,amount_cents,tax_cents,reason,tax_plan,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,input.action,input.scope,JSON.stringify(items),amount,taxes.tax,input.reason,JSON.stringify(taxes.plans),user.id])).rows[0];
 return {id:row.id,action:input.action,scope:input.scope,amountCents:amount,taxCents:taxes.tax,shippingCents:input.scope==='ORDER'?order.shipping_cents:0,paid:!!order.paid_at,items:items.map(i=>({index:i.index,title:order.snapshot.items[i.index].product.title,quantity:i.quantity,amountCents:i.amountCents})),message:order.paid_at?'The selected quantities will be stopped and the displayed amount refunded. Other items remain active.':'The unpaid checkout will be cancelled.'};
 });}
export async function executeKeepsakesAdjustment(id,adjustmentId,raw,user){assertKeepsakesManager(user);z.object({confirmed:z.literal(true)}).strict().parse(raw);
 const initial=(await query('SELECT * FROM keepsakes_adjustments WHERE id=$1 AND order_id=$2',[adjustmentId,id])).rows[0];if(!initial)fail('Refund preview unavailable.');
 // The established whole-order provider cancellation path keeps its existing safeguards.
 const prior=(await query('SELECT item_refunds_managed,status FROM keepsakes_orders WHERE id=$1',[id])).rows[0];
 if(initial.status==='DRAFT'&&['CANCELLED','REFUNDED','REFUND_PENDING'].includes(prior.status))fail('The order changed after this preview. Review its existing cancellation or refund.');
 if(['PROCESSING','REQUIRES_REVIEW'].includes(initial.status)&&!initial.stripe_refund_id&&Date.now()-new Date(initial.created_at).getTime()>23*3600000)fail('Reconcile the older refund outcome in Stripe before trying again.');
 if(initial.scope==='ORDER'&&!prior.item_refunds_managed){
 if(initial.status==='SUCCEEDED')return {requested:true};
 await query("UPDATE keepsakes_adjustments SET status='PROCESSING',updated_at=now() WHERE id=$1",[adjustmentId]);
 try{const result=await cancelKeepsakesOrder(id,user,{refund:initial.amount_cents>0,reason:initial.reason});const refunded=(await query('SELECT stripe_refund_id FROM keepsakes_orders WHERE id=$1',[id])).rows[0];await query("UPDATE keepsakes_adjustments SET status=$2,stripe_refund_id=$3,last_error=NULL,updated_at=now() WHERE id=$1",[adjustmentId,initial.amount_cents?'PENDING':'SUCCEEDED',refunded.stripe_refund_id]);return result;}
 catch(error){await query("UPDATE keepsakes_adjustments SET status='REQUIRES_REVIEW',last_error=$2,updated_at=now() WHERE id=$1",[adjustmentId,error.code||'REFUND_OUTCOME_UNKNOWN']);throw error;}
 }

 return withKeepsakesOrderLock(id,async()=>{
 const adjustment=(await query('SELECT * FROM keepsakes_adjustments WHERE id=$1 AND order_id=$2',[adjustmentId,id])).rows[0];if(adjustment.status==='SUCCEEDED')return {requested:true,status:adjustment.status};
 const {order,jobs}=await orderAndJobs(id);
 if(adjustment.status!=='DRAFT'&&!adjustment.stripe_refund_id&&Date.now()-new Date(adjustment.created_at).getTime()>23*3600000)fail('The refund outcome must be reconciled with Stripe before retrying this older request.');
 if(adjustment.status==='DRAFT'){
  if(Date.now()-new Date(adjustment.created_at).getTime()>15*60000)fail('This refund preview expired. Review the amount again.');
  const current=await planItems(order,jobs,{...adjustment,items:adjustment.items});if(current.some((i,n)=>i.previousCancelled!==adjustment.items[n].previousCancelled))fail('Item quantities changed. Create a new preview.');
  await transaction(async()=>{await query("UPDATE keepsakes_adjustments SET status='PROCESSING',updated_at=now() WHERE id=$1",[adjustmentId]);
   for(const chosen of adjustment.items){const item=order.snapshot.items[chosen.index];item.cancelledUnits=(item.cancelledUnits||0)+chosen.quantity;const full=item.cancelledUnits===item.units;
    if(item.product.provider==='IN_HOUSE'&&item.inventoryReserved!==false&&jobs.filter(j=>chosen.jobIds.includes(j.id)).every(j=>['AWAITING_PRODUCTION','QUEUED','RETRY'].includes(j.status)))await query("UPDATE keepsakes_products SET operational_config=jsonb_set(operational_config,'{stockUnits}',to_jsonb((operational_config->>'stockUnits')::integer+$2)) WHERE id=$1 AND operational_config->>'stockUnits' IS NOT NULL",[item.product.id,chosen.quantity]);
    if(full||item.product.provider==='LOB')await query("UPDATE keepsakes_fulfillments SET status='CANCELLED',lease_until=NULL,updated_at=now() WHERE id=ANY($1::uuid[])",[chosen.jobIds]);
    if(full&&['DIGITAL','DIGITAL_EDIT'].includes(item.product.provider))await query('UPDATE keepsakes_edit_outputs SET revoked_at=now() WHERE fulfillment_id=ANY($1::uuid[])',[chosen.jobIds]);
   }
   const activeAssets=order.snapshot.items.filter(i=>remainingItemUnits(i)>0&&i.product.provider==='DIGITAL').flatMap(i=>i.assets.map(a=>a.mediaId));await query('UPDATE keepsakes_entitlements SET revoked_at=now() WHERE order_id=$1 AND NOT(media_id=ANY($2::uuid[]))',[id,activeAssets]);
   await query('UPDATE keepsakes_orders SET snapshot=$2,item_refunds_managed=true,updated_at=now() WHERE id=$1',[id,JSON.stringify(order.snapshot)]);await query('UPDATE keepsakes_adjustments SET applied_at=now() WHERE id=$1',[adjustmentId]);
   await writeAudit({req:{user},action:'keepsakes_item_cancellation_requested',entity:'keepsakes',entityId:id,after:{adjustmentId,items:adjustment.items.map(i=>({index:i.index,quantity:i.quantity})),amountCents:adjustment.amount_cents,reason:adjustment.reason}});
  });
 }
 if(adjustment.amount_cents===0){await query("UPDATE keepsakes_adjustments SET status='SUCCEEDED',last_error=NULL,updated_at=now() WHERE id=$1",[adjustmentId]);await reconcileManagedRefundTotals(id);await syncKeepsakesOrder(id);return {requested:true,status:'SUCCEEDED',amountCents:0};}
 try{
  let result=adjustment.stripe_refund_id?await keepsakesStripe(`refunds/${adjustment.stripe_refund_id}`):await keepsakesStripe('refunds',{payment_intent:order.stripe_payment_intent,amount:String(adjustment.amount_cents),reason:'requested_by_customer','metadata[keepsakes_order_id]':id,'metadata[keepsakes_adjustment_id]':adjustmentId},`keepsakes-item-refund:${adjustmentId}`);
  if(!result.id||result.amount!==adjustment.amount_cents||result.payment_intent!==order.stripe_payment_intent||result.currency!=='usd'||!['succeeded','pending','requires_action','failed','canceled'].includes(result.status))fail('The refund response requires reconciliation.');
  await query('UPDATE keepsakes_adjustments SET stripe_refund_id=$2,status=$3,last_error=NULL,updated_at=now() WHERE id=$1',[adjustmentId,result.id,result.status==='succeeded'?'SUCCEEDED':['failed','canceled'].includes(result.status)?'REQUIRES_REVIEW':'PENDING']);
  await writeAudit({req:{user},action:'keepsakes_item_refund_result',entity:'keepsakes',entityId:id,after:{adjustmentId,refundId:result.id,status:result.status,amountCents:result.amount}});
  if(result.status==='succeeded')await reconcileManagedRefundTotals(id);
  await syncKeepsakesOrder(id);return {requested:true,status:result.status,amountCents:result.amount};
 }catch(error){await query("UPDATE keepsakes_adjustments SET status='REQUIRES_REVIEW',last_error=$2,updated_at=now() WHERE id=$1",[adjustmentId,error.code||'REFUND_OUTCOME_UNKNOWN']);throw new AppError('The selected items are stopped. The refund needs reconciliation; retry this same request rather than creating another.',409,'KEEPSAKES_ADJUSTMENT_RECONCILE');}
 });}
export async function reconcileManagedRefundTotals(id){
 const total=(await query("SELECT coalesce(sum(amount_cents),0)::int cents FROM keepsakes_adjustments WHERE order_id=$1 AND status='SUCCEEDED'",[id])).rows[0].cents;
 const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1',[id])).rows[0];
 await query("UPDATE keepsakes_orders SET refunded_cents=GREATEST(refunded_cents,$2),status=CASE WHEN $2>=total_cents THEN 'REFUNDED' ELSE status END,updated_at=now() WHERE id=$1",[id,total]);
 return {total,order};
}
export async function processItemRefundTax(){
 const rows=(await query("SELECT * FROM keepsakes_adjustments WHERE status='SUCCEEDED' AND jsonb_array_length(tax_plan)>jsonb_array_length(tax_reversals) ORDER BY updated_at LIMIT 10")).rows;
 for(const row of rows)await withKeepsakesOrderLock(row.order_id,async()=>{const current=(await query('SELECT * FROM keepsakes_adjustments WHERE id=$1',[row.id])).rows[0],done=current.tax_reversals;
 try{for(const [index,plan]of current.tax_plan.entries()){if(done.some(d=>d.index===index))continue;const body={mode:'partial',original_transaction:plan.transaction,reference:`keepsakes-items:${row.id}:${index}`};if(plan.shipping)for(const [key,value]of Object.entries(plan.shipping))body[`shipping_cost[${key}]`]=String(value);plan.lines.forEach((line,n)=>{for(const [key,value]of Object.entries(line))body[`line_items[${n}][${key}]`]=String(value);});const reversed=await keepsakesStripe('tax/transactions/create_reversal',body,`keepsakes-item-tax:${row.id}:${index}`);if(!reversed.id)fail('Tax reversal needs review.');done.push({index,id:reversed.id});await query('UPDATE keepsakes_adjustments SET tax_reversals=$2,last_error=NULL WHERE id=$1',[row.id,JSON.stringify(done)]);}}
 catch{await query("UPDATE keepsakes_adjustments SET last_error='Refund confirmed; tax accounting needs review.' WHERE id=$1",[row.id]);}
 });
}

export async function handleManagedRefundEvent(order,refund){
 const row=(await query('SELECT * FROM keepsakes_adjustments WHERE id=$1 AND order_id=$2',[refund.metadata.keepsakes_adjustment_id,order.id])).rows[0];
 if(!row||row.stripe_refund_id&&row.stripe_refund_id!==refund.id||row.amount_cents!==refund.amount||refund.currency!=='usd')fail('Refund allocation does not match this order.');
 if(row.status==='SUCCEEDED')return;
 const status=refund.status==='succeeded'?'SUCCEEDED':['failed','canceled'].includes(refund.status)?'REQUIRES_REVIEW':'PENDING';
 await query('UPDATE keepsakes_adjustments SET stripe_refund_id=$2,status=$3,updated_at=now() WHERE id=$1',[row.id,refund.id,status]);
 if(status==='SUCCEEDED')await reconcileManagedRefundTotals(order.id);
}
export async function handleManagedChargeRefund(order,charge){
 for(const refund of charge.refunds?.data||[])if(refund.metadata?.keepsakes_adjustment_id)await handleManagedRefundEvent(order,refund);
 const known=(await query("SELECT coalesce(sum(amount_cents),0)::int cents FROM keepsakes_adjustments WHERE order_id=$1 AND status='SUCCEEDED'",[order.id])).rows[0].cents;
 if(charge.amount_refunded>known)return false;
 await query('UPDATE keepsakes_orders SET refunded_cents=GREATEST(refunded_cents,$2) WHERE id=$1',[order.id,charge.amount_refunded]);return true;
}
