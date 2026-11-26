import test from 'node:test';
import assert from 'node:assert/strict';
import {KEEPSAKES_CORE_PRODUCTS,coreCatalogueView} from '../shared/keepsakes-core-catalogue.js';
import {keepsakesCart} from '../shared/keepsakes.js';
test('the new catalogue has exactly 12 approved products and no retired merchandise',()=>{
 assert.equal(KEEPSAKES_CORE_PRODUCTS.length,12);
 assert.equal(new Set(KEEPSAKES_CORE_PRODUCTS.map(p=>p.key)).size,12);
 assert.deepEqual(['digital','everyday','signature'].map(c=>KEEPSAKES_CORE_PRODUCTS.filter(p=>p.collection===c).length),[3,6,3]);
 assert.ok(KEEPSAKES_CORE_PRODUCTS.every(p=>!['PRODIGI','DIGITAL'].includes(p.route)));
 assert.ok(!KEEPSAKES_CORE_PRODUCTS.some(p=>/mug|coaster|calendar/i.test(p.title)));
 assert.equal(KEEPSAKES_CORE_PRODUCTS.find(p=>p.key==='edited-photo').source,'ORIGINAL_UNBRANDED');
 assert.equal(KEEPSAKES_CORE_PRODUCTS.find(p=>p.key==='edited-strip').source,'BRANDED_STRIP');
});
test('catalogue views cannot publish an unimplemented route or leak private supplier costs',()=>{
 const result=coreCatalogueView([{catalogue_key:'keychain',id:'configured-id',active:true,verified:true,retail_cents:2499,provider_cost_cents:500},{catalogue_key:'mug',retail_cents:2000}]);
 assert.equal(result.length,12);const product=result.find(p=>p.key==='keychain');assert.equal(product.retailCents,2499);assert.equal(product.available,false);assert.equal(product.provider_cost_cents,undefined);assert.equal(result.find(p=>p.key==='photo-book').retailCents,null);
});
test('postcard cart retains a validated sender address with leading-zero ZIP and rejects an incomplete one',()=>{
 const address={name:'Sender QA',address1:'1 Test Street',city:'Boston',state:'MA',zip:'02134',country:'US'};
 const input={email:'qa@example.test',shippingAddress:address,items:[{productId:'00000000-0000-4000-8000-000000000001',variantId:'standard',assetIds:['00000000-0000-4000-8000-000000000002'],quantity:1,returnAddress:address,recipients:[{...address,name:'Recipient QA'}]}]};
 assert.equal(keepsakesCart.parse(input).items[0].returnAddress.zip,'02134');
 assert.equal(keepsakesCart.safeParse({...input,items:[{...input.items[0],returnAddress:{...address,name:''}}]}).success,false);
});

test('editing and merchandise pickers use their distinct scoped permissions',async()=>{
 const {eligibleProductPhotos}=await import('../shared/keepsakes-photo-access.js');
 const a={id:'strip',sessionId:'capture',kind:'BRANDED_STRIP',branded:true,merchandiseEligible:true,retailDigitalEligible:true,retailMerchandiseEligible:false,allowedProductIds:['edit','frame']};
 assert.equal(eligibleProductPhotos({...KEEPSAKES_CORE_PRODUCTS.find(p=>p.key==='edited-strip'),productId:'edit'},[a]).length,1);
 assert.equal(eligibleProductPhotos({...KEEPSAKES_CORE_PRODUCTS.find(p=>p.key==='framed-photo'),productId:'frame'},[a]).length,0);
});
