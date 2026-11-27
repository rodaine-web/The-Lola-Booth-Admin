import {refundedOrderHold} from './keepsakes-refunds.js';
export const orderLane=provider=>['DIGITAL','DIGITAL_EDIT'].includes(provider)?'DIGITAL':provider==='IN_HOUSE'?'IN_HOUSE':'INTEGRATION';
export const activeOrderJobs=jobs=>jobs.filter(j=>j.status!=='CANCELLED');
export function orderHasGlobalHold(order,jobs=[]){return !order?.paid_at||['CANCELLED','REFUNDED','REFUND_PENDING'].includes(order.status)||refundedOrderHold(order)||order.status==='REQUIRES_REVIEW'&&(!jobs.length||/dispute|refund|payment/i.test(order.last_error||''));}
export function keepsakesOrderStage(order,jobs=[]){
 const stages={
  CONFIRM:{index:0,title:'Confirm in-house items',description:'Review the in-house artwork and delivery details. Digital and provider items are processed separately.'},
  FULFILL:{index:1,title:'Fulfill the items',description:'Download the print files, produce the keepsakes and pack everything in the order.'},
  SHIP:{index:2,title:'Ship this order',description:'Create the label for the package, then confirm carrier handoff. Everything stays together here.'},
  DELIVERY:{index:3,title:'Your order is on its way',description:'The customer has been notified. Follow this shipment through delivery.'},
  COMPLETE:{index:3,title:'In-house items delivered',description:'All items in this order are complete.'},
  PREPARING:{index:0,title:'Preparing print files',description:'Payment is confirmed. The print files are being prepared; this page updates automatically.'},
  REVIEW:{index:0,title:'This order needs review',description:'Review the order history and any reported issue before continuing. No production or shipment action will be taken automatically.'},
  PAYMENT:{index:0,title:'Awaiting payment',description:'Payment must be confirmed before this order can be fulfilled.'},
  EXTERNAL:{index:1,title:'Work is in progress',description:'Digital editing or supplier items are handled by their own fulfillment workflow.'}
 };
 let key;
 const physical=jobs.filter(j=>j.provider==='IN_HOUSE'),all=states=>physical.length&&physical.every(j=>states.includes(j.status));
 jobs=activeOrderJobs(jobs);
 if(!order?.paid_at)key='PAYMENT';
 else if(refundedOrderHold(order)||['CANCELLED','REFUNDED','REFUND_PENDING'].includes(order.status)||order.status==='REQUIRES_REVIEW'&&!jobs.length||jobs.some(j=>j.status==='REQUIRES_REVIEW'))key='REVIEW';
 else if(jobs.length&&jobs.every(j=>j.status==='COMPLETE'))key='COMPLETE';
 else if(!physical.length)key=jobs.length?'EXTERNAL':'PREPARING';
 else if(all(['SHIPPED','COMPLETE']))key='DELIVERY';
 else if(all(['FULFILLED','SHIPPED','COMPLETE']))key='SHIP';
 else if(physical.some(j=>['QUEUED','RETRY','PROCESSING'].includes(j.status)))key='PREPARING';
 else if(physical.some(j=>j.status==='AWAITING_PRODUCTION'))key='CONFIRM';
 else key='FULFILL';
 return {key,...stages[key],...(key==='COMPLETE'&&!physical.length?{title:'Order complete'}:{})};
}
