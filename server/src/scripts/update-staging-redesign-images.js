// Audited presentation-only correction; never republishes or changes pricing.
import {pool,query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {currentPricingCatalog} from '../services/pricing-catalog-service.js';
import {saveStagingRecord} from '../services/staging-cms-service.js';
import {writeAudit} from '../middleware/audit.js';
import {redesignExperienceContent} from '../../../shared/redesign-content.js';
try{
 if(process.env.APP_ENV!=='staging')throw Error('Staging only');
 const apply=process.argv.includes('--apply'),expected=process.argv.find(a=>a.startsWith('--expected-version='))?.split('=')[1];
 const result=await transaction(async client=>{
  await assertDatabaseIdentity(client);await query('SELECT pg_advisory_xact_lock(7811051)');
  const version=await currentPricingCatalog();if(expected!==version.id)throw Error('Review the current staging pricing version before correcting CMS images');
  const action='staging-redesign-clean-booking-images-2026-11-10';
  if((await query('SELECT FROM audit_logs WHERE action=$1',[action])).rowCount)return {alreadyApplied:true,version:version.id};
  const rows=(await query("SELECT * FROM website_channel_records WHERE channel='STAGING' AND cms_type='experiences' AND status='PUBLISHED'")).rows;
  const updates=redesignExperienceContent.map(item=>{const old=rows.find(r=>String(r.payload.slug||'').includes(item.key));if(!old)throw Error('Missing staging experience '+item.key);return {old,image:item.website_booking_image};});
  if(!apply)return {dryRun:true,version:version.id,images:updates.map(x=>({key:x.old.entity_key,image:x.image}))};
  const owner=(await query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.active=true AND r.name='OWNER' ORDER BY u.created_at LIMIT 1")).rows[0];if(!owner)throw Error('Active staging Owner missing');
  const user={...owner,permissions:['*']},req={user,headers:{'user-agent':'Owner-requested clean booking image correction'}};
  for(const {old,image}of updates)await saveStagingRecord('experiences',{entity_key:old.entity_key,payload:{...old.payload,website_booking_image:image,website_booking_crop:null},status:old.status,display_order:old.display_order},user,old.id);
  await writeAudit({req,action,entity:'website_channel',entityId:version.id,before:updates.map(x=>x.old),after:{cleanBookingImages:4,pricingVersionUnchanged:version.id}});
  return {updated:4,version:version.id};
 });console.log(JSON.stringify(result));
}finally{await pool.end();}
