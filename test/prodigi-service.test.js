import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {prodigiStatus, prodigiRequest, prodigiVariant, prodigiQuote, createProdigiDraft,
  submitProdigiOrder, getProdigiOrder, prodigiShipments, cancelProdigiOrder, prodigiMoneyCents,
  verifyProdigiSignature, printSpecFromVariant} from '../server/src/services/prodigi-service.js';

const config = {APP_ENV: 'staging', PRODIGI_SANDBOX_API_KEY: 'sandbox_fixture-key'};
const ok = data => ({ok: true, status: 200, json: async () => ({data})});
const payload = {merchantReference: 'fixture', recipient: {name: 'Synthetic Guest', address: {line1: '1 Test',townOrCity: 'Test',postalOrZipCode: '01234',countryCode: 'US'}}, items: [{sku: 'GLOBAL-MUG-W', quantity: 1, assets: [{printArea: 'default', url: 'https://example.test/artwork/immutable.jpg'}]}]};

test('Prodigi sandbox requires explicit safe environment and genuine sandbox key', async () => {
  for (const unsafe of [{...config, APP_ENV: 'production'}, {...config, APP_ENV: ''}, {...config, PRODIGI_SANDBOX_API_KEY: 'live_key'}, {...config, PRODIGI_SANDBOX_API_KEY: 'test_key'}]) {
    assert.equal(prodigiStatus(unsafe).enabled, false);
    await assert.rejects(prodigiVariant('GLOBAL-MUG-W', () => assert.fail('must not call supplier'), unsafe), {code: 'PRODIGI_UNAVAILABLE'});
  }
  assert.equal(prodigiStatus(config).readiness, 'SANDBOX_READY');
  assert.equal(JSON.stringify(prodigiStatus(config)).includes(config.PRODIGI_SANDBOX_API_KEY), false);
});

test('fixed v5 catalogue and quote schemas preserve supplier amounts and customer destination ZIP', async () => {
  const calls = [];
  const request = async (url, options) => {calls.push({url,options}); return ok({total: {amount: '14.95',currency: 'USD'}});};
  await prodigiVariant('GLOBAL-MUG-W', request, config);
  const body = {items: [{catalogueVariantId: 'GLOBAL-MUG-W', quantity: 2}], shippingAddress: payload.recipient.address, currencyCode: 'USD'};
  const quote = await prodigiQuote(body, request, config);
  assert.equal(calls[0].url, 'https://api.prodigi.com/v5/catalogue/variants/GLOBAL-MUG-W');
  assert.equal(calls[1].url, 'https://api.prodigi.com/v5/quotes/order');
  assert.deepEqual(JSON.parse(calls[1].options.body), body);
  assert.equal(calls[1].options.headers['X-API-Key'], config.PRODIGI_SANDBOX_API_KEY);
  assert.equal(prodigiMoneyCents(quote.total), 1495);
});

test('shared live account resource writes and path injection are impossible', async () => {
  for (const path of ['/assets', '/assets:ingest', '/products', '/webhooks', '/merchant/settings', '//evil.test', '/orders/../assets', '/catalogue/variants/GLOBAL-MUG-W?secret=1']) {
    await assert.rejects(prodigiRequest(path, {method: 'POST'}, () => assert.fail('must not request'), config), {code: 'PRODIGI_OPERATION_DISABLED'});
  }
  assert.throws(() => prodigiVariant('../merchant', fetch, config), {code: 'PRODIGI_VALIDATION'});
});

test('draft creation locks explicit submit false and stable idempotency; no implicit order submission', async () => {
  const calls = [];
  const request = async (url, options) => {calls.push({url,options}); return ok({id: 'ord_fixture', status: 'draft'});};
  const draft = await createProdigiDraft(payload, 'keepsakes-fixture-line1', request, config);
  assert.equal(draft.status, 'draft');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'keepsakes-fixture-line1');
  assert.equal(JSON.parse(calls[0].options.body).submit, false);
  assert.throws(() => createProdigiDraft({...payload, submit: true}, 'fixture', request, config));
  await assert.rejects(createProdigiDraft(payload, '', request, config));
  assert.throws(() => createProdigiDraft({...payload,items: [{sku: 'GLOBAL-MUG-W',quantity: 1,assets: [{assetId: 'asset_managed'}]}]}, 'fixture', request, config));
});

