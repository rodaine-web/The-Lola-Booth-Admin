import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import definitions from '../shared/integration-marketplace-catalog.json' with {type:'json'};
import {marketplaceState,marketplaceMetrics,filterIntegrations} from '../shared/integration-marketplace.js';
test('catalog keeps each provider unique across categories and never invents a connector',()=>{
 assert.equal(new Set(definitions.map(d=>d.id)).size,definitions.length);
 for(const d of definitions){assert.ok(d.officialWebsite.startsWith('https://'));assert.ok(d.categories.length);if(d.implementationStatus==='planned')assert.equal(marketplaceState(d,{status:'CONNECTED',verified:true}).status,'COMING_SOON');if(d.logoVerified){assert.ok(d.logoSource?.startsWith('https://'));assert.ok(fs.existsSync('public'+d.logoPath));}}
});
test('connected requires operational evidence; recommendation never implies connectivity',()=>{
 const d=definitions.find(d=>d.id==='STRIPE');assert.equal(marketplaceState(d,{status:'CONNECTED'}).status,'CONFIGURED');assert.equal(marketplaceState(d,{status:'CONNECTED',verified:true}).status,'CONNECTED');assert.equal(marketplaceState(d,{status:'TEST_READY'}).health,'unknown');assert.equal(marketplaceState(d,{status:'EXPIRED',verified:true}).health,'attention');assert.equal(marketplaceState(d,{status:'DISABLED',verified:true}).status,'DISABLED');
});
test('filters combine search and category; metrics deduplicate multi-category providers',()=>{
 const apps=definitions.map(d=>({...d,state:marketplaceState(d,{status:d.id==='MAILCHIMP'?'CONNECTED':'NOT_CONNECTED',verified:d.id==='MAILCHIMP'})}));
 assert.equal(filterIntegrations(apps,'mailchimp','automation').length,1);assert.equal(filterIntegrations(apps,'mailchimp','connected').length,1);assert.equal(filterIntegrations(apps,'not-a-provider','all').length,0);assert.equal(marketplaceMetrics(apps).connected,1);assert.equal(filterIntegrations(apps,'Photo Booth Apps','all').length,6);assert.equal(filterIntegrations(apps,'productivity','all').length,7);assert.ok(filterIntegrations(apps,'','recommended').every(a=>a.recommended));
});
