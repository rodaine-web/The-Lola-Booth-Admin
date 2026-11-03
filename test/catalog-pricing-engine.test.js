import test from 'node:test';
import assert from 'node:assert/strict';
import {minorUnits,printUpgrade,selectPricingCatalog,travelPricing,calculateCatalogQuote} from '../server/src/services/catalog-pricing-engine.js';
import {defaultPricingRules,pricingPackageDefaults,pricingAddonDefaults} from '../server/src/services/pricing-catalog-defaults.js';
import {customerPricing} from '../shared/customer-pricing.js';
const packages=pricingPackageDefaults().map((p,i)=>({...p,id:String(i),active:true}));
const addons=pricingAddonDefaults().map((a,i)=>({...a,id:'a'+i,active:true}));
const catalog={packages,addons,rules:defaultPricingRules};
const chicago={verified:true,venueValidated:true,source:'QA fixture',calculatedAt:'2026-11-02T12:00:00Z',insideChicago:true,oneWayMinutes:20};
function quote(experience,tier,extras={},options={}){const pkg=packages.find(p=>p.pricing_profile.experience===experience&&p.tier_key===tier&&p.catalog_key==='STANDARD');return calculateCatalogQuote({version:'qa',eventCategory:'PRIVATE_CELEBRATION',selections:[{packageId:pkg.id,...extras}],route:chicago,...options},catalog);}
test('decimal currency conversion rejects rounding, negative and unsafe input',()=>{
 assert.equal(minorUnits('599.01'),59901);for(const bad of ['-1','0.001','1e2','NaN','Infinity','9007199254740991'])assert.throws(()=>minorUnits(bad));
});
test('all 36 package rows have approved base prices and distinct identities',()=>{
 assert.equal(packages.length,36);
 const expected={STANDARD:{glam:[599,899,1499],'360':[699,1099,1699],vogue:[899,1499,2299],audio:[299,449,699]},PROFESSIONAL:{glam:[999,1399,1999],'360':[1199,1599,2299],vogue:[1499,1999,2899],audio:[449,699,999]},ACTIVATION:{glam:[1499,2499,null],'360':[1799,2999,null],vogue:[2299,3499,null],audio:[799,1299,null]}};
 for(const [key,experiences] of Object.entries(expected))for(const [exp,amounts] of Object.entries(experiences))assert.deepEqual(packages.filter(p=>p.catalog_key===key&&p.pricing_profile.experience===exp).map(p=>p.starting_price===null?null:Number(p.starting_price)),amounts);
});
test('required print upgrade examples, no duplicate inclusion charges',()=>{
 assert.equal(quote('glam','ESSENTIAL',{prints:200}).serviceTotalCents,82400);
 assert.equal(quote('glam','SIGNATURE',{prints:500}).serviceTotalCents,112400);
 assert.equal(quote('glam','LUXE',{prints:500}).serviceTotalCents,149900);
 assert.equal(quote('vogue','SIGNATURE',{prints:500}).serviceTotalCents,174900);
 assert.throws(()=>quote('360','ESSENTIAL',{prints:100}));assert.throws(()=>quote('audio','ESSENTIAL',{prints:100}));
 assert.throws(()=>quote('glam','LUXE',{prints:200}));assert.equal(quote('glam','LUXE',{prints:1000}).status,'REVIEW_REQUIRED');
 assert.equal(printUpgrade('glam',500,500,defaultPricingRules.printPrices),0);
});
test('business holiday party receives standard pricing, professional downgrade allowed',()=>{
 assert.equal(quote('glam','SIGNATURE',{}, {customerType:'BUSINESS',eventCategory:'COMPANY_CELEBRATION'}).serviceTotalCents,89900);
 assert.equal(selectPricingCatalog('PROFESSIONAL','STANDARD'),'STANDARD');
 assert.throws(()=>selectPricingCatalog('PRIVATE_CELEBRATION','ACTIVATION'));
 assert.equal(selectPricingCatalog('PRIVATE_CELEBRATION','ACTIVATION',{admin:true,reason:'Branded production scope'}),'ACTIVATION');
});
test('travel uses verified boundary mileage, one-way rate once, no state surcharge',()=>{
 const route={...chicago,insideChicago:false,boundaryVerified:true,oneWayMinutes:75,state:'IN',excessMilesByAllowance:{0:30,30:12.5,60:0}};
 assert.equal(quote('glam','ESSENTIAL',{}, {route}).travel.amountCents,7500);
 assert.equal(quote('glam','SIGNATURE',{}, {route}).travel.amountCents,3125);
 assert.equal(quote('glam','LUXE',{}, {route}).travel.amountCents,0);
 for(const r of [null,{...route,boundaryVerified:false},{...route,oneWayMinutes:90},{...route,flags:['Overnight']},{...route,excessMilesByAllowance:{}}])assert.equal(quote('glam','SIGNATURE',{}, {route:r}).status,'REVIEW_REQUIRED');
 assert.equal(quote('glam','SIGNATURE',{}, {route,extraTrips:true}).status,'REVIEW_REQUIRED');
});
test('multiple experiences charge one trip at longest coverage',()=>{
 const selected=['glam','360'].map((exp,i)=>({packageId:packages.find(p=>p.catalog_key==='STANDARD'&&p.pricing_profile.experience===exp&&p.tier_key===(i?'LUXE':'ESSENTIAL')).id}));
 const result=calculateCatalogQuote({version:'qa',eventCategory:'PRIVATE_CELEBRATION',selections:selected,route:{...chicago,insideChicago:false,boundaryVerified:true,oneWayMinutes:70,excessMilesByAllowance:{0:30,60:2}}},catalog);
 assert.equal(result.travel.amountCents,500);assert.equal(result.lines.filter(l=>l.type==='TRAVEL').length,1);
});
test('included add-ons, incompatible options, duplicates and unauthorized discounts rejected',()=>{
 const red=addons.find(a=>a.pricing_policy.key==='red-carpet');
 assert.throws(()=>quote('360','LUXE',{addons:[{addonId:red.id}]}));
 assert.throws(()=>quote('glam','ESSENTIAL',{addons:[{addonId:red.id}]}));
 assert.throws(()=>quote('360','ESSENTIAL',{addons:[{addonId:red.id},{addonId:red.id}]}));
 assert.throws(()=>quote('glam','ESSENTIAL',{}, {discountCents:100}));
 assert.equal(quote('360','ESSENTIAL',{addons:[{addonId:red.id}]}).serviceTotalCents,84900);
});
test('audio promises, starting prices and custom productions require review',()=>{
 assert.equal(quote('audio','ESSENTIAL').status,'REVIEW_REQUIRED');
 for(const p of packages.filter(p=>p.catalog_key==='ACTIVATION')){const result=calculateCatalogQuote({version:'qa',eventCategory:p.pricing_profile.quoteRequired?'CUSTOM_PRODUCTION':'ACTIVATION',selections:[{packageId:p.id}],route:chicago},catalog);assert.equal(result.status,'REVIEW_REQUIRED');}
});
test('tax remains unknown until Stripe calculates it, immutable calculation inputs retained',()=>{
 const q=quote('glam','SIGNATURE');assert.equal(q.tax.amountCents,null);assert.equal(q.tax.addressSource,'BILLING');assert.equal(q.catalogVersion,'qa');assert.equal(q.entitlements[0].prints,200);
});
test('negotiated prices, custom charges and discounts need an audited reason',()=>{
 const pkg=packages.find(p=>p.catalog_key==='STANDARD'&&p.pricing_profile.experience==='glam'&&p.tier_key==='SIGNATURE');
 const input={version:'qa',eventCategory:'PRIVATE_CELEBRATION',selections:[{packageId:pkg.id,prints:500}],route:chicago,discountCents:5000,customItems:[{description:'Approved special setup',quantity:1,unitPriceCents:7500}],override:{reason:'QA negotiated scope',packagePrices:[{packageId:pkg.id,amountCents:85000}]}};
 const q=calculateCatalogQuote(input,catalog,{admin:true});assert.equal(q.serviceTotalCents,110000);assert.equal(q.lines.find(l=>l.type==='PRINT_UPGRADE').stripeTaxCode,'txcd_20090028');
 assert.throws(()=>calculateCatalogQuote(input,catalog));assert.throws(()=>calculateCatalogQuote({...input,override:{...input.override,reason:''}},catalog,{admin:true}));
});
test('custom scope and price approvals are explicit and survive the quote snapshot',()=>{
 const pkg=packages.find(p=>p.pricing_profile.experience==='glam'&&p.pricing_profile.quoteRequired);
 const input={version:'qa',eventCategory:'CUSTOM_PRODUCTION',selections:[{packageId:pkg.id}],override:{reason:'QA multi-day scope reviewed',scopeApprovals:[{packageId:pkg.id,description:'Two booths, setup, staffing and approved deliverables'}],packagePrices:[{packageId:pkg.id,amountCents:1250000}],travelAmountCents:50000}};
 const q=calculateCatalogQuote(input,catalog,{admin:true});assert.equal(q.status,'PRICED');assert.equal(q.serviceTotalCents,1300000);assert.match(q.entitlements[0].approvedScope,/Two booths/);
 assert.throws(()=>calculateCatalogQuote(input,catalog));
});
test('physical strips count individually; consumable and printer estimates use sheet equivalents',()=>{
 const version={...catalog,rules:{...catalog.rules,printOperations:{costPerSheetCents:25,sheetsPerHour:120}}},pkg=packages.find(p=>p.catalog_key==='STANDARD'&&p.tier_key==='SIGNATURE'&&p.pricing_profile.experience==='glam');
 const q=calculateCatalogQuote({version:'qa',eventCategory:'PRIVATE_CELEBRATION',selections:[{packageId:pkg.id,prints:500,printFormat:'2X6'}],route:chicago},version);
 assert.equal(q.entitlements[0].selectedPrints,500);assert.equal(q.entitlements[0].printEstimate.sheets4x6,250);assert.equal(q.entitlements[0].printEstimate.consumableCostCents,6250);
});
test('high-volume and unlimited print requests stay review-only until explicitly priced',()=>{
 const pkg=packages.find(p=>p.catalog_key==='STANDARD'&&p.pricing_profile.experience==='glam'&&p.tier_key==='SIGNATURE');
 const input={version:'qa',eventCategory:'PRIVATE_CELEBRATION',selections:[{packageId:pkg.id,prints:1000,unlimitedPrints:true}],route:chicago};
 assert.equal(calculateCatalogQuote(input,catalog).status,'REVIEW_REQUIRED');
 const approved=calculateCatalogQuote({...input,override:{reason:'QA consumables and scope reviewed',printApprovals:[{packageId:pkg.id,selectedPrints:1000,unlimitedPrints:true,amountCents:75000}]}},catalog,{admin:true});
 assert.equal(approved.status,'PRICED');assert.equal(approved.serviceTotalCents,164900);assert.equal(approved.entitlements[0].printEstimate.consumableCostCents,null);
});
test('customer pricing excludes internal approval reasons, route evidence and consumable estimates',()=>{
 const original=quote('glam','SIGNATURE');original.override={reason:'INTERNAL ONLY'};original.travel.reason='INTERNAL TRAVEL';original.travel.original={evidence:'PRIVATE ROUTE'};
 const response=customerPricing({content:{scenario:{pricing:{catalog_quote:original}}}});
 const publicQuote=response.content.scenario.pricing.catalog_quote;
 assert.equal(publicQuote.override,undefined);assert.equal(publicQuote.entitlements[0].printEstimate,undefined);assert.equal(publicQuote.travel.original,undefined);assert.equal(publicQuote.travel.reason,undefined);assert.equal(original.override.reason,'INTERNAL ONLY');
});
test('360 can request a separately quoted still-photo station without ordinary print allowances',()=>{
 const station=addons.find(a=>a.pricing_policy.key==='print-station');
 assert.equal(quote('360','ESSENTIAL',{addons:[{addonId:station.id}]}).status,'REVIEW_REQUIRED');
 assert.throws(()=>quote('360','ESSENTIAL',{prints:100}));
});
