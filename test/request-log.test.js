import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRequestLog, safeResponseLog } from '../server/src/utils/request-log.js';
test('request logs redact document credentials, queries and sensitive headers', () => {
  for (const kind of ['proposals','invoices','receipts','delivery','approvals','contracts','workspaces']) {
    const logged = safeRequestLog({id:'request-id', method:'GET', url:`/api/public/${kind}/secret-token/pdf?token=secret-query`, headers:{cookie:'secret-cookie',authorization:'secret-bearer'}});
    assert.equal(logged.url,`/api/public/${kind}/[redacted]/pdf`);
    assert.ok(!JSON.stringify(logged).includes('secret'));
    assert.equal(logged.id,'request-id');
  }
});

test('campaign tracking and preference tokens never appear in request logs',()=>{
 for(const kind of ['track/open','track/click','interest','unsubscribe'])assert.equal(safeRequestLog({url:'/api/public/campaigns/'+kind+'/private-token?destination=secret'}).url,'/api/public/campaigns/'+kind+'/[redacted]');
});

test('redirect credentials and cookies stay out of HTTP response logs',()=>{
 const logged=safeResponseLog({statusCode:302,getHeaders:()=>({location:'https://example.com/interest/private-token','set-cookie':'secret-cookie','content-type':'text/plain'})});
 assert.equal(logged.statusCode,302);assert.equal(logged.headers.location,'[redacted]');assert.equal(logged.headers['content-type'],'text/plain');assert.ok(!JSON.stringify(logged).includes('private-token'));
});
