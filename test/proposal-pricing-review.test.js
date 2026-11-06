import test from 'node:test';
import assert from 'node:assert/strict';
import {proposalPricingCatalog,proposalPricingCategory} from '../shared/proposal-pricing-review.js';
test('business request purpose does not force selected event packages into custom catalog',()=>{
 const packages=[{id:'event',catalog_key:'PROFESSIONAL',pricing_profile:{}},{id:'standard',catalog_key:'STANDARD',pricing_profile:{}},{id:'custom',catalog_key:'ACTIVATION',pricing_profile:{quoteRequired:true}}];
 assert.equal(proposalPricingCatalog([{package_id:'event'}],packages),'PROFESSIONAL');
 assert.equal(proposalPricingCategory('PROFESSIONAL','CUSTOM_PRODUCTION','BUSINESS'),'PROFESSIONAL');
 assert.equal(proposalPricingCategory('STANDARD','CUSTOM_PRODUCTION','BUSINESS'),'COMPANY_CELEBRATION');
 assert.equal(proposalPricingCategory('STANDARD','PRIVATE_CELEBRATION','INDIVIDUAL'),'PRIVATE_CELEBRATION');
 assert.equal(proposalPricingCatalog([{package_id:'custom'},{package_id:'event'}],packages),'PROFESSIONAL');
 assert.equal(proposalPricingCatalog([{package_id:'custom'}],packages),'CUSTOM');
 assert.throws(()=>proposalPricingCatalog([{package_id:'standard'},{package_id:'event'}],packages),/same pricing catalog/);
});
