import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStagingConfiguration,stagingEmailPolicy,stagingJobsPaused,buildInfo} from '../server/src/config/staging-safety.js';
import {safeError} from '../server/src/utils/safe-error.js';
import {dispatchMarketing} from '../server/src/services/marketing-adapters.js';
test('staging rejects live or malformed Stripe keys, SMS and enabled marketing',()=>{
 const base={APP_ENV:'staging',STRIPE_SECRET_KEY:'sk_test_synthetic',SMS_PROVIDER:'none'};assert.doesNotThrow(()=>assertStagingConfiguration(base));
 for(const patch of [{STRIPE_SECRET_KEY:'sk_live_synthetic'},{STRIPE_SECRET_KEY:'unexpected'},{SMS_PROVIDER:'twilio'},...['GA4_ENABLED','META_EVENTS_ENABLED','TIKTOK_EVENTS_ENABLED'].map(k=>({[k]:'true'}))])assert.throws(()=>assertStagingConfiguration({...base,...patch}));
});
test('staging email defaults paused and allowlist covers cc/bcc and bulk limits',()=>{
 const message={to:'qa@example.invalid',subject:'Invoice'};assert.throws(()=>stagingEmailPolicy(message,{APP_ENV:'staging'}),e=>e.code==='STAGING_EMAIL_PAUSED');
 const config={APP_ENV:'staging',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_ALLOWLIST:'qa@example.invalid,second@example.invalid'};
 assert.equal(stagingEmailPolicy(message,config).subject,'[LOLA STAGING QA] Invoice');
 for(const patch of [{cc:'customer@example.invalid'},{bcc:'customer@example.invalid'},{to:['qa@example.invalid','second@example.invalid','qa@example.invalid']}])assert.throws(()=>stagingEmailPolicy({...message,...patch},config),e=>e.code==='STAGING_RECIPIENT_BLOCKED');
 assert.equal(stagingEmailPolicy(message,{}),message);
});
test('staging keeps automatic jobs paused and version output safe',()=>{assert.equal(stagingJobsPaused({APP_ENV:'staging',STAGING_AUTOMATIONS_ENABLED:'true'}),true);assert.deepEqual(buildInfo({APP_ENV:'staging',RAILWAY_GIT_COMMIT_SHA:'abc',JWT_SECRET:'hidden'}),{environment:'staging',revision:'abc'});});
test('staging marketing never calls transport even if an enable flag is supplied',async()=>{let called=false;assert.equal((await dispatchMarketing({provider:'GA4'},{config:{APP_ENV:'staging',GA4_ENABLED:'true'},transport:()=>{called=true;}})).result,'DISABLED');assert.equal(called,false);});
test('error logging redacts configured secrets and payment tokens',()=>{const result=safeError(new Error('failed sensitive-password sk_live_ABC whsec_DEF'),{JWT_SECRET:'sensitive-password'});assert.ok(!JSON.stringify(result).includes('sensitive-password'));assert.ok(!JSON.stringify(result).includes('sk_live_ABC'));assert.equal(result.stack,undefined);});
