import test from 'node:test';
import assert from 'node:assert/strict';
import {proposalAddonStatus,removeIncludedProposalAddons} from '../shared/proposal-catalog.js';
import {calculateCatalogQuote} from '../server/src/services/catalog-pricing-engine.js';
import {pricingPackageDefaults,pricingAddonDefaults,defaultPricingRules} from '../server/src/services/pricing-catalog-defaults.js';
const packages=pricingPackageDefaults().map((p,i)=>({...p,id:String(i),active:true}));
const addons=[...pricingAddonDefaults(),{name:'Premium Backdrop',price:150,pricing_policy:{key:'premium-backdrop',experiences:['glam','vogue'],category:'ENHANCEMENT'}},{name:'Additional prints',pricing_policy:{key:'extra-prints',experiences:['glam','vogue'],category:'PRINTS'}}].map((a,i)=>({...a,id:'a'+i,active:true}));
const glam=packages.find(p=>p.catalog_key==='STANDARD'&&p.tier_key==='LUXE'&&p.pricing_profile.experience==='glam');
const experiences=[{packages:[{package_id:glam.id}]}];
test('included enhancement removed; genuine additional units retained; quote calculates once',()=>{
 const backdrop=addons.find(a=>a.name==='Premium Backdrop'),creative=addons.find(a=>a.pricing_policy.key==='creative-design');
 const original=[{addon_id:backdrop.id},{addon_id:creative.id,quantity:2}];
 const remaining=removeIncludedProposalAddons(original,experiences,packages,addons);
 assert.deepEqual(remaining,[original[1]]);assert.equal(original.length,2);
 assert.match(proposalAddonStatus(backdrop,experiences,packages),/Included in selected package/);
 assert.equal(proposalAddonStatus(creative,experiences,packages),null);
 const quote=calculateCatalogQuote({version:'test',eventCategory:'PRIVATE_CELEBRATION',selections:[{packageId:glam.id,prints:500,addons:remaining.map(a=>({addonId:a.addon_id,quantity:a.quantity}))}],override:{travelAmountCents:0,reason:'Verified Chicago venue'}},{packages,addons,rules:defaultPricingRules},{admin:true});
 assert.equal(quote.serviceTotalCents,169900);assert.equal(quote.lines.filter(l=>l.type==='ADDON').length,1);assert.equal(quote.lines.filter(l=>l.type==='PRINT_UPGRADE').length,0);
 assert.equal(removeIncludedProposalAddons(remaining,experiences,packages,addons),remaining);
 assert.equal(proposalAddonStatus(backdrop,[],packages),null);
});
test('prints use total allowance control; unknown add-ons and additional units are not name-matched',()=>{
 assert.match(proposalAddonStatus(addons.at(-1),experiences,packages),/Total physical prints/);
 assert.equal(proposalAddonStatus({...addons.at(-2),pricing_policy:{key:'additional-backdrop',experiences:['glam']}},experiences,packages),null);
 const unknown=[{addon_id:'not-loaded'}];assert.equal(removeIncludedProposalAddons(unknown,experiences,[],[]),unknown);
});
