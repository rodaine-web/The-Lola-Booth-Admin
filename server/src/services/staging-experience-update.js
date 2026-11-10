import {approvedRedesignEnvironment} from './approved-redesign-release.js';
import {query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {writeAudit} from '../middleware/audit.js';
import {currentPricingCatalog,publishPricingVersion} from './pricing-catalog-service.js';
import {saveStagingRecord} from './staging-cms-service.js';
import {primaryExperienceKeys,experienceNames,celebrationPrices,celebrationFeatures,customExperienceFeatures} from '../../../shared/experience-catalog.js';
import {packageEntitlementLabels} from '../../../shared/package-entitlements.js';
import {AppError} from '../utils/errors.js';

export const stagingExperienceUpdateKey='staging-experiences-magic-mirror-2026-11-09';
export async function updateStagingExperiences({apply=false,expectedVersion,req,productionApproval}) {
 if(!approvedRedesignEnvironment(productionApproval))throw new AppError('This catalogue update is staging-only.',403,'STAGING_ONLY');
 return transaction(async client=>{
  await assertDatabaseIdentity(client);
  await query("SELECT pg_advisory_xact_lock(hashtext($1))",[stagingExperienceUpdateKey]);
  const current=await currentPricingCatalog();
  const prior=(await query("SELECT after_json FROM audit_logs WHERE action=$1 ORDER BY created_at DESC LIMIT 1",[stagingExperienceUpdateKey])).rows[0];
  if(prior)return {alreadyApplied:true,...prior.after_json};
  if(apply&&(!expectedVersion||expectedVersion!==current.id))throw new AppError('Review the current pricing version before applying.',409,'CATALOG_VERSION_CHANGED');
  if(apply&&!req?.user?.id)throw new AppError('An audited Admin actor is required.',403,'ADMIN_REQUIRED');
  if((await query("SELECT id FROM pricing_catalog_versions WHERE status='DRAFT'")).rowCount)throw new AppError('An existing pricing draft must be reviewed first.',409,'DRAFT_EXISTS');
  const before={experiences:(await query('SELECT * FROM experiences WHERE deleted_at IS NULL ORDER BY display_order')).rows,packages:(await query('SELECT * FROM packages WHERE deleted_at IS NULL')).rows,addons:(await query('SELECT * FROM addons WHERE deleted_at IS NULL')).rows,cms:(await query("SELECT * FROM website_channel_records WHERE channel='STAGING' AND cms_type IN ('experiences','packages')")).rows,version:current.id};
  const identity=row=>String(row.slug||row.name).toLowerCase();
  const experienceFor=key=>before.experiences.find(x=>key==='audio'?/audio|guestbook/.test(identity(x)):identity(x).includes(key));
  for(const key of ['glam','360','vogue','audio'])if(!experienceFor(key))throw new Error('Missing existing experience: '+key);
  const standard=(key,tier)=>before.packages.find(x=>x.catalog_key==='STANDARD'&&x.pricing_profile?.experience===key&&x.tier_key===tier);
  for(const tier of ['ESSENTIAL','SIGNATURE','LUXE'])if(!standard('glam',tier))throw new Error('Missing Glam print reference');
  const summary={expectedVersion:current.id,order:primaryExperienceKeys.map(k=>experienceNames[k]),prices:celebrationPrices,printAllowances:{glam:[0,standard('glam','SIGNATURE').pricing_profile.prints,standard('glam','LUXE').pricing_profile.prints],mirror:[0,standard('glam','SIGNATURE').pricing_profile.prints,standard('glam','LUXE').pricing_profile.prints],vogue:[0,0,standard('vogue','LUXE').pricing_profile.prints]},audio:{standaloneFrom:299,addon:249,rentalHours:standard('audio','ESSENTIAL').pricing_profile.rentalHours,logisticsIncluded:false},existingAddonCount:before.addons.length};
  if(!apply)return {dryRun:true,...summary,before};
  const descriptions={glam:'A modern, professional DSLR photo booth experience that delivers stunning, high-quality photos for any celebration.','360':'A cinematic 360° video experience that brings your event to life.',mirror:'An interactive, full-length mirror experience that wows your guests with photos, animations and more.',vogue:'A fashion-forward, editorial experience inspired by iconic magazine shoots.'};
  const ids={};
  for(const [index,key] of primaryExperienceKeys.entries()){
   const existing=experienceFor(key);
   const values=[experienceNames[key],descriptions[key],celebrationPrices[key][0],index+1];
   const row=existing?(await query("UPDATE experiences SET name=$1,website_name=$1,description=$2,website_short_description=$2,base_price=$3,display_order=$4,default_duration=2,active=true,show_on_website=true,website_status='PUBLISHED',updated_at=now() WHERE id=$5 RETURNING *",[...values,existing.id])).rows[0]:(await query("INSERT INTO experiences(name,website_name,description,website_short_description,base_price,display_order,default_duration,slug,active,show_on_website,website_status) VALUES($1,$1,$2,$2,$3,$4,2,$5,true,true,'PUBLISHED') RETURNING *",[...values,'lola-magic-mirror'])).rows[0];ids[key]=row.id;
   const old=before.cms.find(x=>x.cms_type==='experiences'&&(x.payload.source_catalog_id===row.id||String(x.entity_key).includes(key)));
   const payload={...(old?.payload||{}),key,name:row.name,slug:row.slug,source_catalog_id:row.id,description:descriptions[key],short_description:descriptions[key],home_description:descriptions[key]};
   // Never reuse an Audio image as a Mirror photo. The redesign can add the approved equipment asset.
   await saveStagingRecord('experiences',{channel:'STAGING',entity_key:old?.entity_key||key,payload,status:'PUBLISHED',display_order:index+1},req.user,old?.id);
  }
  const audio=experienceFor('audio');ids.audio=audio.id;
  await query("UPDATE experiences SET name='Audio Guest Book',website_name='Audio Guest Book',description='Standalone rental from $299. Logistics and delivery are quoted separately.',website_short_description='Standalone rental from $299; logistics and delivery excluded.',website_label='Standalone rental',base_price=299,display_order=100,show_on_website=true,updated_at=now() WHERE id=$1",[audio.id]);
  const audioCms=before.cms.filter(x=>x.cms_type==='experiences'&&(x.payload.source_catalog_id===audio.id||/audio|guestbook/i.test(x.entity_key)));
  for(const old of audioCms)await saveStagingRecord('experiences',{channel:'STAGING',entity_key:old.entity_key,payload:old.payload,status:'ARCHIVED',display_order:100},req.user,old.id);
  const addonKeys=names=>before.addons.filter(x=>names.includes(x.name.toLowerCase())).map(x=>x.pricing_policy?.key).filter(Boolean);
  const savedPackages=[];
  for(const [experienceIndex,key] of primaryExperienceKeys.entries())for(const [index,tier] of ['ESSENTIAL','SIGNATURE','LUXE','CUSTOM'].entries()){
   const custom=tier==='CUSTOM',existing=standard(key,tier)||before.packages.find(x=>x.experience_id===ids[key]&&x.website_key===key+':custom'&&(x.catalog_key==='STANDARD'||x.catalog_key==null));
   const base=existing?.pricing_profile||standard('glam',custom?'ESSENTIAL':tier).pricing_profile;
   const prints=custom?0:summary.printAllowances[key]?.[index]||0;
   const included=new Set(base.includedAddonKeys||[]);
   if(['glam','mirror'].includes(key)&&index>0&&!custom)included.add('premium-backdrop');
   if(index>0&&!custom)for(const k of addonKeys(['branding']))included.add(k);
   if(key==='mirror'&&index===2)for(const k of addonKeys(['rush delivery']))included.add(k);
   if(['360','vogue'].includes(key)&&index===2)included.add('red-carpet');
   const profile={...base,experience:key,tier:custom?'Custom':tier[0]+tier.slice(1).toLowerCase(),serviceHours:custom?null:[2,4,6][index],rentalHours:null,prints,quoteRequired:custom,startingAt:false,attendantIncluded:!custom,digitalSessionsUnlimited:!custom,digitalSharing:!custom,backdrop:['glam','mirror'].includes(key)&&!custom?(index?'PREMIUM':'STANDARD'):null,enclosure:key==='vogue',customGreeting:false,audioStyle:null,phones:null,audioDeliveryTargetDays:null,deliveryApprovalRequired:false,extraHourCents:key==='mirror'?null:base.extraHourCents,includedAddonKeys:custom?[]:[...included],featureLabels:custom?customExperienceFeatures:celebrationFeatures(key,index)};
   const features=packageEntitlementLabels(profile),name=experienceNames[key]+' — '+profile.tier,price=custom?null:String(celebrationPrices[key][index])+'.00',order=experienceIndex*10+index+1;
   const fields=[ids[key],name,price,custom?'CUSTOM':'STARTING',JSON.stringify(profile),tier,order,JSON.stringify(features),key+':'+tier.toLowerCase(),index===1];
   let row;
   if(existing)row=(await query("UPDATE packages SET experience_id=$1,name=$2,starting_price=$3,pricing_mode=$4,pricing_profile=$5,tier_key=$6,display_order=$7,website_display_order=$7,website_features=$8,website_key=$9,most_popular=$10,active=true,show_on_website=true,website_status='PUBLISHED',catalog_key='STANDARD',duration=$11::integer,included_hours=$11::integer,proposal_description=$12,updated_at=now() WHERE id=$13 RETURNING *",[...fields,profile.serviceHours,features.join('\n'),existing.id])).rows[0];
   else row=(await query("INSERT INTO packages(experience_id,name,starting_price,pricing_mode,pricing_profile,tier_key,display_order,website_display_order,website_features,website_key,most_popular,active,show_on_website,website_status,catalog_key,duration,included_hours,proposal_description) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,true,true,'PUBLISHED','STANDARD',$11::integer,$11::integer,$12) RETURNING *",[...fields,profile.serviceHours,features.join('\n')])).rows[0];
   await query('DELETE FROM package_items WHERE package_id=$1',[row.id]);for(const [i,label]of features.entries())await query('INSERT INTO package_items(package_id,label,display_order) VALUES($1,$2,$3)',[row.id,label,i]);
   savedPackages.push(row.id);
   const old=before.cms.find(x=>x.cms_type==='packages'&&(x.payload.source_catalog_id===row.id||x.entity_key===row.website_key));
   await saveStagingRecord('packages',{channel:'STAGING',entity_key:old?.entity_key||row.website_key,payload:{...(old?.payload||{}),name:row.name,experience:key,experience_key:key,source_catalog_id:row.id,experience_id:ids[key],website_key:row.website_key,starting_price:row.starting_price,pricing_mode:row.pricing_mode,website_features:features,features,most_popular:row.most_popular,duration:row.duration},status:'PUBLISHED',display_order:order},req.user,old?.id);
  }
  const rental=standard('audio','ESSENTIAL');
  const audioFeatures=['Up to {hours} rental hours','One recording phone','Personalized audio greeting','Guest audio recordings','Rental from $299; logistics and delivery quoted separately'];
  await query("UPDATE packages SET name='Audio Guest Book — Standalone Rental',starting_price=299,most_popular=false,active=true,show_on_website=true,website_status='PUBLISHED',pricing_profile=$2,website_features=$3,description='Rental only. Logistics and delivery are quoted separately.',updated_at=now() WHERE id=$1",[rental.id,JSON.stringify({...rental.pricing_profile,startingAt:true,featureLabels:audioFeatures}),JSON.stringify(packageEntitlementLabels({...rental.pricing_profile,featureLabels:audioFeatures}))]);
  await query("UPDATE packages SET active=false,show_on_website=false,website_status='ARCHIVED',updated_at=now() WHERE experience_id=$1 AND (catalog_key='STANDARD' OR catalog_key IS NULL) AND id<>$2",[audio.id,rental.id]);
  for(const old of before.cms.filter(x=>x.cms_type==='packages'&&(/audio/i.test(x.entity_key)||x.payload.experience_id===audio.id)))await saveStagingRecord('packages',{channel:'STAGING',entity_key:old.entity_key,payload:old.payload,status:'ARCHIVED',display_order:100},req.user,old.id);
  const audioAddon=before.addons.find(x=>/audio\s*guest\s*book/i.test(x.name)&&!/additional|extra|phone|styled/i.test(x.name));
  if(!audioAddon)throw new Error('Existing Audio Guest Book add-on not found; refusing to create duplicate.');
  for(const addon of before.addons){
   let policy={...addon.pricing_policy};
   if(!policy.key)throw new Error('An add-on is not configured; review first.');
   if(policy.category!=='EXTRA_HOURS'&&policy.experiences?.some(k=>['glam','vogue'].includes(k))&&!policy.experiences.includes('mirror'))policy.experiences=[...policy.experiences,'mirror'];
   if(addon.id===audioAddon.id)policy={...policy,key:'audio-guestbook',method:'FIXED',category:'ENHANCEMENT',experiences:primaryExperienceKeys,minQuantity:1,maxQuantity:1,approvalRequired:false};
   await query('UPDATE addons SET pricing_policy=$2,price=$3,pricing_type=$4,name=$5,updated_at=now() WHERE id=$1',[addon.id,JSON.stringify(policy),addon.id===audioAddon.id?'249.00':addon.price,addon.id===audioAddon.id?'FIXED':addon.pricing_type,addon.id===audioAddon.id?'Audio Guest Book':addon.name]);
  }
  const afterAddons=(await query('SELECT id,price FROM addons WHERE deleted_at IS NULL')).rows;
  if(afterAddons.length!==before.addons.length||afterAddons.some(x=>x.id!==audioAddon.id&&String(x.price)!==String(before.addons.find(a=>a.id===x.id)?.price)))throw new Error('Unexpected change to existing add-ons.');
  const rules={...current.rules,printPrices:{...current.rules.printPrices,mirror:{...current.rules.printPrices.glam}}};
  const draft=(await query('INSERT INTO pricing_catalog_versions(rules,created_by) VALUES($1,$2) RETURNING *',[JSON.stringify(rules),req.user.id])).rows[0];
  const published=await publishPricingVersion(draft.id,req,(await query('SELECT transaction_timestamp() t')).rows[0].t);
  const result={...summary,version:published.id,versionNumber:published.version_number,experienceIds:ids,packageIds:savedPackages,audioAddonId:audioAddon.id};
  await writeAudit({req,action:stagingExperienceUpdateKey,entity:'pricing_catalog_version',entityId:published.id,before,after:result});
  return result;
 });
}
