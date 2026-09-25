import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {websiteContentDefaults} from './website-cms-service.js';

export const stagingCmsTypes=['pageItems','hero','experiences','packages','eventTypes','gallery','testimonials','faqs','content','settings','media'];
export const publicSettingFields=['business_name','business_email','contact_email','phone','website','service_area','instagram_url','tiktok_url','facebook_url','pinterest_url','copyright_text','brand_line','site_title','default_meta_description','default_og_image_media_id','canonical_domain','social_share_title','social_share_description','show_starting_price'];
export function assertStagingChannel(input={}) {
  if(input.channel!==undefined&&input.channel!=='STAGING')throw new AppError('Public content is read-only. Select STAGING.',409,'PUBLIC_CONTENT_FROZEN');
}
export function freezesPublicMutation(path,body={}) {
  if(/^\/website(?:\/|$)/.test(path)&&!path.startsWith('/website/staging/'))return true;
  if(/^\/(packages|experiences)(?:\/|$)/.test(path))return true;
  return path==='/settings'&&Object.keys(body).some(k=>publicSettingFields.includes(k));
}
export function stagingRecord(row) {
  const payload={...row.payload};for(const key of ['storage_key','storage_provider','mime_type'])delete payload[key];
  return {...payload,id:row.id,channel:row.channel,entity_key:row.entity_key,status:row.status,display_order:row.display_order,updated_at:row.updated_at};
}
export function validateStagingRecord(type,input) {
  assertStagingChannel(input);
  if(!stagingCmsTypes.includes(type))throw new AppError('Unknown CMS type.',404,'CMS_TYPE_NOT_FOUND');
  const {entity_key,payload={},status='DRAFT',display_order=0}=input;
  if(typeof entity_key!=='string'||!entity_key.trim()||entity_key.length>250)throw new AppError('A stable content key is required.',422,'CMS_KEY_REQUIRED');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>150000)throw new AppError('Invalid content fields.',422,'CMS_PAYLOAD_INVALID');
  if(!['DRAFT','PUBLISHED','ARCHIVED'].includes(status))throw new AppError('Invalid publication state.',422,'CMS_STATUS_INVALID');
  if(!Number.isInteger(Number(display_order))||Math.abs(Number(display_order))>100000)throw new AppError('Invalid sort order.',422,'CMS_ORDER_INVALID');
  const clean={...payload};for(const key of ['id','channel','status','display_order','created_by','updated_by','created_at','updated_at','storage_key','storage_provider','mime_type','__proto__','constructor','prototype'])delete clean[key];
  for(const key of ['image','fallback_image','client_photo','url'])if(clean[key]&&!approvedStagingImage(clean[key]))throw new AppError('Choose an approved staging asset or uploaded staging image.',422,'CMS_IMAGE_INVALID');
  return {entity_key:entity_key.trim(),payload:clean,status,display_order:Number(display_order)};
}
export function approvedStagingImage(value) {
  if(typeof value!=='string')return false;
  return /^\/staging-site\/assets\/[a-zA-Z0-9_./-]+$/.test(value)&&!value.includes('..')||/^\/api\/public\/staging\/media\/[a-f0-9-]{36}$/.test(value);
}
export async function listStagingRecords(type) {
  if(!stagingCmsTypes.includes(type))throw new AppError('Unknown CMS type.',404,'CMS_TYPE_NOT_FOUND');
  return (await query("SELECT * FROM website_channel_records WHERE channel='STAGING' AND cms_type=$1 ORDER BY display_order,entity_key",[type])).rows;
}
export async function saveStagingRecord(type,input,user,id=null) {
  const value=validateStagingRecord(type,input);
  if(id&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new AppError('Invalid staging record ID.',422,'CMS_ID_INVALID');
  return transaction(async client=>{
    const before=id?(await client.query("SELECT * FROM website_channel_records WHERE id=$1 AND channel='STAGING' AND cms_type=$2 FOR UPDATE",[id,type])).rows[0]:null;
    if(id&&!before)throw new AppError('Staging record not found.',404,'NOT_FOUND');
    if((value.status==='PUBLISHED'||before?.status==='PUBLISHED')&&!user.permissions?.some(p=>p==='*'||p==='publish:website'))throw new AppError('Publish permission required.',403,'FORBIDDEN');
    if(type==='media'&&before)for(const key of ['storage_key','storage_provider','mime_type'])if(before.payload[key])value.payload[key]=before.payload[key];
    const params=[type,value.entity_key,JSON.stringify(value.payload),value.status,value.display_order,user.id];
    const result=id?await client.query("UPDATE website_channel_records SET entity_key=$2,payload=$3,status=$4,display_order=$5,updated_by=$6,updated_at=now() WHERE id=$7 AND channel='STAGING' AND cms_type=$1 RETURNING *",[...params,id]):await client.query("INSERT INTO website_channel_records(channel,cms_type,entity_key,payload,status,display_order,created_by,updated_by) VALUES('STAGING',$1,$2,$3,$4,$5,$6,$6) RETURNING *",params);
    const row=result.rows[0];
    await client.query("INSERT INTO website_content_versions(entity_type,entity_id,snapshot,action,created_by) VALUES($1,$2,$3,$4,$5)",['staging:'+type,row.id,JSON.stringify(before||{}),before?'updated':'created',user.id]);
    return row;
  });
}
export function projectStagingSite(rows) {
  const published=rows.filter(r=>r.channel==='STAGING'&&r.status==='PUBLISHED').sort((a,b)=>a.display_order-b.display_order||a.entity_key.localeCompare(b.entity_key));
  const typed=type=>published.filter(r=>r.cms_type===type).map(stagingRecord);
  const settings=Object.fromEntries(typed('settings').map(r=>[r.entity_key,r.value]));
  const content=Object.fromEntries(typed('content').map(r=>[r.content_key||r.entity_key,r]));
  const packages=typed('packages').map(r=>({...r,website_display_order:r.display_order,display_price:r.pricing_mode==='CUSTOM'?'Request Pricing':r.starting_price}));
  return {channel:'STAGING',cmsAuthoritative:true,defaults:websiteContentDefaults(),settings,content,pageItems:typed('pageItems'),heroSlides:typed('hero'),experiences:typed('experiences'),packages,eventTypes:typed('eventTypes'),gallery:typed('gallery'),testimonials:typed('testimonials'),faqs:typed('faqs'),media:typed('media')};
}
export async function stagingSitePayload() {
  return projectStagingSite((await query("SELECT * FROM website_channel_records WHERE channel='STAGING' AND status='PUBLISHED' ORDER BY display_order,entity_key")).rows);
}
