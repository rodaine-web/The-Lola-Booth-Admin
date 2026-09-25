import {isStaging} from '../config/staging-safety.js';
import crypto from 'node:crypto';
import {MARKETING_PROVIDERS,marketingConfiguration,marketingPayload} from './marketing-adapters.js';
import {query} from '../db/pool.js';
import {env} from '../config/env.js';
import {providerStatus} from './payment-service.js';
import {getEmailProviderReadiness} from './email-service.js';
import {enqueueIntegrationEvent,processIntegrationJobs} from './integration-jobs-service.js';
import {AppError} from '../utils/errors.js';
const definitions=[['MICROSOFT','Microsoft 365','Communications',['MICROSOFT_TENANT_ID','MICROSOFT_CLIENT_ID','MICROSOFT_CLIENT_SECRET','MICROSOFT_SENDER_EMAIL']],['TWILIO','Twilio','Communications',['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM']],['STRIPE','Stripe','Payments',['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']],['PAYPAL','PayPal','Payments',['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID']],['MANUAL','Manual','Payments',[]],['GA4','Google Analytics','Marketing & Analytics',['GA4_MEASUREMENT_ID','GA4_API_SECRET']],['META','Meta / Instagram','Marketing & Analytics',['META_PIXEL_ID','META_ACCESS_TOKEN','META_GRAPH_VERSION']],['TIKTOK','TikTok','Marketing & Analytics',['TIKTOK_PIXEL_ID','TIKTOK_ACCESS_TOKEN']],['LINKEDIN','LinkedIn','Marketing & Analytics',[]],['WEBSITE','CMS / Public API','Website',[]]];
export async function integrationCatalog(){
 const activity=(await query("SELECT provider,max(completed_at) FILTER(WHERE status='SUCCEEDED') AS last_success,max(created_at) FILTER(WHERE status='FAILED') AS last_failure FROM integration_jobs GROUP BY provider")).rows;
 const mail=(await query("SELECT max(sent_at) AS last_success,max(failed_at) AS last_failure FROM communications WHERE channel='EMAIL' AND provider='microsoft'")).rows[0];
 const attempts=(await query("SELECT provider,max(created_at) FILTER(WHERE mode='PAYLOAD_TEST') AS last_test,max(created_at) FILTER(WHERE mode='PROVIDER' AND result IN ('ACCEPTED','HTTP_ACCEPTED_UNVERIFIED')) AS last_success,max(created_at) FILTER(WHERE mode='PROVIDER' AND result='FAILED') AS last_failure FROM integration_attempts GROUP BY provider")).rows;
 const smsCounts=(await query("SELECT count(*) FILTER(WHERE status IN ('QUEUED','PROCESSING'))::int AS queued,count(*) FILTER(WHERE status='SUCCEEDED' AND mode='DEVELOPMENT')::int AS mock_completed,count(*) FILTER(WHERE status='SUCCEEDED' AND mode='PROVIDER')::int AS provider_completed FROM integration_jobs WHERE provider='TWILIO'")).rows[0];
 const stripe=providerStatus().stripe;
 return {data:definitions.map(([provider,label,group,keys])=>{
  const evidence=(MARKETING_PROVIDERS.includes(provider)?attempts:activity).find(a=>a.provider===provider)||{};const present=keys.filter(k=>Boolean(process.env[k])).length;
  let mode='DEVELOPMENT',status='NOT_CONFIGURED',detail='Local adapter only; no external delivery tested.';
  if(provider==='MICROSOFT'){mode=env.emailProvider==='development'?'DEVELOPMENT':'PROVIDER';try{const r=getEmailProviderReadiness(env);status=r.active?(mail?.last_success?'READY':'PENDING_VERIFICATION'):'DISABLED';}catch{status='ERROR';}detail='Email is the primary channel. Configuration and provider acceptance are separate checks.';}
  else if(provider==='STRIPE'){mode=stripe.mode;status=stripe.readiness;detail='Hosted test flow pending. Local signed-webhook mocks do not certify Stripe connectivity.';}
  else if(provider==='TWILIO'){status=env.smsProvider==='development'?'TEST_READY':present?'PENDING_VERIFICATION':'DISABLED';detail='Opt-in and enabled escalation required; email first. Development dispatch never calls Twilio.';}
  else if(provider==='PAYPAL'){status='DISABLED';detail='Preserved adapter; disabled until verified webhook and capture qualification.';}
  else if(provider==='MANUAL'){status='DISABLED';detail='Manual recording remains restricted to authorized finance operators.';}
  else if(provider==='WEBSITE'){status='READY';mode='LOCAL';detail='Local API available. Frozen production CMS publication is not certified here.';}
  else if(provider==='LINKEDIN'){status='PENDING_APPROVAL';detail='Optional integration; API approval and external delivery are pending.';}
  else if(MARKETING_PROVIDERS.includes(provider)){const c=marketingConfiguration(provider);mode=c.enabled?'PROVIDER':'DISABLED';status=!c.enabled?'DISABLED':!c.complete?'NOT_CONFIGURED':evidence.last_failure&&(!evidence.last_success||evidence.last_failure>evidence.last_success)?'ERROR':evidence.last_success?'READY':'TEST_READY';detail='Server adapter available. Payload tests never dispatch externally. Provider acceptance does not certify attribution or reporting.';}
  else if(present){status=present===keys.length?'PENDING_VERIFICATION':'ERROR';}
  if(provider==='MICROSOFT'&&isStaging()&&process.env.STAGING_EMAIL_ENABLED!=='true'){mode='STAGING_PAUSED';status='DISABLED';detail='Microsoft configuration retained; staging sends are paused pending controlled inbox qualification.';}
  return {provider,label,group,mode,status,...(provider==='TWILIO'?{counts:smsCounts}:{}),config:{present,required:keys.length,fields:keys},lastTest:evidence.last_test,lastSuccess:provider==='MICROSOFT'?mail?.last_success:evidence.last_success,lastFailure:provider==='MICROSOFT'?mail?.last_failure:evidence.last_failure,evidenceMode:provider==='MICROSOFT'?'Provider accepted':MARKETING_PROVIDERS.includes(provider)?'Provider HTTP acceptance':'LOCAL MOCK',detail,testAvailable:env.nodeEnv!=='production'&&['GA4','META','TIKTOK','STRIPE'].includes(provider)};
 })};
}
export async function testIntegration(provider,user){
 if(env.nodeEnv==='production')throw new AppError('Local test only.',403,'LOCAL_TEST_ONLY');
 if(provider==='STRIPE')return {message:'Configuration inspected only. Hosted Stripe testing remains pending.',configuration:providerStatus().stripe};
 if(!['GA4','META','TIKTOK'].includes(provider))throw new AppError('This provider has no safe generic test.',422,'NO_SAFE_TEST');
 const job={provider,event_name:'generate_lead',idempotency_key:`payload-test:${crypto.randomUUID()}`,created_at:new Date().toISOString(),payload:{attribution:{ga_client_id:'123.456',ga_session_id:'123',fbclid:'synthetic_meta_click',fbclid_timestamp:Date.now(),ttclid:'synthetic_tiktok_click'}}};
 const payload=marketingPayload(job);await query("INSERT INTO integration_attempts(provider,event_name,mode,result,response_summary) VALUES($1,$2,'PAYLOAD_TEST','VALIDATED',$3)",[provider,job.event_name,JSON.stringify({payload})]);
 return {message:'Payload validated and recorded locally. No external provider was contacted.',payload};
}
