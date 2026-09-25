import {isStaging} from '../config/staging-safety.js';
import crypto from 'node:crypto';
import {AppError} from '../utils/errors.js';

export const MARKETING_PROVIDERS = ['GA4', 'META', 'TIKTOK'];
const events = new Set(['generate_lead','proposal_sent','proposal_accepted','booking_created','booking_confirmed','invoice_issued','payment_completed','event_completed']);
const switches = {GA4:'GA4_ENABLED', META:'META_EVENTS_ENABLED', TIKTOK:'TIKTOK_EVENTS_ENABLED'};
const keys = {GA4:['GA4_MEASUREMENT_ID','GA4_API_SECRET'], META:['META_PIXEL_ID','META_ACCESS_TOKEN','META_GRAPH_VERSION'], TIKTOK:['TIKTOK_PIXEL_ID','TIKTOK_ACCESS_TOKEN']};
export function marketingConfiguration(provider, config=process.env) {
 const required=keys[provider]||[];
 return {enabled:config[switches[provider]]==='true',complete:required.every(k=>Boolean(config[k])),fields:required,flag:switches[provider]};
}
export function stableEventId(job) {return crypto.createHash('sha256').update(job.idempotency_key).digest('hex');}
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,200}$/.test(value)?value:undefined;
export function marketingPayload(job, config=process.env) {
 if(!events.has(job.event_name))throw new AppError('Unapproved lifecycle event.',422,'MARKETING_EVENT_INVALID');
 const a=job.payload?.attribution||{}, id=stableEventId(job), time=Math.floor(new Date(job.created_at).getTime()/1000);
 if(!Number.isFinite(time))throw new AppError('Event time is required.',422,'MARKETING_TIME_INVALID');
 const value=job.payload?.value,currency=job.payload?.currency;
 if(value!==undefined&&(!Number.isFinite(value)||value<0||!/^[A-Z]{3}$/.test(currency||'')))throw new AppError('A nonnegative value requires a currency.',422,'MARKETING_VALUE_INVALID');
 const properties={...(value!==undefined?{value,currency}:{}),lola_event:job.event_name};
 if(job.provider==='GA4'){
  const client=identifier(a.ga_client_id);if(!client)throw new AppError('Analytics client attribution is required.',422,'GA_CLIENT_ID_REQUIRED');
  const params={...properties,event_id:id};
  for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])if(identifier(a[k]))params[k]=a[k].slice(0,100);
  if(/^\d+$/.test(a.ga_session_id||''))params.session_id=Number(a.ga_session_id);
  return {client_id:client,timestamp_micros:time*1e6,consent:{ad_user_data:'DENIED',ad_personalization:'DENIED'},events:[{name:job.event_name,params}]};
 }
 if(job.provider==='META'){
  const click=identifier(a.fbclid);if(!click||!Number.isSafeInteger(a.fbclid_timestamp))throw new AppError('Meta click attribution and its capture time are required.',422,'META_MATCH_REQUIRED');
  return {data:[{event_name:job.event_name==='generate_lead'?'Lead':job.event_name==='payment_completed'?'Purchase':job.event_name,event_time:time,event_id:id,action_source:'system_generated',user_data:{fbc:`fb.1.${a.fbclid_timestamp}.${click}`},custom_data:properties}],...(config.META_TEST_EVENT_CODE?{test_event_code:config.META_TEST_EVENT_CODE}:{})};
 }
 if(job.provider==='TIKTOK'){
  const click=identifier(a.ttclid);if(!click)throw new AppError('TikTok click attribution is required.',422,'TIKTOK_MATCH_REQUIRED');
  return {event_source:'web',event_source_id:config.TIKTOK_PIXEL_ID||'local-payload-test',data:[{event:job.event_name==='generate_lead'?'SubmitForm':job.event_name==='payment_completed'?'CompletePayment':job.event_name,event_time:time,event_id:id,user:{ttclid:click},properties}],...(config.TIKTOK_TEST_EVENT_CODE?{test_event_code:config.TIKTOK_TEST_EVENT_CODE}:{})};
 }
 throw new AppError('Unsupported marketing provider.',422,'MARKETING_PROVIDER_INVALID');
}
// No names, email addresses, phone numbers, IP addresses, arbitrary URLs or raw
// provider messages enter these payloads or the persisted response summaries.
export async function dispatchMarketing(job,{config=process.env,transport=fetch}={}) {
 const settings=marketingConfiguration(job.provider,config);
 if(isStaging(config)||!settings.enabled)return {mode:'DISABLED',result:'DISABLED'};
 if(!settings.complete)throw new AppError('Provider configuration incomplete.',422,'MARKETING_NOT_CONFIGURED');
 const body=marketingPayload(job,config);let url,headers={'content-type':'application/json'};
 if(job.provider==='GA4'){url=new URL('https://www.google-analytics.com/mp/collect');url.searchParams.set('measurement_id',config.GA4_MEASUREMENT_ID);url.searchParams.set('api_secret',config.GA4_API_SECRET);}
 if(job.provider==='META'){if(!/^v\d+\.0$/.test(config.META_GRAPH_VERSION)||!/^\d+$/.test(config.META_PIXEL_ID))throw new AppError('Invalid Meta endpoint configuration.',422,'MARKETING_CONFIG_INVALID');url=`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.META_PIXEL_ID}/events`;headers.authorization=`Bearer ${config.META_ACCESS_TOKEN}`;}
 if(job.provider==='TIKTOK'){url='https://business-api.tiktok.com/open_api/v1.3/event/track/';headers['Access-Token']=config.TIKTOK_ACCESS_TOKEN;}
 let response;try{response=await transport(String(url),{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw new AppError('Provider outcome unknown; inspect provider history before retry.',409,'PROVIDER_OUTCOME_UNKNOWN');}
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.error||(job.provider==='META'&&!(data.events_received>0))||(job.provider==='TIKTOK'&&data.code!==0)){const error=new AppError('Provider rejected event.',response.status===429?429:422,'PROVIDER_REJECTED');error.retryable=job.provider!=='GA4'&&response.status===429;error.providerStatus=response.status;throw error;}
 return {mode:'PROVIDER',result:job.provider==='GA4'?'HTTP_ACCEPTED_UNVERIFIED':'ACCEPTED',httpStatus:response.status,eventId:stableEventId(job)};
}
