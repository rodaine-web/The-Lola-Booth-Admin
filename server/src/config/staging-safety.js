import {AppError} from '../utils/errors.js';
export const isStaging=(config=process.env)=>config.APP_ENV==='staging';
export function buildInfo(config=process.env){return {environment:config.APP_ENV||config.NODE_ENV||'development',revision:config.RAILWAY_GIT_COMMIT_SHA||config.APP_REVISION||'local'};}
export function assertStagingConfiguration(config=process.env){
 if(!isStaging(config)&&config.APP_ENV!=='production')return;
 if(config.STRIPE_SECRET_KEY&&!config.STRIPE_SECRET_KEY.startsWith('sk_test_'))throw new Error('Hosted qualification requires a Stripe TEST secret key.');
 if(config.SMS_PROVIDER&&config.SMS_PROVIDER!=='none')throw new Error('Staging external SMS must remain disabled.');
 for(const key of ['GA4_ENABLED','META_EVENTS_ENABLED','TIKTOK_EVENTS_ENABLED'])if(config[key]==='true')throw new Error(`${key} must remain false in staging.`);
}
export function formOwnerNotificationsEnabled(config=process.env){
 return ['staging','production'].includes(config.APP_ENV)&&config.FORM_OWNER_NOTIFICATIONS_ENABLED==='true'&&Number.isFinite(Date.parse(config.FORM_OWNER_NOTIFICATIONS_SINCE||''));
}
export function stagingEmailPolicy(message,config=process.env){
 const production=config.APP_ENV==='production';
 if(!isStaging(config)&&!production)return message;
 const prefix=production?'PRODUCTION':'STAGING';
 if(message.formOwnerNotification===true && formOwnerNotificationsEnabled(config)){
  const recipients=[message.to,message.cc,message.bcc].flatMap(v=>Array.isArray(v)?v:String(v||'').split(',')).map(v=>String(v).trim().toLowerCase()).filter(Boolean);
  if(recipients.length!==1||recipients[0]!=='info@thelolabooth.com')throw new AppError('Form notifications can only go to the LOLA owner mailbox.',403,'FORM_OWNER_RECIPIENT_BLOCKED');
  const tag=production?'[LOLA FORM] ':'[LOLA STAGING FORM] ';
  return {...message,subject:String(message.subject||'').startsWith(tag)?message.subject:tag+(message.subject||'')};
 }
 if(config[`${prefix}_EMAIL_ENABLED`]!=='true')throw new AppError(`${prefix} email is paused pending controlled qualification.`,409,`${prefix}_EMAIL_PAUSED`);
 const allow=new Set(String(config[`${prefix}_EMAIL_ALLOWLIST`]||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));
 const recipients=[message.to,message.cc,message.bcc].flatMap(v=>Array.isArray(v)?v:String(v||'').split(',')).map(v=>String(v).trim().toLowerCase()).filter(Boolean);
 if(!recipients.length||recipients.length>2||recipients.some(v=>!allow.has(v)))throw new AppError(`${prefix} email permits at most two approved QA recipients.`,403,`${prefix}_RECIPIENT_BLOCKED`);
 const tag=`[LOLA ${prefix} QA] `;
 return {...message,subject:String(message.subject||'').startsWith(tag)?message.subject:`${tag}${message.subject||''}`};
}
export function stagingAutomationScope(config=process.env){
 if(!isStaging(config))return null;
 const since=config.STAGING_AUTOMATIONS_SINCE;
 const recipients=String(config.STAGING_EMAIL_ALLOWLIST||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
 if(config.STAGING_AUTOMATIONS_ENABLED!=='true'||config.STAGING_EMAIL_ENABLED!=='true'||!Number.isFinite(Date.parse(since||''))||!recipients.length)return null;
 return {since:new Date(since).toISOString(),recipients};
}
export function stagingJobsPaused(config=process.env){return (isStaging(config)&&!stagingAutomationScope(config))||(config.APP_ENV==='production'&&config.PRODUCTION_AUTOMATIONS_ENABLED!=='true');}
