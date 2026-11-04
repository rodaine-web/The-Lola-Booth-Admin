import {query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {writeAudit} from '../middleware/audit.js';
import {AppError,notFound} from '../utils/errors.js';
import {defaultPricingRules,pricingPackageDefaults,pricingAddonDefaults} from './pricing-catalog-defaults.js';
import {calculateCatalogQuote,minorUnits} from './catalog-pricing-engine.js';
import {packageEntitlementLabels,orderedPricingPackages} from '../../../shared/package-entitlements.js';

export const pricingCatalogEnabled=()=>process.env.PRICING_CATALOG_ENABLED==='true';
export async function legacyPricingBaseline(){
 return (await query("SELECT snapshot->'legacyBaseline' AS baseline FROM pricing_catalog_versions WHERE snapshot ? 'legacyBaseline' ORDER BY version_number LIMIT 1")).rows[0]?.baseline||null;
}
export async function currentPricingCatalog(){
 const row=(await query("SELECT * FROM pricing_catalog_versions WHERE status='PUBLISHED' AND effective_at<=now() ORDER BY effective_at DESC,version_number DESC LIMIT 1")).rows[0];
 if(!row)throw new AppError('The pricing catalog is awaiting Admin approval.',409,'CATALOG_NOT_PUBLISHED');
 return row;
}
export async function publishedWebsitePricing(rows){
 const enabled=pricingCatalogEnabled(),source=enabled?(await currentPricingCatalog()).snapshot:await legacyPricingBaseline();
 if(!source)return rows;
 return rows.map(row=>{
  const agreed=source.packages.find(pkg=>pkg.id===(row.source_catalog_id||row.id));
  if(!agreed)return row;
  if(!enabled)return {...row,starting_price:agreed.starting_price,display_price:agreed.pricing_mode==='CUSTOM'?'Request Pricing':Number(agreed.starting_price),pricing_mode:agreed.pricing_mode,website_features:agreed.website_features};
  return {...row,starting_price:agreed.starting_price,display_price:agreed.pricing_mode==='CUSTOM'?'Request Pricing':Number(agreed.starting_price),pricing_mode:agreed.pricing_mode,duration:agreed.pricing_profile.rentalHours||agreed.pricing_profile.serviceHours,pricing_profile:agreed.pricing_profile,website_features:packageEntitlementLabels(agreed.pricing_profile)};
 });
}
export async function createPricingQuote(input,req){
 if(!pricingCatalogEnabled())throw new AppError('The new pricing catalog is not active.',409,'CATALOG_DISABLED');
 return transaction(async()=>{
  const version=await currentPricingCatalog();
  if(input.catalogVersion&&input.catalogVersion!==version.id)throw new AppError('Pricing changed. Reload and review the current catalog.',409,'CATALOG_VERSION_CHANGED');
  const snapshot=calculateCatalogQuote({...input,version:version.id},version.snapshot,{admin:!!req?.user});
  const saved=(await query('INSERT INTO pricing_quotes(catalog_version_id,snapshot,created_by) VALUES($1,$2,$3) RETURNING id,expires_at',[version.id,JSON.stringify(snapshot),req?.user?.id||null])).rows[0];
  if(input.override)await writeAudit({req,action:'pricing_override',entity:'pricing_quote',entityId:saved.id,after:{reason:input.override.reason,catalogKey:snapshot.catalogKey}});
  return {...snapshot,id:saved.id,expiresAt:saved.expires_at};
 });
}
export async function previewPricingQuote(input){
 if(!pricingCatalogEnabled())throw new AppError('The new pricing catalog is not active.',409,'CATALOG_DISABLED');
 const version=await currentPricingCatalog();
 if(input.catalogVersion&&input.catalogVersion!==version.id)throw new AppError('Pricing changed. Reload and review the current catalog.',409,'CATALOG_VERSION_CHANGED');
 return calculateCatalogQuote({...input,version:version.id},version.snapshot);
}
export async function publishPricingVersion(id,req,effectiveAt){
 return transaction(async()=>{
  const draft=(await query('SELECT * FROM pricing_catalog_versions WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!draft)throw notFound('Pricing version');
  if(draft.status!=='DRAFT')throw new AppError('Only draft versions can be published.',409,'CATALOG_IMMUTABLE');
  const packages=orderedPricingPackages((await query('SELECT * FROM packages WHERE catalog_key IS NOT NULL AND deleted_at IS NULL ORDER BY id FOR SHARE')).rows);
  const addons=(await query('SELECT * FROM addons WHERE pricing_policy IS NOT NULL AND deleted_at IS NULL ORDER BY id FOR SHARE')).rows;
  if(!packages.length)throw new AppError('Configure packages before publishing.',422,'CATALOG_EMPTY');
  for(const p of packages){if(!p.pricing_profile?.experience)throw new AppError('Every package requires structured inclusions.',422,'CATALOG_INVALID');if(p.pricing_mode!=='CUSTOM')minorUnits(p.starting_price);}
  const snapshot={packages,addons,rules:draft.rules,legacyBaseline:draft.snapshot?.legacyBaseline||await legacyPricingBaseline()};
  const row=(await query("UPDATE pricing_catalog_versions SET status='PUBLISHED',snapshot=$2,effective_at=$3,published_at=now(),published_by=$4 WHERE id=$1 RETURNING *",[id,JSON.stringify(snapshot),effectiveAt||new Date().toISOString(),req.user.id])).rows[0];
  await writeAudit({req,action:'pricing_catalog_published',entity:'pricing_catalog_version',entityId:id,after:{version:row.version_number,effectiveAt:row.effective_at,packageCount:packages.length}});
  return row;
 });
}

// Explicit, idempotent setup. Existing standard package IDs are retained.
// Does not publish, enable the engine, or reprice historical documents.
export async function prepareStagingPricingCatalog(req){return preparePricingCatalog(req);}
// Deployment tooling only: the public/Admin HTTP setup route remains staging-only.
export async function prepareProductionPricingCatalog(req){
 if(process.env.APP_ENV!=='production')throw new AppError('Production catalog setup requires the production environment.',403,'PRODUCTION_ONLY');
 return preparePricingCatalog(req,{production:true});
}
async function preparePricingCatalog(req,{production=false}={}){
 if(!['staging','test'].includes(process.env.APP_ENV)&&!(production&&process.env.APP_ENV==='production'))throw new AppError('Catalog setup is restricted to staging.',403,'STAGING_ONLY');
 return transaction(async client=>{
  await assertDatabaseIdentity(client);
  await query("SELECT pg_advisory_xact_lock(hashtext('lola-pricing-catalog-setup'))");
  const prepared=(await query('SELECT * FROM pricing_catalog_versions ORDER BY version_number DESC LIMIT 1')).rows[0];
  if(prepared)return prepared;
  const legacyBaseline={packages:(await query("SELECT p.id,p.experience_id,p.name,p.website_key,p.starting_price,p.currency,p.duration,p.pricing_mode,p.website_features,p.website_short_description,COALESCE((SELECT json_agg(label ORDER BY display_order) FROM package_items WHERE package_id=p.id),'[]') AS items FROM packages p JOIN experiences e ON e.id=p.experience_id WHERE p.active=true AND p.deleted_at IS NULL AND p.show_on_website=true AND p.website_status='PUBLISHED' AND e.active=true AND e.deleted_at IS NULL AND e.show_on_website=true AND e.website_status='PUBLISHED' ORDER BY p.website_display_order,p.display_order,p.id")).rows,addons:(await query('SELECT id,name,description,price,pricing_type FROM addons WHERE active=true AND deleted_at IS NULL ORDER BY created_at,id')).rows};
  const defaults=pricingPackageDefaults();
  const experiences=(await query('SELECT id,name,slug FROM experiences WHERE deleted_at IS NULL AND active=true')).rows;
  for(const pkg of defaults){
   const key=pkg.pricing_profile.experience,tier=pkg.tier_key.toLowerCase().replaceAll('_','-');
   const exp=experiences.find(e=>{const name=(e.slug||e.name||'').toLowerCase();return key==='audio'?/audio|guestbook/.test(name):name.includes(key);});
   if(!exp)throw new AppError(`Configure the ${key} experience before preparing the catalog.`,422,'EXPERIENCE_MISSING');
   const existing=(await query('SELECT id FROM packages WHERE deleted_at IS NULL AND ((catalog_key=$1 AND tier_key=$2 AND experience_id=$3) OR ($1=\'STANDARD\' AND website_key=$4)) ORDER BY created_at LIMIT 1',[pkg.catalog_key,pkg.tier_key,exp.id,`${key}:${tier}`])).rows[0];
   const features=[pkg.pricing_profile.serviceHours?`${pkg.pricing_profile.serviceHours} hours of service`:pkg.pricing_profile.rentalHours?`Up to ${pkg.pricing_profile.rentalHours} rental hours`:'Scope requires approval',`${pkg.pricing_profile.prints} physical prints included`,pkg.pricing_profile.travelMinutes?`Chicago + ${pkg.pricing_profile.travelMinutes} minutes travel coverage`:'Chicago city travel coverage'];
   if(existing)await query('UPDATE packages SET catalog_key=$2,tier_key=$3,pricing_profile=$4,starting_price=$5,website_features=$6 WHERE id=$1',[existing.id,pkg.catalog_key,pkg.tier_key,JSON.stringify(pkg.pricing_profile),pkg.starting_price,JSON.stringify(features)]);
   else await query("INSERT INTO packages(name,experience_id,starting_price,pricing_mode,catalog_key,tier_key,pricing_profile,website_features,active,show_on_website,website_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,false,'DRAFT')",[pkg.name,exp.id,pkg.starting_price,pkg.pricing_mode,pkg.catalog_key,pkg.tier_key,JSON.stringify(pkg.pricing_profile),JSON.stringify(features)]);
  }
  for(const addon of pricingAddonDefaults()){
   const existing=(await query("SELECT id FROM addons WHERE deleted_at IS NULL AND (pricing_policy->>'key'=$1 OR lower(name)=lower($2)) ORDER BY created_at LIMIT 1",[addon.pricing_policy.key,addon.name])).rows[0];
   if(existing)await query('UPDATE addons SET pricing_policy=$2,price=$3,pricing_type=$4 WHERE id=$1',[existing.id,JSON.stringify(addon.pricing_policy),addon.price,addon.pricing_type]);
   else await query('INSERT INTO addons(name,price,pricing_type,pricing_policy,active) VALUES($1,$2,$3,$4,true)',[addon.name,addon.price,addon.pricing_type,JSON.stringify(addon.pricing_policy)]);
  }
  // Preserve other enhancements as reviewable requests until explicit compatibility is approved.
  // Printing, hours and travel must use their dedicated calculations, never a second charge.
  const legacy=(await query('SELECT id,name,pricing_type FROM addons WHERE deleted_at IS NULL AND pricing_policy IS NULL')).rows;
  for(const addon of legacy){
   const label=addon.name.toLowerCase(),category=/print/.test(label)?'PRINTS':/extra.*hour|additional.*hour/.test(label)?'EXTRA_HOURS':/travel/.test(label)?'TRAVEL':'ENHANCEMENT';
   await query('UPDATE addons SET pricing_policy=$2 WHERE id=$1',[addon.id,JSON.stringify({key:/^premium backdrop$/.test(label)?'premium-backdrop':'legacy-'+addon.id,method:'CUSTOM',category,experiences:/backdrop/.test(label)?['glam','vogue']:['glam','360','vogue','audio'],minQuantity:1,maxQuantity:['PER_UNIT','PER_HOUR','PER_GUEST'].includes(addon.pricing_type)?24:1,approvalRequired:true,resources:[]})]);
  }
  const draft=(await query("INSERT INTO pricing_catalog_versions(rules,created_by,snapshot) VALUES($1,$2,$3) RETURNING *",[JSON.stringify(defaultPricingRules),req.user.id,JSON.stringify({legacyBaseline})])).rows[0];
  await writeAudit({req,action:'pricing_catalog_prepared',entity:'pricing_catalog_version',entityId:draft.id,after:{packageCount:defaults.length,environment:process.env.APP_ENV}});
  return draft;
 });
}
