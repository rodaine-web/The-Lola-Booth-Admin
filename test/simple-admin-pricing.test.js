import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCatalogQuote} from '../server/src/services/catalog-pricing-engine.js';
import {pricingPackageDefaults,pricingAddonDefaults,defaultPricingRules} from '../server/src/services/pricing-catalog-defaults.js';
import {proposalAddonStatus,removeIncludedProposalAddons} from '../shared/proposal-catalog.js';
const packages=pricingPackageDefaults().map((p,i)=>({...p,id:String(i),active:true}));
const addons=pricingAddonDefaults().map((a,i)=>({...a,id:'a'+i,active:true}));
const catalog={packages,addons,rules:defaultPricingRules};
const pkg=packages.find(p=>p.catalog_key==='ACTIVATION'&&p.tier_key==='CAMPAIGN'&&p.pricing_profile.experience==='360');
const addon=addons.find(a=>a.pricing_policy.key==='attendant');
const input={eventCategory:'ACTIVATION',customerType:'BUSINESS',selections:[{packageId:pkg.id,addons:[{addonId:addon.id,quantity:1}]}]};
test('Admin saved Campaign and add-on prices calculate without approval, scope or routing',()=>{
 const result=calculateCatalogQuote(input,catalog,{admin:true,simpleAdmin:true});
 assert.equal(result.status,'PRICED');assert.deepEqual(result.reviewReasons,[]);assert.equal(result.serviceTotalCents,304900);assert.equal(result.travel.amountCents,0);
 const changed=calculateCatalogQuote({...input,discountCents:10000,override:{travelAmountCents:17500,packagePrices:[{packageId:pkg.id,amountCents:280000}],addonApprovals:[{packageId:pkg.id,addonId:addon.id,unitPriceCents:7500}]}},catalog,{admin:true,simpleAdmin:true});
 assert.equal(changed.serviceTotalCents,295000);assert.equal(changed.status,'PRICED');assert.equal(changed.travel.amountCents,17500);
 assert.equal(changed.lines.find(l=>l.type==='ADDON').description,addon.name);
});
test('public estimates cannot opt into Admin manual-pricing behavior',()=>{
 const result=calculateCatalogQuote(input,catalog,{simpleAdmin:true});
 assert.equal(result.status,'REVIEW_REQUIRED');assert.match(result.reviewReasons.join(' '),/approval|review/);assert.equal(result.travel.amountCents,null);
});
test('custom packages need a price, no artificial scope approval',()=>{
 const custom=packages.find(p=>p.pricing_profile.quoteRequired);
 const request={eventCategory:'CUSTOM_PRODUCTION',catalogKey:'CUSTOM',selections:[{packageId:custom.id}]};
 assert.throws(()=>calculateCatalogQuote(request,catalog,{admin:true,simpleAdmin:true}),/positive agreed custom-production price/);
 const quote=calculateCatalogQuote({...request,override:{packagePrices:[{packageId:custom.id,amountCents:350000}]}},catalog,{admin:true,simpleAdmin:true});
 assert.equal(quote.status,'PRICED');assert.equal(quote.serviceTotalCents,350000);
});
test('campaign inclusions are disabled while additional units and manual travel stay distinct',()=>{
 const selected=[{packages:[{campaign_id:'campaign',name:'Summer event',features:['Premium Backdrop']}]}];
 const backdrop={id:'backdrop',name:'Premium Backdrop',pricing_policy:{key:'premium-backdrop',category:'ENHANCEMENT',experiences:['glam']}};
 assert.match(proposalAddonStatus(backdrop,selected,[]),/Included in selected campaign/);
 assert.deepEqual(removeIncludedProposalAddons([{addon_id:'backdrop'}],selected,[],[backdrop]),[]);
 assert.equal(proposalAddonStatus({...backdrop,name:'Additional backdrop',pricing_policy:{...backdrop.pricing_policy,key:'extra-backdrop'}},selected,[]),null);
 assert.match(proposalAddonStatus({pricing_policy:{category:'TRAVEL'}},selected,[]),/Travel charge/);
});
