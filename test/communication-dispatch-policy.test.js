import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchDecision,scheduledRetry} from '../server/src/services/communication-dispatch-policy.js';
const message={campaign_recipient_id:'recipient'};
const db=(recipient,contact)=>({query:async(sql)=>({rows:sql.includes('FROM campaign_recipients')?[recipient].filter(Boolean):[contact].filter(Boolean),rowCount:contact?1:0})});
test('campaign final dispatch blocks cancellation, archive, unsubscribe, suppression and missing recipients',async()=>{
 for(const patch of [{campaign_status:'CANCELLED'},{campaign_status:'ARCHIVED'},{unsubscribed_at:new Date()},{suppressed:true}]){
   assert.equal(await dispatchDecision(db({campaign_status:'SENDING',...patch}),message),'CANCELLED');
 }
 assert.equal(await dispatchDecision(db(null),message),'CANCELLED');
 assert.equal(await dispatchDecision(db({campaign_status:'SENDING'}),message),'SEND');
});
test('pause after worker claim returns to queue instead of sending or becoming failed',async()=>{
 await assert.rejects(dispatchDecision(db({campaign_status:'PAUSED'}),message),e=>e.code==='CAMPAIGN_PAUSED');
});
test('campaign rechecks current CRM consent and removed contacts at dispatch',async()=>{
 const recipient={campaign_status:'SENDING',lead_id:'lead'};
 for(const contact of [null,{email:'qa@example.invalid',marketing_email_opt_in:false}])
   assert.equal(await dispatchDecision(db(recipient,contact),message),'CANCELLED');
 assert.equal(await dispatchDecision(db(recipient,{email:'qa@example.invalid',marketing_email_opt_in:true}),message),'SEND');
});
test('paid invoice and cancelled/rescheduled event cannot be sent on retry',async()=>{
 for(const trigger_key of ['OVERDUE_BALANCE_REMINDER','EVENT_24H_REMINDER']){
   assert.equal(await dispatchDecision(db(null),{trigger_key}),'CANCELLED');
   assert.equal(await dispatchDecision(db(null,{}),{trigger_key}),'SEND');
 }
});
test('scheduled delivery uses bounded backoff, honors provider wait, and never retries unknown outcome',()=>{
 const now=Date.now();
 assert.ok(scheduledRetry({},1).getTime()>=now+60000);
 assert.ok(scheduledRetry({},2).getTime()>=now+120000);
 assert.ok(scheduledRetry({details:{retryAfter:300}},1).getTime()>=now+300000);
 assert.equal(scheduledRetry({},3),null);
 assert.equal(scheduledRetry({details:{retryable:false}},1),null);
 assert.equal(scheduledRetry({code:'DELIVERY_OUTCOME_UNKNOWN'},1),null);
 assert.equal(scheduledRetry({details:{outcomeUnknown:true}},1),null);
});
test('gallery delivery cannot retry an expired, revoked or unpublished access link',async()=>{
 const privateMessage={trigger_key:'GALLERY_DELIVERY',idempotency_key:'gallery-delivery:key:recipient'};
 const active={status:'ACTIVE',album_status:'PUBLISHED',type:'ALBUM'};
 for(const patch of [{status:'REVOKED'},{album_status:'DRAFT'},{expires_at:'2020-01-01'}])
   assert.equal(await dispatchDecision({query:async()=>({rows:[{...active,...patch}]})},privateMessage),'CANCELLED');
 assert.equal(await dispatchDecision({query:async()=>({rows:[active]})},privateMessage),'SEND');
 const legacyMessage={trigger_key:'GALLERY_DELIVERY',idempotency_key:'event-gallery-delivery:delivery:recipient'};
 assert.equal(await dispatchDecision(db(null),legacyMessage),'CANCELLED');
 assert.equal(await dispatchDecision(db(null,{}),legacyMessage),'SEND');
});
