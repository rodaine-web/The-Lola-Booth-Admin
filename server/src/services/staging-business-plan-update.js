import {approvedRedesignEnvironment} from './approved-redesign-release.js';
import {query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {currentPricingCatalog,publishPricingVersion} from './pricing-catalog-service.js';
import {writeAudit} from '../middleware/audit.js';
import {businessPackageDefinitions,businessDiscounts} from '../../../shared/business-plans.js';
import {experienceNames} from '../../../shared/experience-catalog.js';
const action='staging-approved-business-plans-2026-11-09';
export async function updateStagingBusinessPlans({apply=false,expectedVersion,req,productionApproval}){
 if(!approvedRedesignEnvironment(productionApproval))throw Error('Staging only');
 return transaction(async client=>{
  await assertDatabaseIdentity(client);await query('SELECT pg_advisory_xact_lock(7811051)');
  const prior=(await query('SELECT after_json FROM audit_logs WHERE action=$1 ORDER BY created_at DESC LIMIT 1',[action])).rows[0];if(prior)return {alreadyApplied:true,...prior.after_json};
  const current=await currentPricingCatalog(),definitions=businessPackageDefinitions();
  const summary={expectedVersion:current.id,plans:definitions,discounts:businessDiscounts,public:false};
  if(!apply)return {dryRun:true,...summary};
  if(expectedVersion!==current.id||!req?.user?.id)throw Error('Review current version and audited actor before applying');
  if((await query("SELECT FROM pricing_catalog_versions WHERE status='DRAFT'")).rowCount)throw Error('Review existing pricing draft first');
  const before={packages:(await query('SELECT * FROM packages WHERE deleted_at IS NULL')).rows,items:(await query('SELECT * FROM package_items')).rows,addons:(await query('SELECT * FROM addons WHERE deleted_at IS NULL')).rows};
  const experiences=(await query('SELECT * FROM experiences WHERE active=true AND deleted_at IS NULL')).rows;
  const ids=[];
  for(const item of definitions){
   const exp=experiences.find(x=>String(x.slug).includes(item.key));if(!exp)throw Error('Missing experience '+item.key);
   const old=before.packages.find(p=>p.experience_id===exp.id&&p.catalog_key===item.catalog&&p.tier_key===item.tier);
   const base=before.packages.find(p=>p.experience_id===exp.id&&p.pricing_profile)?.pricing_profile;if(!base)throw Error('Missing structured base profile');
   const profile={...base,experience:item.key,tier:item.name,businessPlan:true,includedExperiences:item.included,serviceHours:item.hours,rentalHours:null,perEventRental:false,prints:item.prints,quoteRequired:false,startingAt:false,deliveryApprovalRequired:false,extraHourCents:null,featureLabels:item.features,includedAddonKeys:[...(item.tier!=='EVENT'?['branded-sharing']:[]),...(['ACTIVATION','CAMPAIGN'].includes(item.tier)?['engagement-report']:[])],enclosure:item.key==='vogue',attendantIncluded:true,digitalSessionsUnlimited:true,digitalSharing:true,designs:null,backdrop:item.key==='360'?null:item.tier==='EVENT'||item.tier==='EVENT_PLUS'?'STANDARD':null,reporting:['ACTIVATION','CAMPAIGN'].includes(item.tier)?'STANDARD':null};
   const name=experienceNames[item.key]+' — '+item.name;
   const args=[name,exp.id,item.price,item.hours,item.catalog,item.tier,JSON.stringify(profile),JSON.stringify(item.features)];
   const sql="name=$1,experience_id=$2,starting_price=$3,included_hours=$4::numeric,duration=$4::integer,catalog_key=$5,tier_key=$6,pricing_profile=$7,website_features=$8,description=$1,proposal_description=$1,pricing_mode='STARTING',active=true,show_on_website=false,website_status='DRAFT',most_popular=false,updated_at=now()";
   const row=old?(await query('UPDATE packages SET '+sql+' WHERE id=$9 RETURNING id',[...args,old.id])).rows[0]:(await query("INSERT INTO packages(name,experience_id,starting_price,included_hours,duration,catalog_key,tier_key,pricing_profile,website_features,description,proposal_description,pricing_mode,active,show_on_website,website_status) VALUES($1,$2,$3,$4::numeric,$4::integer,$5,$6,$7,$8,$1,$1,'STARTING',true,false,'DRAFT') RETURNING id",args)).rows[0];ids.push(row.id);
   await query('DELETE FROM package_items WHERE package_id=$1',[row.id]);
   for(const [index,label]of item.features.entries())await query('INSERT INTO package_items(package_id,label,display_order) VALUES($1,$2,$3)',[row.id,label,index]);
  }
  await query("UPDATE packages SET active=false,show_on_website=false,website_status='ARCHIVED',updated_at=now() WHERE catalog_key IN ('PROFESSIONAL','ACTIVATION') AND NOT (id=ANY($1::uuid[]))",[ids]);
  const rules={...current.rules,businessPlans:{discounts:businessDiscounts,approvedCoverage:true,approvedPrints:true,approvedFeatures:true,paymentDueDays:14}};
  const draft=(await query('INSERT INTO pricing_catalog_versions(rules,created_by) VALUES($1,$2) RETURNING id',[JSON.stringify(rules),req.user.id])).rows[0];const version=await publishPricingVersion(draft.id,req,(await query('SELECT transaction_timestamp() t')).rows[0].t);
  const after={...summary,packageIds:ids,version:version.id,versionNumber:version.version_number};await writeAudit({req,action,entity:'pricing_catalog_version',entityId:version.id,before,after});return after;
 });
}
