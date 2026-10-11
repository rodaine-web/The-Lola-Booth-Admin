// Standalone launch diagnostic: GET requests only. Never prints credentials.
try {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!/^(sk|rk)_live_/.test(key)) {
    const category = !key ? 'MISSING' : key.includes('${{') ? 'UNRESOLVED_REFERENCE' : /^(sk|rk)_test_/.test(key) ? 'TEST_KEY' : /^(sk|rk)_live_/.test(key.trim()) ? 'LIVE_KEY_WITH_WHITESPACE' : /^pk_/.test(key) ? 'PUBLISHABLE_KEY' : 'INVALID_KEY_FORMAT';
    throw new Error('Production secret-key configuration: ' + category);
  }
  const headers = {Authorization: `Bearer ${key}`, 'Stripe-Version': '2026-08-26.dahlia'};
  const response = await fetch('https://api.stripe.com/v1/account', {headers, signal: AbortSignal.timeout(15000)});
  const account = await response.json();
  if (!response.ok || account.id !== process.env.STRIPE_ACCOUNT_ID) throw new Error('Production key/account verification failed.');
  if (!account.charges_enabled) throw new Error('Live charges are not enabled on the account.');
  const endpointResponse = await fetch('https://api.stripe.com/v1/webhook_endpoints/' + encodeURIComponent(process.env.STRIPE_WEBHOOK_ENDPOINT_ID), {headers, signal: AbortSignal.timeout(15000)});
  const endpoint = await endpointResponse.json();
  if (!endpointResponse.ok || endpoint.livemode !== true || endpoint.url !== 'https://api.thelolabooth.com/api/webhooks/stripe') throw new Error('Live webhook does not match the approved production endpoint.');
  if (endpoint.api_version !== '2026-08-26.dahlia') throw new Error('Webhook API version does not match the application.');
  let signingSecretMatch = 'NOT VERIFIED';
  if (process.env.STRIPE_EXPECTED_WEBHOOK_SECRET) {
    const {timingSafeEqual} = await import('node:crypto');
    const actual = Buffer.from(process.env.STRIPE_WEBHOOK_SECRET || '');
    const expected = Buffer.from(process.env.STRIPE_EXPECTED_WEBHOOK_SECRET);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Production signing secret does not match the newly registered endpoint.');
    signingSecretMatch = true;
  }
  console.log(JSON.stringify({result: 'PASS', accountId: account.id, chargesEnabled: true, endpointId: endpoint.id, endpointStatus: endpoint.status, signingSecretMatch, livePaymentsEnabled: process.env.STRIPE_LIVE_PAYMENTS_ENABLED === 'true', signedDelivery: 'NOT VERIFIED', customerTransaction: 'NOT RUN'}));
} catch (error) {
  console.error(JSON.stringify({result: 'FAIL', reason: error.message}));
  process.exitCode = 1;
}
