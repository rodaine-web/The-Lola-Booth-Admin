import test from 'node:test';
import assert from 'node:assert/strict';
import {businessPackageDefinitions} from '../shared/business-plans.js';
import {calculateCatalogQuote} from '../server/src/services/catalog-pricing-engine.js';
import {customerPricing} from '../shared/customer-pricing.js';
const packages=businessPackageDefinitions().map(p=>({id:p.key+':'+p.tier,name:p.name,active:true,catalog_key:p.catalog,tier_key:p.tier,starting_price:p.price,pricing_mode:'FIXED',pricing_profile:{businessPlan:true,experience:p.key,serviceHours:p.hours,prints:p.prints,featureLabels:p.features,includedExperiences:p.included,includedAddonKeys:[]}}));
const catalog={packages,addons:[],rules:{printPrices:{},printOperations:{}}};
function quote(tier,keys,included,extra={}){return calculateCatalogQuote({version:'qa',eventCategory:['ACTIVATION','CAMPAIGN'].includes(tier)?'ACTIVATION':'PROFESSIONAL',customerType:'BUSINESS',selections:keys.map(k=>({packageId:k+':'+tier})),businessPlan:{includedPackageIds:included.map(k=>k+':'+tier),...extra},override:{travelAmountCents:0,reason:'Owner approved quotation'}},catalog,{admin:true,simpleAdmin:true});}
test('all 20 approved per-experience rates and coverage produce quotes without print approval prompts',()=>{
 assert.equal(packages.length,20);
 for(const p of packages){const included=p.pricing_profile.includedExperiences===1?[p.pricing_profile.experience]:[p.pricing_profile.experience,p.pricing_profile.experience==='glam'?'360':'glam'];const q=quote(p.tier_key,included,included);assert.equal(q.status,'PRICED');assert.equal(q.lines.find(l=>l.packageId===p.id).amountCents,p.starting_price*100);assert.equal(q.entitlements.find(e=>e.packageId===p.id).selectedPrints,p.pricing_profile.prints);}
});
test('Activation uses additive full base rates and discounts only the additional Mirror',()=>{
 const q=quote('ACTIVATION',['glam','360','mirror'],['glam','360']);assert.equal(q.serviceTotalCents,1069715);assert.deepEqual(q.lines.map(l=>l.amountCents),[349900,379900,339915]);assert.equal(q.lines[2].discountPercent,15);assert.equal(q.lines[0].discountPercent,0);
});
test('all four additional-experience discount scenarios and undefined combination review',()=>{
 for(const [tier,keys,included,discount]of [['EVENT',['glam','360'],['glam'],10],['EVENT',['glam','360','mirror'],['glam'],15],['EVENT_PREMIUM',['glam','360','mirror'],['glam','360'],15],['CAMPAIGN',['glam','360','mirror','vogue'],['glam','360'],20]]){const q=quote(tier,keys,included);assert.ok(q.lines.filter(l=>l.businessRole==='ADDITIONAL').every(l=>l.discountPercent===discount));}
 assert.throws(()=>quote('EVENT',['glam','360','mirror','vogue'],['glam']),/authorized custom discount/);
 assert.equal(quote('EVENT',['glam','360','mirror','vogue'],['glam'],{additionalDiscountPercent:0}).status,'PRICED');
});
test('internal rates require Admin, exact included count, consistent tier and a scoped Campaign schedule',()=>{
 assert.throws(()=>quote('EVENT_PREMIUM',['glam'],['glam']),/exactly 2/);
 const q=quote('CAMPAIGN',['glam','360'],['glam','360'],{coverageHours:10,scope:'Base day 10 hours. Each eligible experience has 750 prints; extra dates quoted separately.'});assert.equal(q.entitlements[0].serviceHours,10);
 assert.throws(()=>calculateCatalogQuote({version:'qa',eventCategory:'PROFESSIONAL',selections:[{packageId:'glam:EVENT'}]},catalog),/Admin quotation/);
 const customer=customerPricing(q);assert.equal(customer.businessPlan,undefined);assert.equal(customer.catalogKey,undefined);assert.equal(customer.entitlements[0].tier,undefined);assert.ok(customer.lines.every(l=>l.originalUnitPriceCents===undefined));
});

test('editing a discounted business proposal recovers the original base rate exactly once',async()=>{
 const {proposalBusinessBaseCents}=await import('../shared/proposal-pricing-review.js');
 const previous=quote('ACTIVATION',['glam','360','mirror'],['glam','360']);
 const mirror=packages.find(p=>p.id==='mirror:ACTIVATION');
 assert.equal(proposalBusinessBaseCents({price:3399.15},mirror,previous),399900);
 assert.equal(proposalBusinessBaseCents({price:3500,priceIsBaseRate:true},mirror,previous),350000);
});

test('digital-only business print overrides require an audited Admin approval and never reduce base rates automatically',()=>{
 const p=packages.find(p=>p.id==='vogue:EVENT');
 const input={version:'qa',eventCategory:'PROFESSIONAL',customerType:'BUSINESS',selections:[{packageId:p.id,prints:0}],businessPlan:{includedPackageIds:[p.id]},override:{travelAmountCents:0,reason:'Vogue printer capability not assigned; digital delivery agreed',printApprovals:[{packageId:p.id,selectedPrints:0,unlimitedPrints:false,amountCents:0}]}};
 const q=calculateCatalogQuote(input,catalog,{admin:true,simpleAdmin:true});assert.equal(q.serviceTotalCents,129900);assert.equal(q.entitlements[0].selectedPrints,0);assert.ok(q.entitlements[0].featureLabels.some(f=>f.includes('no physical prints')));
 assert.throws(()=>calculateCatalogQuote({...input,override:{travelAmountCents:0}},catalog,{admin:true,simpleAdmin:true}),/audited business print override/);
});
