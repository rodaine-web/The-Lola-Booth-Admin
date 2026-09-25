import {AppError} from '../utils/errors.js';
export const isStaging=(config=process.env)=>config.APP_ENV==='staging';
export function buildInfo(config=process.env){return {environment:config.APP_ENV||config.NODE_ENV||'development',revision:config.RAILWAY_GIT_COMMIT_SHA||config.APP_REVISION||'local'};}
export function assertStagingConfiguration(config=process.env){
 if(!isStaging(config))return;
 if(config.STRIPE_SECRET_KEY&&!config.STRIPE_SECRET_KEY.startsWith('sk_test_'))throw new Error('Staging requires a Stripe TEST secret key.');
 if(config.SMS_PROVIDER&&config.SMS_PROVIDER!=='none')throw new Error('Staging external SMS must remain disabled.');
 for(const key of ['GA4_ENABLED','META_EVENTS_ENABLED','TIKTOK_EVENTS_ENABLED'])if(config[key]==='true')throw new Error(`${key} must remain false in staging.`);
}
export function stagingEmailPolicy(message,config=process.env){
 if(!isStaging(config))return message;
 if(config.STAGING_EMAIL_ENABLED!=='true')throw new AppError('Staging email is paused pending controlled qualification.',409,'STAGING_EMAIL_PAUSED');
 const allow=new Set(String(config.STAGING_EMAIL_ALLOWLIST||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));
 const recipients=[message.to,message.cc,message.bcc].flatMap(v=>Array.isArray(v)?v:String(v||'').split(',')).map(v=>String(v).trim().toLowerCase()).filter(Boolean);
 if(!recipients.length||recipients.length>2||recipients.some(v=>!allow.has(v)))throw new AppError('Staging email permits at most two approved QA recipients.',403,'STAGING_RECIPIENT_BLOCKED');
 return {...message,subject:String(message.subject||'').startsWith('[LOLA STAGING QA] ')?message.subject:`[LOLA STAGING QA] ${message.subject||''}`};
}
export function stagingJobsPaused(config=process.env){return isStaging(config);}
