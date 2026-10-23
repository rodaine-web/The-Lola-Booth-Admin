import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url)));
const policies=config.headers.filter(r=>r.headers.some(h=>h.key==='Content-Security-Policy'));
const matches=(rule,host)=> (rule.has||[]).every(c=>c.type==='host'&&new RegExp('^(?:'+c.value+')$').test(host)) && (rule.missing||[]).every(c=>c.type==='host'&&!new RegExp('^(?:'+c.value+')$').test(host));
function policy(host) {
 const applicable=policies.filter(r=>matches(r,host));assert.equal(applicable.length,1,host+' must select exactly one CSP');
 return applicable[0].headers.find(h=>h.key==='Content-Security-Policy').value;
}
test('production Admin and gallery allow only production API',()=>{
 for(const host of ['admin.thelolabooth.com','gallery.thelolabooth.com']){
  const p=policy(host);assert.match(p,/https:\/\/api\.thelolabooth\.com/);assert.doesNotMatch(p,/stagingapi/);assert.match(p,/script-src 'self';/);assert.match(p,/frame-ancestors 'none'/);
 }
});
test('staging and preview hosts allow only staging API',()=>{
 for(const host of ['stagingadmin.thelolabooth.com','staging.thelolabooth.com','staginggallery.thelolabooth.com','preview.vercel.app','admin.thelolabooth.com.evil.invalid']){
  const p=policy(host);assert.match(p,/https:\/\/stagingapi\.thelolabooth\.com/);assert.doesNotMatch(p,/https:\/\/api\.thelolabooth\.com/);
 }
});
test('both policies preserve core security and noindex headers',()=>{
 for(const r of policies)for(const header of ['X-Content-Type-Options','Permissions-Policy','X-Frame-Options']) assert.ok(r.headers.some(h=>h.key===header));
 assert.ok(config.headers.some(r=>r.source==='/(.*)'&&!r.has&&!r.missing&&r.headers.some(h=>h.key==='X-Robots-Tag'&&h.value.includes('noindex'))));
});
test('both owned gallery domains redirect to the gallery without changing staff routes',()=>{
 for(const host of ['gallery.thelolabooth.com','staginggallery.thelolabooth.com']){
  const r=config.redirects.filter(r=>r.source==='/'&&matches(r,host));assert.equal(r.length,1);assert.equal(r[0].destination,'/gallery');assert.equal(r[0].permanent,false);
 }
 assert.equal(config.redirects.filter(r=>matches(r,'admin.thelolabooth.com')).length,0);
});
