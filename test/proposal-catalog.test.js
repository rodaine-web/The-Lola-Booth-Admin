import test from 'node:test';import assert from 'node:assert/strict';
import {selectProposalPackage,selectProposalExperience,proposalCatalogError} from '../shared/proposal-catalog.js';
test('choosing a package maps its experience and current catalog amount',()=>{
 const form=selectProposalPackage({experience_id:'vogue',package_amount:2299},{id:'glam-essential',experience_id:'glam',starting_price:'599.00',pricing_mode:'STARTING'});
 assert.equal(form.experience_id,'glam');assert.equal(form.package_amount,'599.00');
 const next=selectProposalExperience(form,'vogue');assert.equal(next.package_id,'');assert.equal(next.package_amount,'');
 assert.equal(selectProposalExperience(form,'glam'),form);
});
test('custom catalog entries require an agreed price and never inherit a previous amount',()=>{
 assert.equal(selectProposalPackage({package_amount:599},{id:'custom',pricing_mode:'CUSTOM'}).package_amount,'');
 for(const amount of [undefined,null,'',0,-1])assert.ok(proposalCatalogError({package_amount:amount},{pricing_mode:'CUSTOM'},[]));
 assert.equal(proposalCatalogError({package_amount:750},{pricing_mode:'CUSTOM'},[]),null);
 const travel={id:'travel',name:'Travel',pricing_type:'CUSTOM'};
 assert.ok(proposalCatalogError({addons:[{addon_id:'travel'}]},null,[travel]));
 assert.equal(proposalCatalogError({addons:[{addon_id:'travel',unit_price:125}]},null,[travel]),null);
});
test('server validation rejects an experience/package mismatch',()=>{
 assert.ok(proposalCatalogError({experience_id:'glam'},{experience_id:'vogue'},[]));
 assert.equal(proposalCatalogError({experience_id:'glam'},{experience_id:'glam',pricing_mode:'STARTING'},[]),null);
});
