import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardReadiness} from '../server/src/utils/dashboard-readiness.js';

test('dashboard omits unauthorized event operations without failing the whole dashboard',async()=>{
  const reads=[];const user={id:'reader'};
  const rows=await dashboardReadiness([{id:'restricted'},{id:'assigned'}],user,{
    canAccess:async(u,id)=>u===user&&id==='assigned',
    readOperations:async id=>{reads.push(id);return {readiness:{score:80}};}
  });
  assert.deepEqual(reads,['assigned']);
  assert.deepEqual(rows,[{id:'assigned',operational_readiness:{score:80}}]);
});
test('dashboard never requests operations without an authenticated user',async()=>{
  const unexpected=()=>{throw Error('Must not call');};
  assert.deepEqual(await dashboardReadiness([{id:'event'}],null,{canAccess:unexpected,readOperations:unexpected}),[]);
});
test('dashboard does not mask actual authorized operations failures',async()=>{
  await assert.rejects(dashboardReadiness([{id:'event'}],{id:'reader'},{canAccess:async()=>true,readOperations:async()=>{throw Error('Database unavailable');}}),/Database unavailable/);
});
