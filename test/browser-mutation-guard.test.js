import test from 'node:test';import assert from 'node:assert/strict';
test('rapid identical Admin mutations share one request; failures clear the guard',async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const {api}=await import('../src/api/client.js');const original=globalThis.fetch;let calls=0,release;
 try{globalThis.fetch=async()=>{calls++;await new Promise(r=>release=r);return new Response('{"id":"one"}',{status:201});};
 for(const path of ['/leads','/clients','/events','/proposals','/invoices','/users','/communications/drafts','/communications/1/send','/communications/1/schedule','/events/1/staff','/events/1/equipment']){
 const before=calls,a=api.post(path,{fixture:true}),b=api.post(path,{fixture:true});assert.equal(a,b);release();await Promise.all([a,b]);assert.equal(calls,before+1);
 }
 globalThis.fetch=async()=>new Response('{"error":{"message":"failure"}}',{status:500});await assert.rejects(api.post('/leads',{}));globalThis.fetch=async()=>new Response('{"id":"recovered"}',{status:201});assert.equal((await api.post('/leads',{})).id,'recovered');
 }finally{globalThis.fetch=original;delete globalThis.localStorage;}
});
