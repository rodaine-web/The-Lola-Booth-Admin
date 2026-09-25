import {query} from '../db/pool.js';
import {env} from '../config/env.js';
import {providerStatus} from './payment-service.js';
import {getEmailProviderReadiness} from './email-service.js';
import {enqueueIntegrationEvent,processIntegrationJobs} from './integration-jobs-service.js';
import {AppError} from '../utils/errors.js';
const definitions=[['MICROSOFT','Microsoft 365','Communications',['MICROSOFT_TENANT_ID','MICROSOFT_CLIENT_ID','MICROSOFT_CLIENT_SECRET','MICROSOFT_SENDER_EMAIL']],['TWILIO','Twilio','Communications',['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM']],['STRIPE','Stripe','Payments',['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']],['PAYPAL','PayPal','Payments',['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID']],['MANUAL','Manual','Payments',[]],['GA4','Google Analytics','Marketing & Analytics',['GA4_MEASUREMENT_ID','GA4_API_SECRET']],['META','Meta / Instagram','Marketing & Analytics',['META_PIXEL_ID','META_ACCESS_TOKEN']],['TIKTOK','TikTok','Marketing & Analytics',['TIKTOK_PIXEL_ID','TIKTOK_ACCESS_TOKEN']],['LINKEDIN','LinkedIn','Marketing & Analytics',[]],['WEBSITE','CMS / Public API','Website',[]]];
export async function integrationCatalog(){
 const activity=(await query("SELECT provider,max(completed_at) FILTER(WHERE status='SUCCEEDED') AS last_success,max(created_at) FILTER(WHERE status='FAILED') AS last_failure FROM integration_jobs GROUP BY provider")).rows;
 const mail=(await query("SELECT max(sent_at) AS last_success,max(failed_at) AS last_failure FROM communications WHERE channel='EMAIL' AND provider='microsoft'")).rows[0];
 const stripe=providerStatus().stripe;
 return {data:definitions.map(([provider,label,group,keys])=>{
  const evidence=activity.find(a=>a.provider===provider)||{};const present=keys.filter(k=>Boolean(process.env[k])).length;
  let mode='DEVELOPMENT',status='NOT_CONFIGURED',detail='Local adapter only; no external delivery tested.';
  if(provider==='MICROSOFT'){mode=env.emailProvider==='development'?'DEVELOPMENT':'PROVIDER';try{const r=getEmailProviderReadiness(env);status=r.active?(mail?.last_success?'READY':'PENDING_VERIFICATION'):'DISABLED';}catch{status='ERROR';}detail='Email is the primary channel. Configuration and provider acceptance are separate checks.';}
  else if(provider==='STRIPE'){mode=stripe.mode;status=stripe.readiness;detail='Hosted test flow pending. Local signed-webhook mocks do not certify Stripe connectivity.';}
  else if(provider==='TWILIO'){status=env.smsProvider==='development'?'TEST_READY':present?'PENDING_VERIFICATION':'DISABLED';detail='Opt-in and enabled escalation required; email first. Development dispatch never calls Twilio.';}
  else if(provider==='PAYPAL'){status='DISABLED';detail='Preserved adapter; disabled until verified webhook and capture qualification.';}
  else if(provider==='MANUAL'){status='DISABLED';detail='Manual recording remains restricted to authorized finance operators.';}
  else if(provider==='WEBSITE'){status='READY';mode='LOCAL';detail='Local API available. Frozen production CMS publication is not certified here.';}
  else if(provider==='LINKEDIN'){status='PENDING_APPROVAL';detail='Optional integration; API approval and external delivery are pending.';}
  else if(present){status=present===keys.length?'PENDING_VERIFICATION':'ERROR';}
  return {provider,label,group,mode,status,config:{present,required:keys.length,fields:keys},lastSuccess:provider==='MICROSOFT'?mail?.last_success:evidence.last_success,lastFailure:provider==='MICROSOFT'?mail?.last_failure:evidence.last_failure,evidenceMode:provider==='MICROSOFT'?'Provider accepted':'LOCAL MOCK',detail,testAvailable:env.nodeEnv!=='production'&&['GA4','META','TIKTOK','STRIPE'].includes(provider)};
 })};
}
export async function testIntegration(provider,user){
 if(env.nodeEnv==='production')throw new AppError('Local test only.',403,'LOCAL_TEST_ONLY');
 if(provider==='STRIPE')return {message:'Configuration inspected only. Hosted Stripe testing remains pending.',configuration:providerStatus().stripe};
 if(!['GA4','META','TIKTOK'].includes(provider))throw new AppError('This provider has no safe generic test.',422,'NO_SAFE_TEST');
 const job=await enqueueIntegrationEvent({provider,eventName:'local_connection_test',entityType:'user',entityId:user.id,payload:{},idempotencyKey:`local-test:${provider}:${user.id}:${Date.now()}`});await processIntegrationJobs();return {message:'Local mock event processed. No external provider was contacted.',id:job.id};
}
