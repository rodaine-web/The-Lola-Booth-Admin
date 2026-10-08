import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchDecision} from '../server/src/services/communication-dispatch-policy.js';
const message={id:'message',event_id:'event',client_id:'client',trigger_key:'PLANNING_RECURRING_REMINDER'};
test('planning reminders stay disabled until explicitly qualified and activated',async()=>{
 const old=process.env.PLANNING_REMINDERS_ENABLED;delete process.env.PLANNING_REMINDERS_ENABLED;
 try{assert.equal(await dispatchDecision({query:()=>{throw Error('Should not query a disabled reminder');}},message),'CANCELLED');}
 finally{if(old===undefined)delete process.env.PLANNING_REMINDERS_ENABLED;else process.env.PLANNING_REMINDERS_ENABLED=old;}
});
test('reminder dispatch requires current event, client and grant/version qualification',async()=>{
 const old=process.env.PLANNING_REMINDERS_ENABLED;process.env.PLANNING_REMINDERS_ENABLED='true';
 try{
  let args;const client={query:async(_sql,input)=>{args=input;return {rowCount:1};}};
  assert.equal(await dispatchDecision(client,message),'SEND');assert.deepEqual(args,['message','event','client']);
  assert.equal(await dispatchDecision({query:async()=>({rowCount:0})},message),'CANCELLED');
 }finally{if(old===undefined)delete process.env.PLANNING_REMINDERS_ENABLED;else process.env.PLANNING_REMINDERS_ENABLED=old;}
});
