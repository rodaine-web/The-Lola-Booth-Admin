// Standalone launch diagnostic: GET requests only. Never prints credentials.
try {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!/^(sk|rk)_live_/.test(key)) throw new Error('Configured production key is not a live Stripe key.');
  const headers = {Authorization: `Bearer ${key}`, 'Stripe-Version': '2026-08-26.dahlia'};
  const response = await fetch('https://api.stripe.com/v1/account', {headers, signal: AbortSignal.timeout(15000)});
  const account = await response.json();
  if (!response.ok || account.id !== process.env.STRIPE_ACCOUNT_ID) throw new Error('Production key/account verification failed.');
  if (!account.charges_enabled) throw new Error('Live charges are not enabled on the account.');
  const endpointResponse = await fetch('https://api.stripe.com/v1/webhook_endpoints/' + encodeURIComponent(process.env.STRIPE_WEBHOOK_ENDPOINT_ID), {headers, signal: AbortSignal.timeout(15000)});
  const endpoint = await endpointResponse.json();
  if (!endpointResponse.ok || endpoint.livemode !== true || endpoint.url !== 'https://api.thelolabooth.com/api/webhooks/stripe') throw new Error('Live webhook does not match the approved production endpoint.');
  if (endpoint.api_version !== '2026-08-26.dahlia') throw new Error('Webhook API version does not match the application.');
  console.log(JSON.stringify({result: 'PASS', accountId: account.id, chargesEnabled: true, endpointId: endpoint.id, endpointStatus: endpoint.status, signedDelivery: 'NOT VERIFIED', customerTransaction: 'NOT RUN'}));
} catch (error) {
  console.error(JSON.stringify({result: 'FAIL', reason: error.message}));
  process.exitCode = 1;
}
