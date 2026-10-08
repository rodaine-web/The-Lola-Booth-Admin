import crypto from 'node:crypto';
import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
const names={glam:'The LOLA Glam','360':'The LOLA 360',vogue:'The LOLA Vogue',audio:'The LOLA Guestbook'};
export function bookingIdentity(item){const text=String(item.slug||item.website_name||item.name||'').toLowerCase();return /360/.test(text)?'360':/vogue/.test(text)?'vogue':/audio|guestbook/.test(text)?'audio':/glam/.test(text)?'glam':null;}
export function bookingAddonEligible(addon,experiences){
 const keys=experiences.map(bookingIdentity),label=String(addon.name).toLowerCase();
 if(/audio.*guestbook/.test(label)&&keys.includes('audio'))return false;
 if(/print|guestbook/.test(label)&&!(/audio/.test(label))&&!keys.includes('glam'))return false;
 if(/backdrop/.test(label)&&!keys.some(x=>['glam','vogue'].includes(x)))return false;
 return keys.length>0;
}
export async function publicBookingCatalog(){
 const [experiences,packages,addons]=await Promise.all([
  query("SELECT id,slug,name,website_name,website_short_description,default_duration FROM experiences WHERE active=true AND deleted_at IS NULL AND show_on_website=true AND website_status='PUBLISHED' ORDER BY display_order,id"),
  query("SELECT p.id,p.experience_id,p.name,p.website_key,p.starting_price,p.currency,p.duration,p.pricing_mode,p.website_features,p.website_short_description,COALESCE((SELECT json_agg(label ORDER BY display_order) FROM package_items WHERE package_id=p.id),'[]') AS items FROM packages p JOIN experiences e ON e.id=p.experience_id WHERE p.active=true AND p.deleted_at IS NULL AND p.show_on_website=true AND p.website_status='PUBLISHED' AND e.active=true AND e.deleted_at IS NULL AND e.show_on_website=true AND e.website_status='PUBLISHED' ORDER BY p.website_display_order,p.display_order,p.id"),
  query("SELECT id,name,description,price,pricing_type FROM addons WHERE active=true AND deleted_at IS NULL ORDER BY created_at,id")
 ]);
 return {experiences:experiences.rows.filter(x=>bookingIdentity(x)).map(x=>({...x,key:bookingIdentity(x),name:names[bookingIdentity(x)]})),packages:packages.rows,addons:addons.rows,compatibilityPolicy:'catalog-fallback-v1'};
}
export function validateBookingSelections(input,catalog){
 const selections=input.selections||[];
 if(!selections.length||selections.length>4||new Set(selections.map(x=>x.experienceId)).size!==selections.length)throw new AppError('Choose one to four different experiences.',422,'BOOKING_SELECTION_INVALID');
 const selected=selections.map(item=>{
  const experience=catalog.experiences.find(x=>x.id===item.experienceId);
  const pkg=catalog.packages.find(x=>x.id===item.packageId&&x.experience_id===item.experienceId);
  if(!experience||!pkg)throw new AppError('Choose an available package for each experience.',422,'BOOKING_PACKAGE_INVALID');
  const custom=pkg.pricing_mode==='CUSTOM'||/custom/i.test(pkg.website_key||pkg.name);
  return {experienceId:experience.id,experienceName:experience.name,packageId:pkg.id,packageName:pkg.name,pricingMode:custom?'CUSTOM':'FIXED',startingPrice:custom?null:Number(pkg.starting_price),customNotes:custom?item.customNotes||'':null};
 });
 const addons=input.addons||[];
 if(new Set(addons.map(x=>x.addonId)).size!==addons.length)throw new AppError('Select each add-on once.',422,'BOOKING_ADDON_INVALID');
 const selectedAddons=addons.map(item=>{
  const addon=catalog.addons.find(x=>x.id===item.addonId);
  if(!addon||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>24||(!['PER_HOUR','PER_GUEST'].includes(addon.pricing_type)&&item.quantity!==1)||!bookingAddonEligible(addon,catalog.experiences.filter(x=>selected.some(y=>y.experienceId===x.id))))throw new AppError('Choose available add-ons and valid quantities for your experiences.',422,'BOOKING_ADDON_INVALID');
  return {addonId:addon.id,name:addon.name,quantity:item.quantity,pricingType:addon.pricing_type,unitPrice:addon.pricing_type==='CUSTOM'?null:Number(addon.price)};
 });
 return {selections:selected,addons:selectedAddons};
}
export async function preparePublicBooking(payload){
 if(!payload.selections)return payload;
 // Keep catalog status/prices stable through the enclosing inquiry transaction.
 await query('SELECT id FROM experiences WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[payload.selections.map(x=>x.experienceId)]);
 await query('SELECT id FROM packages WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[payload.selections.map(x=>x.packageId)]);
 await query('SELECT id FROM addons WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[(payload.addons||[]).map(x=>x.addonId)]);
 const booking=validateBookingSelections(payload,await publicBookingCatalog());
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return {...payload,preferredExperienceId:booking.selections[0].experienceId,preferredPackageId:booking.selections[0].packageId,
  consent_status:payload.marketing_email_opt_in?'OPTED_IN':'NOT_OPTED_IN',consent_reference:'booking-email-consent-v1',
  source_details:{...payload,bookingInquiry:{...booking,eventName:payload.eventName||null,consent:{email:payload.marketing_email_opt_in===true,recordedAt:new Date().toISOString(),version:'booking-email-consent-v1'},submissionFingerprint:fingerprint}}};
}
