import test from 'node:test';
import assert from 'node:assert/strict';
import {stripeConfiguration,assertStripeEventMode,verifyStripeAccount} from '../server/src/services/stripe-configuration.js';
const base={APP_ENV:'staging',STRIPE_SECRET_KEY:'rk_test_synthetic',STRIPE_WEBHOOK_SECRET:'synthetic',STRIPE_ACCOUNT_ID:'acct_sandbox'};
test('restricted sandbox keys work; live keys require production, explicit activation and account binding',()=>{
 assert.equal(stripeConfiguration(base).readiness,'TEST_READY');
 for(const patch of [{STRIPE_SECRET_KEY:'sk_live_synthetic'},{STRIPE_SECRET_KEY:'rk_live_synthetic',STRIPE_LIVE_PAYMENTS_ENABLED:'true'}])assert.equal(stripeConfiguration({...base,...patch}).enabled,false);
 const live={...base,APP_ENV:'production',STRIPE_SECRET_KEY:'rk_live_synthetic',STRIPE_LIVE_PAYMENTS_ENABLED:'true'};
 assert.equal(stripeConfiguration(live).readiness,'LIVE_READY');assert.equal(stripeConfiguration({...live,STRIPE_ACCOUNT_ID:''}).enabled,false);
 assert.throws(()=>assertStripeEventMode({livemode:true},base));assert.doesNotThrow(()=>assertStripeEventMode({livemode:false},base));assert.throws(()=>assertStripeEventMode({livemode:false,account:'acct_wrong'},base));
});
test('account verification rejects wrong account and incomplete live onboarding',async()=>{
 const request=body=>async(url,opts)=>{assert.equal(url,'https://api.stripe.com/v1/account');assert.equal(opts.headers['Stripe-Version'],'2026-08-26.dahlia');return {ok:true,json:async()=>body};};
 assert.equal((await verifyStripeAccount(base,request({id:'acct_sandbox'}))).mode,'TEST');
 await assert.rejects(()=>verifyStripeAccount(base,request({id:'acct_wrong'})),e=>e.code==='STRIPE_ACCOUNT_MISMATCH');
 await assert.rejects(()=>verifyStripeAccount({...base,APP_ENV:'production',STRIPE_SECRET_KEY:'rk_live_synthetic',STRIPE_LIVE_PAYMENTS_ENABLED:'true'},request({id:'acct_sandbox',charges_enabled:false})),e=>e.code==='STRIPE_CHARGES_DISABLED');
});
test('webhook account lookup rejects signed events from a replaced account',async()=>{
 const {verifyStripeEventAccount}=await import('../server/src/services/stripe-configuration.js');
 const event={id:'evt_synthetic',type:'checkout.session.completed',livemode:false};
 await assert.rejects(()=>verifyStripeEventAccount(event,base,async()=>({ok:false,json:async()=>({})})),e=>e.code==='STRIPE_EVENT_ACCOUNT_MISMATCH');
 assert.equal((await verifyStripeEventAccount(event,base,async()=>({ok:true,json:async()=>event}))).id,event.id);
});
