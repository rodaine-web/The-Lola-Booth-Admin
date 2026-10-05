import test from 'node:test';
import assert from 'node:assert/strict';
import {composeTracking,trackingHash,trackingOrigin,recordCampaignTracking,automatedTrackingRequest} from '../server/src/services/campaign-tracking.js';
import {pool} from '../server/src/db/pool.js';
const token='a'.repeat(43);
test('tracked email preserves content and styles, wraps links, excludes unsubscribe and hashes credentials',()=>{
 let n=0;const result=composeTracking({html:'<!doctype html><html><body><table style="color:#fff"><tr><td><a href="https://example.com/interest/private?x=1&amp;y=2">Offer</a><a href="https://example.com/unsubscribe/private">Unsubscribe</a><a href="mailto:info@example.com">Email</a></td></tr></table></body></html>',text:'View https://example.com/interest/private?x=1&y=2'},{origin:'https://api.example.com',tokenFactory:()=>String(++n).repeat(43)});
 assert.match(result.html,/style="color:#fff"/);assert.match(result.html,/track\/click\/1{43}/);assert.match(result.html,/track\/open\/2{43}/);assert.match(result.html,/href="https:\/\/example.com\/unsubscribe\/private"/);assert.match(result.html,/mailto:info@example.com/);
 assert.equal(result.links.length,2);assert.equal(result.links[0].destination,'https://example.com/interest/private?x=1&y=2');assert.equal(result.links[0].token_hash,trackingHash('1'.repeat(43)));assert.match(result.text,/track\/click/);
});
test('tracking origin is explicit HTTPS backend and scanner requests are excluded',()=>{
 for(const origin of [undefined,'http://example.com','https://localhost','https://u:p@example.com','https://api.example.com/path'])assert.throws(()=>trackingOrigin(origin));
 for(const request of [{method:'HEAD'},{purpose:'prefetch'},{userAgent:'Proofpoint scanner'},{userAgent:'Googlebot'}])assert.equal(automatedTrackingRequest(request),true);
 assert.equal(automatedTrackingRequest({userAgent:'Mozilla/5.0'}),false);
});
function fixture(t,{sent=true,unsubscribed=false,status='SENT'}={}){
 let opened=false,clicked=false;const calls=[];const db=async(sql,args=[])=>{
 calls.push({sql,args});let rows=[];
 if(sql.startsWith('SELECT t.*'))rows=[{recipient_id:'recipient',campaign_id:'campaign',kind:args[1],destination:'https://example.com/interest/demo',sent_at:sent?'2026-10-05':null,unsubscribed_at:unsubscribed?'2026-10-05':null,status}];
 if(sql.startsWith('UPDATE campaign_recipients')){const open=sql.includes('opened_at');if(!(open?opened:clicked))rows=[{id:'recipient'}];if(open)opened=true;else clicked=true;}
 return {rows,rowCount:rows.length};};
 t.mock.method(pool,'query',db);t.mock.method(pool,'connect',async()=>({query:db,release(){}}));return calls;
}
test('opens and clicks record unique first events without inventing delivery',async t=>{
 const calls=fixture(t);for(const kind of ['OPEN','CLICK']){await recordCampaignTracking(token,kind);await recordCampaignTracking(token,kind);}
 assert.equal(calls.filter(c=>c.sql.startsWith('INSERT INTO campaign_events')).length,2);assert.equal(calls.some(c=>c.sql.includes('delivered_at')),false);
 assert.equal(calls.find(c=>c.sql.startsWith('SELECT')).args[0],trackingHash(token));
});
test('scanner clicks still redirect but do not count, nor do HEAD opens',async t=>{
 const calls=fixture(t);assert.equal(await recordCampaignTracking(token,'CLICK',{userAgent:'Proofpoint scanner'}),'https://example.com/interest/demo');await recordCampaignTracking(token,'OPEN',{method:'HEAD'});assert.equal(calls.some(c=>c.sql.startsWith('UPDATE')),false);
});
for(const state of [{sent:false},{unsubscribed:true},{status:'CANCELLED'}])test('preview/unsent and suppressed recipient tracking is ignored '+JSON.stringify(state),async t=>{const calls=fixture(t,state);await recordCampaignTracking(token,'CLICK');assert.equal(calls.some(c=>c.sql.startsWith('UPDATE')),false);});
test('unknown/malformed token cannot choose a redirect destination',async t=>{
 fixture(t);await assert.rejects(recordCampaignTracking('bad?url=https://evil.example','CLICK'),e=>e.code==='NOT_FOUND');
 t.mock.method(pool,'connect',async()=>({query:async()=>({rows:[],rowCount:0}),release(){}}));
 await assert.rejects(recordCampaignTracking(token,'CLICK'),e=>e.code==='NOT_FOUND');
});
