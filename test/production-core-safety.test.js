import test from'node:test';import assert from'node:assert/strict';import{assertStagingConfiguration,stagingEmailPolicy,stagingJobsPaused}from'../server/src/config/staging-safety.js';import{selectedQualificationJobs}from'../server/src/services/staging-email-qualification-service.js';
const base={APP_ENV:'production'},id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
test('production worker defaults paused and staging flags cannot activate it',()=>{assert.equal(stagingJobsPaused(base),true);assert.equal(stagingJobsPaused({...base,STAGING_AUTOMATIONS_ENABLED:'true'}),true);assert.equal(stagingJobsPaused({...base,PRODUCTION_AUTOMATIONS_ENABLED:'true'}),false)});
test('production qualification rejects live Stripe, SMS and marketing startup',()=>{for(const patch of [{STRIPE_SECRET_KEY:'sk_live_synthetic'},{SMS_PROVIDER:'twilio'},{GA4_ENABLED:'true'},{META_EVENTS_ENABLED:'true'},{TIKTOK_EVENTS_ENABLED:'true'}])assert.throws(()=>assertStagingConfiguration({...base,...patch}));assert.doesNotThrow(()=>assertStagingConfiguration({...base,STRIPE_SECRET_KEY:'sk_test_synthetic'}));});
test('enabled production sends live mail without QA tags or recipient restrictions',()=>{
 const message={to:['customer@example.invalid','second@example.invalid','third@example.invalid'],cc:'cc@example.invalid',bcc:'bcc@example.invalid',subject:'Your event'};
 assert.throws(()=>stagingEmailPolicy(message,base),e=>e.code==='PRODUCTION_EMAIL_PAUSED');
 const config={...base,PRODUCTION_EMAIL_ENABLED:'true',PRODUCTION_EMAIL_ALLOWLIST:'qa@example.invalid'};
 assert.deepEqual(stagingEmailPolicy(message,config),message);
 assert.equal(stagingEmailPolicy({...message,subject:'[LOLA PRODUCTION QA] Your event'},config).subject,'Your event');
 assert.throws(()=>stagingEmailPolicy(message,{APP_ENV:'staging',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_ALLOWLIST:'qa@example.invalid'}),e=>e.code==='STAGING_RECIPIENT_BLOCKED');
 assert.throws(()=>stagingEmailPolicy(message,{...base,STAGING_EMAIL_ENABLED:'true'}),e=>e.code==='PRODUCTION_EMAIL_PAUSED');
});
test('production bounded jobs require production enablement and explicit IDs',()=>{assert.deepEqual(selectedQualificationJobs({...base,STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_JOB_IDS:id}),[]);assert.deepEqual(selectedQualificationJobs({...base,PRODUCTION_EMAIL_ENABLED:'true',PRODUCTION_EMAIL_JOB_IDS:id}),[id]);assert.deepEqual(selectedQualificationJobs({...base,PRODUCTION_EMAIL_ENABLED:'true'}),[]);assert.throws(()=>selectedQualificationJobs({...base,PRODUCTION_EMAIL_ENABLED:'true',PRODUCTION_EMAIL_JOB_IDS:'all'}));});
