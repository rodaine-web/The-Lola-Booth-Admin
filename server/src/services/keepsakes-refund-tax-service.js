import {query} from '../db/pool.js';
import {keepsakesStaging} from '../../../shared/keepsakes.js';
import {keepsakesStripe} from './keepsakes-service.js';
import {withKeepsakesOrderLock} from './keepsakes-order-lock.js';

// Provider accounting is reconciled separately from authoritative refund access
// revocation. Each completed reversal is durable before another is attempted.
export async function processKeepsakesTaxRefunds({limit=5}={}){
 if(!keepsakesStaging()||process.env.KEEPSAKES_FULFILLMENT_ENABLED!=='true')return [];
 if(!(await query("SELECT to_regclass('keepsakes_orders') name")).rows[0].name)return [];
 const rows=(await query("SELECT id FROM keepsakes_orders WHERE tax_refund_status='PENDING' AND refunded_cents>=total_cents AND paid_at IS NOT NULL ORDER BY updated_at LIMIT $1",[Math.max(1,Math.min(limit,10))])).rows,results=[];
 for(const row of rows)await withKeepsakesOrderLock(row.id,async()=>{
  const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1',[row.id])).rows[0];
  if(order.tax_refund_status!=='PENDING'||order.refunded_cents<order.total_cents)return;
  const transactions=order.tax_transactions?.length?order.tax_transactions:order.tax_transaction_id?[{index:0,id:order.tax_transaction_id}]:[],done=order.tax_reversals||[];
  try{
   for(const transaction of transactions){
    if(done.some(entry=>entry.index===transaction.index))continue;
    const suffix=transaction.index?`:${transaction.index}`:'';
    const reversal=await keepsakesStripe('tax/transactions/create_reversal',{mode:'full',original_transaction:transaction.id,reference:`keepsakes-refund:${order.id}${suffix}`},`keepsakes-tax-reversal:${order.id}${suffix}`);
    if(!reversal.id)throw Error('Incomplete tax reversal.');
    done.push({index:transaction.index,id:reversal.id});await query('UPDATE keepsakes_orders SET tax_reversals=$2 WHERE id=$1',[order.id,JSON.stringify(done)]);
   }
   await query("UPDATE keepsakes_orders SET tax_refund_status='COMPLETE' WHERE id=$1",[order.id]);results.push({id:order.id,status:'COMPLETE'});
  }catch(error){
   await query("UPDATE keepsakes_orders SET tax_refund_status='REQUIRES_REVIEW',last_error='Refund is confirmed; tax accounting requires review.' WHERE id=$1",[order.id]);
   await query("INSERT INTO keepsakes_events(order_id,action,details) VALUES($1,'tax_refund_requires_review',$2)",[order.id,JSON.stringify({code:error.code||'STRIPE_TAX_REVERSAL_ERROR'})]);results.push({id:order.id,status:'REQUIRES_REVIEW'});
  }
 });return results;
}
