import '../config/env.js';
import {verifyStripeAccount, stripeConfiguration} from '../services/stripe-configuration.js';

// Read-only. No Checkout, charges, refunds, endpoint creation or flag changes.
const requiredEvents = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired', 'payment_intent.succeeded',
  'payment_intent.payment_failed', 'refund.created', 'refund.updated', 'refund.failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
  'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'];
try {
  if (process.env.APP_ENV !== 'production') throw new Error('Run against the production service environment only.');
  const configuration = stripeConfiguration(process.env);
  if (configuration.mode !== 'LIVE' || !configuration.configured) throw new Error('A live Stripe key is required.');
  if (!configuration.accountId) throw new Error('STRIPE_ACCOUNT_ID must identify the approved live account.');
  if (!configuration.webhookConfigured) throw new Error('STRIPE_WEBHOOK_SECRET is missing.');
  // Temporarily authorize this read-only verification call; never changes env/flags.
  const account = await verifyStripeAccount({...process.env, STRIPE_LIVE_PAYMENTS_ENABLED: 'true'});
  const endpoints = [];
  let after = '';
  do {
    const response = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100' +
      (after ? '&starting_after=' + encodeURIComponent(after) : ''), {
      headers: {Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Stripe-Version': '2026-08-26.dahlia'},
      signal: AbortSignal.timeout(15000)
    });
    const page = await response.json();
    if (!response.ok || !Array.isArray(page.data)) throw new Error('Webhook endpoint read failed; check key permissions.');
    endpoints.push(...page.data);
    after = page.has_more ? page.data.at(-1)?.id : '';
    if (page.has_more && !after) throw new Error('Webhook pagination incomplete.');
  } while (after);
  const expectedUrl = 'https://api.thelolabooth.com/api/webhooks/stripe';
  const endpoint = endpoints.find(row => row.url === expectedUrl && row.status === 'enabled' && row.livemode === true);
  if (!endpoint) throw new Error('No enabled live webhook endpoint matches ' + expectedUrl);
  const missing = requiredEvents.filter(type => !endpoint.enabled_events?.includes('*') && !endpoint.enabled_events?.includes(type));
  if (missing.length) throw new Error('Webhook subscriptions missing: ' + missing.join(', '));
  console.log(JSON.stringify({configuration: 'PASS', account, endpointId: endpoint.id,
    endpointUrl: expectedUrl, livePaymentsEnabled: configuration.enabled,
    signedDelivery: 'NOT VERIFIED: qualify delivery and signing-secret match separately',
    customerTransaction: 'NOT RUN'}));
} catch (error) {
  console.error(JSON.stringify({configuration: 'FAIL', reason: error.message}));
  process.exitCode = 1;
}
