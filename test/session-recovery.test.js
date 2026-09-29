import test from 'node:test';import assert from 'node:assert/strict';import{restoreSession}from'../shared/session-recovery.js';
test('temporary API failures preserve sign-in and recover on retry',async()=>{
 for(const status of [429,500,undefined]){let cleared=false;const result=await restoreSession(async()=>{throw Object.assign(new Error('Unavailable'),{status})},()=>{cleared=true});assert.equal(cleared,false);assert.match(result.error,/preserved/);const retry=await restoreSession(async()=>({user:{id:'owner'}}),()=>{cleared=true});assert.equal(retry.user.id,'owner');assert.equal(retry.error,null);}
});
test('invalid sessions are cleared and return to login',async()=>{let cleared=false;const result=await restoreSession(async()=>{throw Object.assign(new Error('Expired'),{status:401})},()=>{cleared=true});assert.equal(cleared,true);assert.deepEqual(result,{user:null,error:null});});
