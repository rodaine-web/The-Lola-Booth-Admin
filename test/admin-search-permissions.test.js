import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../server/src/db/pool.js';
import {searchAdmin} from '../server/src/services/admin-search-service.js';
import {requirePermission} from '../server/src/middleware/auth.js';
test('global search never queries departments outside the current user permissions',async t=>{
 const calls=[];
 t.mock.method(pool,'query',async(sql)=>{calls.push(sql);return {rows:[{title:'Synthetic QA'}]};});
 assert.deepEqual(await searchAdmin({permissions:['read:admin']},'QA'),[]);
 assert.equal(calls.length,0);
 assert.equal((await searchAdmin({permissions:['read:admin','read:sales']},'QA')).length,2);
 assert.equal(calls.some(sql=>sql.includes('FROM invoices')||sql.includes('FROM events')),false);
 calls.length=0;
 assert.equal((await searchAdmin({permissions:['read:finance']},'QA')).length,1);
 assert.ok(calls[0].includes('FROM invoices'));
 calls.length=0;
 assert.equal((await searchAdmin({permissions:['*']},'QA')).length,4);
});
test('read-only settings permission cannot authorize settings mutations',()=>{
 let error;
 requirePermission('write:settings')({user:{permissions:['read:settings']}},{},e=>{error=e;});
 assert.equal(error.statusCode,403);
 requirePermission('write:settings')({user:{permissions:['write:settings']}},{},e=>{error=e;});
 assert.equal(error,undefined);
});
