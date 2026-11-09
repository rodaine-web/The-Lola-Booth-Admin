import {query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {currentPricingCatalog,publishPricingVersion} from './pricing-catalog-service.js';
import {writeAudit} from '../middleware/audit.js';
import {AppError} from '../utils/errors.js';
const key='staging-audio-per-event-enclosures-2026-11-09';
export async function updateStagingAudioRental({apply=false,expectedVersion,inventoryIds=[],req}){
 if(!['staging','test'].includes(process.env.APP_ENV))throw new AppError('Staging only.',403,'STAGING_ONLY');
 return transaction(async client=>{
  await assertDatabaseIdentity(client);await query('SELECT pg_advisory_xact_lock(7811051)');
  const prior=(await query('SELECT after_json FROM audit_logs WHERE action=$1 ORDER BY created_at DESC LIMIT 1',[key])).rows[0];if(prior)return {alreadyApplied:true,...prior.after_json};
  const current=await currentPricingCatalog();
  if(apply&&(expectedVersion!==current.id||!req?.user?.id))throw new AppError('Review the current staging version before applying.',409,'CATALOG_VERSION_CHANGED');
  if((await query("SELECT FROM pricing_catalog_versions WHERE status='DRAFT'")).rowCount)throw new AppError('Review the existing pricing draft first.',409,'DRAFT_EXISTS');
  const before={packages:(await query('SELECT * FROM packages WHERE deleted_at IS NULL')).rows,addons:(await query('SELECT * FROM addons WHERE deleted_at IS NULL')).rows};
  const rental=before.packages.find(p=>p.active&&p.catalog_key==='STANDARD'&&p.pricing_profile?.experience==='audio');if(!rental)throw Error('Existing Audio standalone rental not found');
  const inventory=(await query("SELECT id,name,category,status FROM equipment WHERE deleted_at IS NULL AND (inventory_pool='AUDIO_GUESTBOOK' OR name~*'audio.*phone|audio.*guest.*book') ORDER BY name")).rows;
  const result={expectedVersion:current.id,standalone:299,addon:249,pricingBasis:'PER_EVENT',enclosures:{inflatable:199,premium:299},inventory};
  if(!apply)return {dryRun:true,...result};
  if(!inventoryIds.length||inventoryIds.some(id=>!inventory.some(x=>x.id===id)))throw Error('Choose reviewed existing Audio inventory units.');
  before.experience=(await query('SELECT * FROM experiences WHERE id=$1',[rental.experience_id])).rows[0];before.inventory=inventory;
  const profile={...rental.pricing_profile,tier:'Standalone Rental',perEventRental:true,inventoryPool:'AUDIO_GUESTBOOK',serviceHours:null,rentalHours:null,startingAt:false,quoteRequired:false,deliveryApprovalRequired:false,featureLabels:['Flat rental fee per event','One Audio Guestbook recording phone','Personalized audio greeting','Guest audio recordings','Local drop-off/pickup or shipping with return shipping','Delivery fees quoted separately when applicable']};
  await query("UPDATE packages SET name='Audio Guest Book — Standalone Rental',tier_key='RENTAL',pricing_profile=$2,starting_price=299,duration=NULL,included_hours=NULL,website_features=$3,description='Flat $299 per event. Local drop-off/pickup or shipping with return shipping. Delivery fees are quoted separately when applicable.',website_short_description='Flat $299 per event; delivery fees separate.',updated_at=now() WHERE id=$1",[rental.id,JSON.stringify(profile),JSON.stringify(profile.featureLabels)]);
  await query("UPDATE packages SET active=false,show_on_website=false,website_status='ARCHIVED',updated_at=now() WHERE experience_id=$1 AND id<>$2",[rental.experience_id,rental.id]);
  await query("UPDATE experiences SET default_duration=NULL,description='Audio Guestbook rental: flat $299 per event; delivery fees separate. Also available as a $249 add-on.',website_short_description='Flat $299 per event, or $249 alongside a booth experience. Delivery fees separate.',updated_at=now() WHERE id=$1",[rental.experience_id]);
  const audio=before.addons.find(a=>a.pricing_policy?.key==='audio-guestbook');if(!audio)throw Error('Audio add-on not found');
  await query("UPDATE addons SET price=249,description='Flat $249 when booked with Glam, Magic Mirror, 360 or Vogue. Delivery fees quoted separately when applicable.',pricing_policy=$2,updated_at=now() WHERE id=$1",[audio.id,JSON.stringify({...audio.pricing_policy,resources:['AUDIO_GUESTBOOK']})]);
  for(const [slug,name,price,description]of [['inflatable-enclosure','Inflatable enclosure',199,'Inflatable enclosure for The Lola Glam.'],['premium-enclosure','Premium enclosure (pipes and drapes)',299,'Premium pipe-and-drape enclosure for The Lola Glam.']]){
   const existing=before.addons.find(a=>a.pricing_policy?.key===slug||a.name.toLowerCase()===name.toLowerCase());
   const policy={key:slug,method:'FIXED',category:'ENHANCEMENT',experiences:['glam'],minQuantity:1,maxQuantity:1,approvalRequired:false,resources:[]};
   if(existing)await query("UPDATE addons SET name=$2,price=$3,description=$4,pricing_type='FIXED',pricing_policy=$5,active=true,updated_at=now() WHERE id=$1",[existing.id,name,price,description,JSON.stringify(policy)]);
   else await query("INSERT INTO addons(name,price,description,pricing_type,pricing_policy,active) VALUES($1,$2,$3,'FIXED',$4,true)",[name,price,description,JSON.stringify(policy)]);
  }
  await query("UPDATE equipment SET inventory_pool='AUDIO_GUESTBOOK',updated_at=now() WHERE id=ANY($1::uuid[])",[inventoryIds]);
  const draft=(await query('INSERT INTO pricing_catalog_versions(rules,created_by) VALUES($1,$2) RETURNING id',[JSON.stringify(current.rules),req.user.id])).rows[0];const version=await publishPricingVersion(draft.id,req);
  const after={...result,version:version.id,versionNumber:version.version_number,inventoryIds};await writeAudit({req,action:key,entity:'pricing_catalog_version',entityId:version.id,before,after});return after;
 });
}
