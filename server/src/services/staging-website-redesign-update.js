import fs from 'node:fs/promises';
import {query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {currentPricingCatalog} from './pricing-catalog-service.js';
import {saveStagingRecord} from './staging-cms-service.js';
import {writeAudit} from '../middleware/audit.js';
import {redesignExperienceContent,redesignHeroes,redesignPartners,redesignGuestScenes} from '../../../shared/redesign-content.js';
const action='staging-approved-website-redesign-2026-11-09';
export async function updateStagingWebsiteRedesign({apply=false,expectedVersion,req}){
 if(!['staging','test'].includes(process.env.APP_ENV))throw Error('Staging only');
 return transaction(async client=>{
  await assertDatabaseIdentity(client);await query('SELECT pg_advisory_xact_lock(7811051)');
  const prior=(await query('SELECT after_json FROM audit_logs WHERE action=$1 ORDER BY created_at DESC LIMIT 1',[action])).rows[0];if(prior)return {alreadyApplied:true,...prior.after_json};
  const current=await currentPricingCatalog();const {records}=JSON.parse(await fs.readFile(new URL('../../import-data/lola-redesign-copy.json',import.meta.url),'utf8'));
  const summary={expectedVersion:current.id,copySlots:records.length,experiences:redesignExperienceContent.map(x=>x.name),partners:redesignPartners.map(x=>x[1]),scope:'STAGING_ONLY',historicalDocumentsUnchanged:true};if(!apply)return {dryRun:true,...summary};
  if(expectedVersion!==current.id||!req?.user?.id)throw Error('Review the current catalogue version and audited actor before applying');
  const before={cms:(await query("SELECT * FROM website_channel_records WHERE channel='STAGING'")).rows,experiences:(await query('SELECT * FROM experiences WHERE deleted_at IS NULL')).rows};
  const user={...req.user,permissions:['*']};
  const save=async(type,key,payload,order=0)=>{const old=before.cms.find(x=>x.cms_type===type&&x.entity_key===key);return saveStagingRecord(type,{channel:'STAGING',entity_key:key,payload,status:'PUBLISHED',display_order:order},user,old?.id);};
  for(const r of records)await save(r.cms_type,r.entity_key,r.payload,r.display_order);
  for(const item of redesignExperienceContent){
   const exp=before.experiences.find(x=>String(x.slug).includes(item.key));if(!exp)throw Error('Missing primary experience '+item.key);
   const old=before.cms.find(x=>x.cms_type==='experiences'&&x.payload.source_catalog_id===exp.id);if(!old)throw Error('Primary experience CMS record missing');
   const fields={...old.payload,name:item.name,website_name:item.name,website_heading:item.name,website_short_description:item.description,website_long_description:item.description,image:item.image};
   for(const [mode,field]of [['card','website_card'],['about','website_about'],['landscape','website_landscape'],['booking','website_booking']]){fields[field+'_crop']=item[field+'_crop'];fields[field+'_image']=item[field+'_image']||item[field+'_crop'].source;}
   await save('experiences',old.entity_key,fields,item.display_order);
   await query('UPDATE experiences SET image_url=$2,description=$3,website_short_description=$3,website_long_description=$3,display_order=$4,updated_at=now() WHERE id=$1',[exp.id,item.image,item.description,item.display_order]);
  }
  for(const [page,crop]of Object.entries(redesignHeroes).filter(([page])=>page!=='home'))await save('hero','redesign.hero.'+page,{page_slug:page,image:crop.source,image_crop:crop,alt_text:'The Lola Booth '+page+' design photograph',caption:''},-100);
  for(const scene of redesignGuestScenes)await save('hero','redesign.hero.home.'+scene.key,{page_slug:'home',experience_key:scene.key,image:scene.image,alt_text:'Guests enjoying '+scene.name,caption:scene.name},scene.display_order-100);
  for(const [key,value]of Object.entries({instagram_url:'https://instagram.com/thelolabooth',tiktok_url:'https://tiktok.com/@thelolabooth'})){const old=before.cms.find(x=>x.cms_type==='settings'&&x.entity_key===key);await save('settings',key,{...old?.payload,value},old?.display_order||0);}
  if(!before.cms.some(x=>x.cms_type==='partners'))for(const [i,[key,name,file]]of redesignPartners.entries())await save('partners','partner.'+key,{name,image:file?'/staging-site/assets/'+file:'',alt_text:name+' logo',url:''},i);
  for(const partner of before.cms.filter(x=>x.cms_type==='partners'&&/male|mail studio/i.test(x.payload.name||'')))await save('partners',partner.entity_key,{...partner.payload,image:'/staging-site/assets/redesign-male-studios-visible.jpg',background_color:'#000000'},partner.display_order);
  const assets=['home-mirror-silver.jpg','home-vogue-silver.jpg',...redesignExperienceContent.map(x=>'equipment-cutout-'+x.key+'.png'),'owner-glam-guests-event.jpg','owner-glam-guests-outdoor.jpg','owner-360-guests-event.jpg','owner-mirror-equipment-event.jpg','owner-mirror-equipment-umbrella.jpg','owner-vogue-guests-wedding.jpg',...redesignGuestScenes.map(x=>'redesign-'+x.key+'-guests.jpg'),'redesign-male-studios-visible.jpg','redesign-360-device.jpg','redesign-mirror-device.jpg','redesign-vogue-device.jpg','redesign-aboutphoto.jpg','redesign-contacthero.jpg','redesign-hero.jpg','redesign-audio.jpg',...['home','about','experiences','packages','faq','contact','availability'].map(p=>'reference-'+p+'.jpg'),'redesign-LOLA_Horizontal_Dark_Transparent.png','redesign-LOLA_Horizontal_Light_Transparent.png','redesign-LOLA_Favicon_512.png'];
  for(const file of assets)await save('media','assets/'+file,{title:file.startsWith('reference-')?'Approved design reference: '+file:file,filename:file,url:'/staging-site/assets/'+file,alt_text:'Owner-supplied Lola Booth asset'},200);
  await writeAudit({req,action,entity:'website_channel',entityId:current.id,before,after:summary});return summary;
 });
}
