import {query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {writeAudit} from '../middleware/audit.js';
import {currentPricingCatalog,publishPricingVersion} from './pricing-catalog-service.js';
import {pricingPackageDefaults} from './pricing-catalog-defaults.js';
const action='business-virtual-retail-catalog-20261119';
export const virtualRates=[['DAY','24 Hours',349],['THREE_DAYS','3 Days',699],['WEEK','1 Week',999],['MONTHLY','Monthly Subscription',499]];
export const retailRates=[['strip-one','One 2×6 photo strip',5,'2X6','ONSITE',1],['strip-two','Two identical 2×6 strips',8,'2X6','ONSITE',2],['print-one','One 4×6 photo print',7,'4X6','ONSITE',1],['print-two','Two 4×6 photo prints',12,'4X6','ONSITE',2],['postcard-one','One personalized 4×6 postcard mailed within the US',10,'4X6','US_MAIL',1],['postcard-two','Two 4×6 postcards mailed to different US addresses',18,'4X6','US_MAIL',2]];
export async function updateStagingBusinessCatalog({apply=false,expectedVersion,req}){
 if(!['staging','test'].includes(process.env.APP_ENV))throw Error('Staging only. Production promotion requires a separately approved release.');
 return transaction(async client=>{
  await assertDatabaseIdentity(client);await query("SELECT pg_advisory_xact_lock(hashtext($1))",[action]);
  const prior=(await query('SELECT after_json FROM audit_logs WHERE action=$1 ORDER BY created_at DESC LIMIT 1',[action])).rows[0];if(prior)return {alreadyApplied:true,...prior.after_json};
  const current=await currentPricingCatalog();if(!apply)return {dryRun:true,expectedVersion:current.id,virtualRates,retailRates};
  if(expectedVersion!==current.id)throw Error('Review the current published catalog before applying changes.');
  const drafts=(await query("SELECT id FROM pricing_catalog_versions WHERE status='DRAFT'")).rows;
  if(drafts.length)throw Error('An existing pricing draft needs review before this catalog update can be published.');
  for(const [table,items,fields] of [['packages',current.snapshot.packages,['name','starting_price','pricing_profile','active']],['addons',current.snapshot.addons,['name','price','pricing_policy','active']]]){
   const rows=(await query(`SELECT * FROM ${table} WHERE deleted_at IS NULL AND ${table==='packages'?'catalog_key':'pricing_policy'} IS NOT NULL ORDER BY id FOR UPDATE`)).rows;
   if(rows.length!==items.length)throw Error('Unpublished catalog entries require review before applying this update.');
   for(const saved of items){const row=rows.find(r=>r.id===saved.id);if(!row||fields.some(f=>JSON.stringify(row[f])!==JSON.stringify(saved[f])))throw Error('Unpublished catalog edits require review before applying this update.');}
  }
  let exp=(await query("SELECT id FROM experiences WHERE deleted_at IS NULL AND (slug='virtual' OR lower(name) LIKE '%virtual%') ORDER BY created_at LIMIT 1")).rows[0];
  if(!exp)exp=(await query("INSERT INTO experiences(name,slug,website_name,website_short_description,default_duration,active,show_on_website,website_status) VALUES('The Lola Virtual Booth','virtual','The Lola Virtual Booth','A branded digital photo experience on a phone or computer.',24,true,true,'PUBLISHED') RETURNING id")).rows[0];
  const base=pricingPackageDefaults()[0].pricing_profile;
  for(const [duration,label,price] of virtualRates){
   const virtual={duration,participantAllowance:null,activeExperiences:null,customTemplates:null,branding:'Scope confirmed in the proposal',creativeWork:'Quoted separately',support:'Requirements confirmed in the proposal',usageUnit:'session',additionalUsageCents:null,setupFeeCents:duration==='MONTHLY'?49900:0,minimumMonths:duration==='MONTHLY'?3:1,minimumIsProposed:true,startDate:null,renewalDate:null};
   const profile={...base,experience:'virtual',businessPlan:false,tier:label,serviceHours:null,rentalHours:null,prints:0,travelMinutes:0,extraHourCents:null,designs:null,musicSelections:null,galleryDays:null,customGreeting:false,audioStyle:null,phones:null,audioDeliveryTargetDays:null,reporting:null,attendantIncluded:false,digitalSessionsUnlimited:false,backdrop:null,enclosure:false,includedAddonKeys:[],startingAt:true,quoteRequired:true,deliveryApprovalRequired:true,featureLabels:['Branded digital photo experience','Access by QR code or link','Digital photo sharing','Session allowances and active branded experiences require an agreed scope',...(duration==='MONTHLY'?['Monthly recurring service; proposed three-month minimum; setup charged separately']:[])],virtual};
   const existing=(await query('SELECT id FROM packages WHERE experience_id=$1 AND tier_key=$2 AND deleted_at IS NULL',[exp.id,'VIRTUAL_'+duration])).rows[0];
   if(existing)await query('UPDATE packages SET starting_price=$2 WHERE id=$1',[existing.id,price]);
   else await query("INSERT INTO packages(name,experience_id,starting_price,pricing_mode,catalog_key,tier_key,pricing_profile,active,show_on_website,website_status) VALUES($1,$2,$3,'CUSTOM','PROFESSIONAL',$4,$5,true,false,'DRAFT')",['Virtual Booth — '+label,exp.id,price,'VIRTUAL_'+duration,JSON.stringify(profile)]);
  }
  for(const [key,name,price,format,delivery,quantity] of retailRates){
   const policy={key:'retail-'+key,method:'FIXED',category:'RETAIL',experiences:['glam','mirror','vogue'],minQuantity:1,maxQuantity:1,approvalRequired:true,resources:[],internalOnly:true,eventAuthorizationRequired:true,retail:{format,delivery,quantity,distinctAddresses:delivery==='US_MAIL'&&quantity===2}};
   const existing=(await query("SELECT id FROM addons WHERE pricing_policy->>'key'=$1 AND deleted_at IS NULL",[policy.key])).rows[0];
   if(existing)await query('UPDATE addons SET price=$2 WHERE id=$1',[existing.id,price]);
   else await query("INSERT INTO addons(name,description,price,pricing_type,pricing_policy,active) VALUES($1,'Retail rate only. Explicit event authorization is required; no guest sales are enabled by this catalog entry.',$2,'FIXED',$3,true)",[name,price,JSON.stringify(policy)]);
  }
  const draft=(await query('INSERT INTO pricing_catalog_versions(rules,created_by) VALUES($1,$2) RETURNING id',[JSON.stringify(current.rules),req.user.id])).rows[0];
  const version=await publishPricingVersion(draft.id,req);
  const result={versionId:version.id,versionNumber:version.version_number,virtualPackages:4,retailRates:6};
  await writeAudit({req,action,entity:'pricing_catalog_version',entityId:version.id,before:{versionId:current.id},after:result});return result;
 });
}
