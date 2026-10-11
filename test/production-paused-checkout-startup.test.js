import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStagingConfiguration} from '../server/src/config/staging-safety.js';
import {stripeConfiguration,assertStripeEventMode,verifyStripeAccount} from '../server/src/services/stripe-configuration.js';
test('bound production live key can start while checkout and events remain disabled',async()=>{
 for(const kind of ['sk','rk']){
 const config={APP_ENV:'production',STRIPE_SECRET_KEY:kind+'_live_synthetic',STRIPE_ACCOUNT_ID:'acct_synthetic',STRIPE_LIVE_PAYMENTS_ENABLED:'false'};
 assert.doesNotThrow(()=>assertStagingConfiguration(config));
 assert.equal(stripeConfiguration(config).enabled,false);
 assert.throws(()=>assertStripeEventMode({livemode:true},config),e=>e.code==='LIVE_PAYMENTS_DISABLED');
 let calls=0;await assert.rejects(()=>verifyStripeAccount(config,async()=>{calls++;throw Error('must not request');}),e=>e.code==='PAYMENT_PROVIDER_UNAVAILABLE');assert.equal(calls,0);
 assert.throws(()=>assertStagingConfiguration({...config,APP_ENV:'staging'}));
 assert.throws(()=>assertStagingConfiguration({...config,STRIPE_ACCOUNT_ID:''}));
 }
});
