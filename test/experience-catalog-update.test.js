import test from 'node:test';import assert from 'node:assert/strict';
import {celebrationFeatures,celebrationPrices,primaryExperienceKeys} from '../shared/experience-catalog.js';
import {packageEntitlementLabels,orderedPricingPackages} from '../shared/package-entitlements.js';
import {printUpgrade,calculateCatalogQuote} from '../server/src/services/catalog-pricing-engine.js';
import {bookingIdentity,bookingAddonEligible} from '../server/src/services/public-booking-service.js';
import {pricingPackageDefaults,defaultPricingRules} from '../server/src/services/pricing-catalog-defaults.js';
test('approved celebration prices, ordering, hours and decision-specific print inclusions',()=>{
 assert.deepEqual(primaryExperienceKeys,['glam','360','mirror','vogue']);assert.deepEqual(celebrationPrices.mirror,[799,1199,1999]);assert.equal(celebrationPrices['360'][2],1799);assert.equal(celebrationPrices.vogue[1],1399);
 const features=packageEntitlementLabels({experience:'mirror',serviceHours:4,prints:200,selectedPrints:500,featureLabels:celebrationFeatures('mirror',1)});
 assert.ok(packageEntitlementLabels({experience:'mirror',serviceHours:4,prints:200,unlimitedPrints:true,featureLabels:celebrationFeatures('mirror',1)}).includes('On-site printing: Unlimited physical prints included'));
 assert.ok(features.includes('4 hours of service'));assert.ok(features.includes('On-site printing: 500 physical prints included'));assert.ok(features.includes('Custom mirror animations'));
 assert.ok(!celebrationFeatures('vogue',1).some(x=>x.includes('printing')));assert.ok(celebrationFeatures('vogue',2).some(x=>x.includes('printing')));
 const rows=primaryExperienceKeys.toReversed().map((key,i)=>({name:key,catalog_key:'STANDARD',tier_key:'ESSENTIAL',pricing_profile:{experience:key}}));assert.deepEqual(orderedPricingPackages(rows).map(x=>x.name),primaryExperienceKeys);
});
test('Mirror supports priced packages and print upgrades without double charging included allowances',()=>{
 const original=pricingPackageDefaults().find(p=>p.pricing_profile.experience==='glam'&&p.tier_key==='SIGNATURE'&&p.catalog_key==='STANDARD');
 const pkg={...original,id:'mirror-signature',name:'The Lola Magic Mirror — Signature',active:true,starting_price:'1199.00',pricing_profile:{...original.pricing_profile,experience:'mirror',featureLabels:celebrationFeatures('mirror',1)}};
 const rules={...defaultPricingRules,printPrices:{...defaultPricingRules.printPrices,mirror:{...defaultPricingRules.printPrices.glam}}};
 const addon={id:'audio',name:'Audio Guest Book',price:'249.00',active:true,pricing_policy:{key:'audio-guestbook',method:'FIXED',category:'ENHANCEMENT',experiences:primaryExperienceKeys,minQuantity:1,maxQuantity:1,approvalRequired:false}};
 const calculate=choice=>calculateCatalogQuote({version:'synthetic',eventCategory:'PRIVATE_CELEBRATION',selections:[{packageId:pkg.id,...choice}],override:{travelAmountCents:0}},{packages:[pkg],addons:[addon],rules},{admin:true,simpleAdmin:true});
 assert.equal(printUpgrade('mirror',200,200,rules.printPrices),0);assert.equal(calculate({}).serviceTotalCents,119900);assert.equal(calculate({prints:500}).serviceTotalCents,142400);assert.equal(calculate({addons:[{addonId:'audio',quantity:1}]}).serviceTotalCents,144800);
 assert.throws(()=>printUpgrade('mirror',500,200,rules.printPrices));
});
test('Mirror booking identity and Audio add-on eligibility preserve standalone separation',()=>{
 assert.equal(bookingIdentity({slug:'lola-magic-mirror'}),'mirror');
 const addon={name:'Audio Guest Book',pricing_policy:{key:'audio-guestbook',category:'ENHANCEMENT',experiences:primaryExperienceKeys}};
 for(const key of primaryExperienceKeys)assert.equal(bookingAddonEligible(addon,[{slug:key}]),true);
 assert.equal(bookingAddonEligible(addon,[{slug:'lola-glam'},{slug:'lola-audio-guestbook'}]),false);
});
