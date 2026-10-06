import {AppError} from '../utils/errors.js';
export function stripeConfiguration(config=process.env) {
 const key=config.STRIPE_SECRET_KEY||'';
 const mode=/^(sk|rk)_live_/.test(key)?'LIVE':'TEST';
 const configured=/^(sk|rk)_(test|live)_/.test(key);
 const liveApproved=mode==='LIVE'&&config.APP_ENV==='production'&&config.STRIPE_LIVE_PAYMENTS_ENABLED==='true'&&/^acct_[A-Za-z0-9]+$/.test(config.STRIPE_ACCOUNT_ID||'');
 const enabled=configured&&(mode==='TEST'||liveApproved);
 return {provider:'STRIPE',configured,mode,enabled,accountId:config.STRIPE_ACCOUNT_ID||null,webhookConfigured:Boolean(config.STRIPE_WEBHOOK_SECRET),readiness:!configured?'NOT_CONFIGURED':!enabled?'DISABLED':!config.STRIPE_WEBHOOK_SECRET?'ERROR':mode==='LIVE'?'LIVE_READY':'TEST_READY'};
}
export function assertStripeEventMode(event,config=process.env) {
 const status=stripeConfiguration(config);
 if(!status.enabled||event.livemode!==(status.mode==='LIVE'))throw new AppError('Stripe event does not match the enabled payment environment.',403,'LIVE_PAYMENTS_DISABLED');
 if(event.account&&event.account!==status.accountId)throw new AppError('Stripe event belongs to a different account.',403,'STRIPE_ACCOUNT_MISMATCH');
}
export async function verifyStripeAccount(config=process.env,request=fetch) {
 const status=stripeConfiguration(config);
 if(!status.enabled)throw new AppError('Stripe payments are not enabled for this environment.',409,'PAYMENT_PROVIDER_UNAVAILABLE');
 const response=await request('https://api.stripe.com/v1/account',{headers:{Authorization:`Bearer ${config.STRIPE_SECRET_KEY}`,'Stripe-Version':'2026-08-26.dahlia'},signal:AbortSignal.timeout(15000)});
 const account=await response.json();
 if(!response.ok||!account.id)throw new AppError('Stripe account verification failed. Check the key and account permissions.',502,'STRIPE_ACCOUNT_VERIFICATION_FAILED');
 if(status.accountId&&account.id!==status.accountId)throw new AppError('The Stripe key belongs to a different account.',409,'STRIPE_ACCOUNT_MISMATCH');
 if(status.mode==='LIVE'&&!account.charges_enabled)throw new AppError('This Stripe account is not yet enabled for live charges.',409,'STRIPE_CHARGES_DISABLED');
 return {accountId:account.id,mode:status.mode,chargesEnabled:Boolean(account.charges_enabled)};
}
// A replaced key must not accept events from the previous account even if its
// old signing secret was accidentally left configured.
export async function verifyStripeEventAccount(event,config=process.env,request=fetch) {
 assertStripeEventMode(event,config);
 const response=await request(`https://api.stripe.com/v1/events/${encodeURIComponent(event.id)}`,{headers:{Authorization:`Bearer ${config.STRIPE_SECRET_KEY}`,'Stripe-Version':'2026-08-26.dahlia'},signal:AbortSignal.timeout(15000)});
 const verified=await response.json();
 if(!response.ok||verified.id!==event.id||verified.livemode!==event.livemode||verified.type!==event.type)throw new AppError('This event could not be verified in the configured Stripe account.',409,'STRIPE_EVENT_ACCOUNT_MISMATCH');
 return verified;
}
