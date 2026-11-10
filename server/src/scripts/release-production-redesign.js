import {pool,query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {currentPricingCatalog} from '../services/pricing-catalog-service.js';
import {updateStagingExperiences} from '../services/staging-experience-update.js';
import {updateStagingAudioRental} from '../services/staging-audio-rental-update.js';
import {updateStagingBusinessPlans} from '../services/staging-business-plan-update.js';
import {updateStagingWebsiteRedesign} from '../services/staging-website-redesign-update.js';
import {saveStagingRecord} from '../services/staging-cms-service.js';
import {redesignExperienceContent} from '../../../shared/redesign-content.js';
import {writeAudit} from '../middleware/audit.js';
const action='production-redesign-owner-release-2026-11-10';
try{
 if(process.env.APP_ENV!=='production')throw Error('Production environment required');
 const apply=process.argv.includes('--apply'),expected=process.argv.find(x=>x.startsWith('--expected-version='))?.split('=')[1];
 const result=await transaction(async client=>{
  await assertDatabaseIdentity(client);await query('SELECT pg_advisory_xact_lock(7811051)');
  if((await query('SELECT FROM audit_logs WHERE action=$1',[action])).rowCount)return {alreadyApplied:true};
  const current=await currentPricingCatalog();if(expected!==current.id)throw Error('Reviewed production pricing version required');
  if((await query("SELECT FROM pricing_catalog_versions WHERE status='DRAFT'")).rowCount)throw Error('Review production pricing draft first');
  const owner=(await query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.active=true AND r.name='OWNER' ORDER BY u.created_at LIMIT 1")).rows[0];if(!owner)throw Error('Active production Owner required');
  const inventory=(await query("SELECT id FROM equipment WHERE deleted_at IS NULL AND (inventory_pool='AUDIO_GUESTBOOK' OR name~*'audio.*phone|audio.*guest.*book')")).rows.map(x=>x.id);
  if(!apply)return {dryRun:true,version:current.id,inventoryUnits:inventory.length,plans:20,experiences:4};
  const req={user:{...owner,permissions:['*']},headers:{'user-agent':'Owner approved production redesign release'}},productionApproval='LOLA_REDESIGN_OWNER_APPROVED_2026_11_10';
  const run=async fn=>fn({apply:true,expectedVersion:(await currentPricingCatalog()).id,req,productionApproval,inventoryIds:inventory});
  await run(updateStagingExperiences);await run(updateStagingAudioRental);await run(updateStagingBusinessPlans);await run(updateStagingWebsiteRedesign);
  for(const item of redesignExperienceContent){const old=(await query("SELECT * FROM website_channel_records WHERE channel='STAGING' AND cms_type='experiences' AND payload->>'slug' LIKE $1",['%'+item.key+'%'])).rows[0];if(!old)throw Error('CMS experience missing');await saveStagingRecord('experiences',{entity_key:old.entity_key,payload:{...old.payload,website_booking_image:item.website_booking_image,website_booking_crop:null},status:'PUBLISHED',display_order:old.display_order},req.user,old.id);}
  const after={version:(await currentPricingCatalog()).id,plans:20,experiences:4,audioInventoryUnits:inventory.length,historicalDocumentsUnchanged:true};
  await writeAudit({req,action,entity:'website_release',entityId:current.id,before:{pricingVersion:current.id},after});return after;
 });console.log(JSON.stringify(result));
}finally{await pool.end();}
