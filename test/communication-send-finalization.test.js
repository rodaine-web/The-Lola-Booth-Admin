import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../server/src/db/pool.js';
import {env} from '../server/src/config/env.js';
import {sendCommunication} from '../server/src/services/automation-service.js';

test('accepted provider send with failed database finalization cannot be retried automatically',async t=>{
 const original=env.emailProvider;env.emailProvider='development';
 t.after(()=>{env.emailProvider=original;});
 let message={id:'synthetic',status:'DRAFT',channel:'EMAIL',recipient:'qa@example.invalid',subject:'Synthetic QA',rendered_body:'Synthetic QA'};
 const calls=[];
 const query=async(sql,args)=>{
   calls.push(sql);
   if(sql.startsWith('SELECT * FROM communications'))return {rows:[message]};
   if(sql.startsWith("UPDATE communications SET status='PROCESSING'")){message={...message,status:'PROCESSING'};return {rows:[message]};}
   if(sql.includes("SET status='SENT_TO_PROVIDER'"))throw Error('Synthetic database write failure');
   if(sql.includes("failure_code='DELIVERY_OUTCOME_UNKNOWN'"))message={...message,status:'FAILED',failure_code:'DELIVERY_OUTCOME_UNKNOWN'};
   return {rows:[],rowCount:0};
 };
 t.mock.method(pool,'query',query);
 t.mock.method(pool,'connect',async()=>({query,release(){}}));
 await assert.rejects(sendCommunication(message.id),e=>e.code==='DELIVERY_OUTCOME_UNKNOWN'&&e.details.retryable===false);
 assert.equal(message.failure_code,'DELIVERY_OUTCOME_UNKNOWN');
 await assert.rejects(sendCommunication(message.id),e=>e.code==='DELIVERY_OUTCOME_UNKNOWN');
 assert.equal(calls.filter(sql=>sql.includes("SET status='SENT_TO_PROVIDER'")).length,1);
});
test('paid reminder is cancelled before a provider request, including manual retries',async t=>{
 let message={id:'synthetic',status:'FAILED',channel:'EMAIL',trigger_key:'OVERDUE_BALANCE_REMINDER',invoice_id:'paid'};
 const query=async(sql)=>{
   if(sql.startsWith('SELECT * FROM communications'))return {rows:[message]};
   if(sql.startsWith("UPDATE communications SET status='CANCELLED'")){message={...message,status:'CANCELLED'};return {rows:[message]};}
   return {rows:[],rowCount:0};
 };
 t.mock.method(pool,'query',query);
 t.mock.method(pool,'connect',async()=>({query,release(){}}));
 const result=await sendCommunication(message.id);
 assert.equal(result.communication.status,'CANCELLED');
 assert.equal(result.delivery.suppressed,true);
});