test('submission, reconciliation, tracking and cancellation are separate documented operations', async () => {
  const calls = [];
  const request = async (url, options) => {calls.push([url,options.method]); return ok({id: 'ord_fixture'});};
  await submitProdigiOrder('ord_fixture', request, config);
  await getProdigiOrder('ord_fixture', request, config);
  await prodigiShipments('ord_fixture', request, config);
  await cancelProdigiOrder('ord_fixture', request, config);
  assert.deepEqual(calls, [['https://api.prodigi.com/v5/orders/ord_fixture:submit','POST'],['https://api.prodigi.com/v5/orders/ord_fixture','GET'],['https://api.prodigi.com/v5/orders/ord_fixture/shipments','GET'],['https://api.prodigi.com/v5/orders/ord_fixture:cancel','POST']]);
});

test('quote money parses exact cents and rejects wrong currencies, malformed or fractional cents', () => {
  for (const [amount,cents] of [['0',0],['1.1',110],['10.05',1005]]) assert.equal(prodigiMoneyCents({amount,currency: 'USD'}),cents);
  for (const money of [{amount:'1.005',currency:'USD'},{amount:1,currency:'USD'},{amount:'1',currency:'GBP'},{amount:'-1',currency:'USD'}]) assert.throws(() => prodigiMoneyCents(money));
});

test('provider errors do not leak credentials or untrusted remote response text', async () => {
  const request = async () => ({ok:false,status:429,headers:new Headers({'Retry-After':'60'}),json:async () => ({message:config.PRODIGI_SANDBOX_API_KEY})});
  await assert.rejects(prodigiVariant('GLOBAL-MUG-W',request,config), err => err.code === 'PRODIGI_REQUEST_FAILED' && err.details.retryAfter === '60' && !JSON.stringify(err).includes(config.PRODIGI_SANDBOX_API_KEY));
});

test('v5 signed callback verifies raw bytes, tolerance, tampering and malformed signatures', () => {
  const raw = Buffer.from('{"id":"evt_fixture","type":"order.updated"}');
  const secret = 'fixture-signing-secret';
  const timestamp = 1800000000;
  const signature = createHmac('sha256',secret).update(`${timestamp}.`).update(raw).digest('hex');
  const header = `t=${timestamp}, v1=${signature}`;
  assert.equal(verifyProdigiSignature(raw,header,secret,timestamp*1000),true);
  assert.equal(verifyProdigiSignature(Buffer.from('{}'),header,secret,timestamp*1000),false);
  assert.equal(verifyProdigiSignature(raw,header,secret,(timestamp+301)*1000),false);
  assert.equal(verifyProdigiSignature(raw,header,secret,(timestamp-301)*1000),false);
  assert.equal(verifyProdigiSignature(raw,`t=${timestamp},v1=x`,secret,timestamp*1000),false);
  assert.equal(verifyProdigiSignature(raw,`${header},t=${timestamp}`,secret,timestamp*1000),false);
});

test('print specs use genuine API print areas and refuse missing template/bleed/safe/color requirements', () => {
  const variant = {sku:'fixture',printAreas:[{name:'default',required:true,widthMm:254,heightMm:127,recommendedDpi:300}]};
  const spec = printSpecFromVariant(variant);
  assert.equal(spec.areas[0].widthPx,3000);
  assert.equal(spec.areas[0].heightPx,1500);
  assert.equal(spec.ready,false);
  assert.ok(spec.missing.includes('bleed_safe_color:default'));
  assert.equal(printSpecFromVariant({printAreas:[{name:'default',recommendedDpi:300}]}).ready,false);
  const review = {templateUrl:'https://example.test/supplier-template',reviewedAt:'2026-11-21',reviewedBy:'operator',areas:{default:{bleedMm:0,safeInsetMm:3,colorProfile:'sRGB'}}};
  assert.equal(printSpecFromVariant(variant,review).ready,true);
});
