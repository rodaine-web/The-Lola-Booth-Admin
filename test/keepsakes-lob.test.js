import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {renderKeepsakesPostcardBack, sendKeepsakesLob, reconcileKeepsakesLob, keepsakesLobAddress} from '../server/src/services/keepsakes-lob.js';

const config = {APP_ENV: 'test', LOB_TEST_API_KEY: 'test_synthetic', LOB_STAGING_TEST_ENABLED: 'true'};
const address = {name: 'Synthetic Guest', address1: '12 Test Street', address2: 'Unit 2', city: 'Boston', state: 'MA', zip: '02134', country: 'US'};
const zone = {x: 70, y: 450, width: 780, height: 650};
const image = (width, height, background = '#ffffff') => sharp({create: {width, height, channels: 3, background}}).png().toBuffer();
const back = () => sharp({create: {width: 1875, height: 1275, channels: 3, background: '#ffffff'}})
  .composite([{input: Buffer.from('<svg width="600" height="200"><rect width="600" height="200" fill="#b22030"/><text x="20" y="100" fill="white" font-size="45">Approved brand art</text></svg>'), left: 70, top: 70}]).png().toBuffer();
const bytesOf = bytes => sharp(bytes).removeAlpha().raw().toBuffer();

test('retail back preserves full approved brand composition and changes only its explicit blank message zone', async () => {
  const input = await back(), rendered = await renderKeepsakesPostcardBack({bytes: input, message: 'A favorite memory from our event.\nWith love!', messageZone: zone});
  const metadata = await sharp(rendered).metadata();
  assert.equal(metadata.width, 1875); assert.equal(metadata.height, 1275);
  const before = await bytesOf(input), after = await bytesOf(rendered);
  let changes = 0;
  for (let y = 0; y < 1275; y++) for (let x = 0; x < 1875; x++) {
    const at = (y * 1875 + x) * 3;
    const differs = !before.subarray(at, at + 3).equals(after.subarray(at, at + 3));
    if (!differs) continue;
    changes++;
    assert.ok(x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height, `Unexpected pixel change at ${x},${y}`);
  }
  assert.ok(changes > 100);
});

test('XML-looking guest text is drawn literally and never parsed as artwork', async () => {
  const input = await back();
  const rendered = await renderKeepsakesPostcardBack({bytes: input, message: '<svg><rect fill="red" width="1875"/></svg> & hello', messageZone: zone});
  const right = await sharp(rendered).extract({left: 1000, top: 400, width: 200, height: 200}).removeAlpha().raw().toBuffer();
  assert.ok(right.every(value => value === 255));
  const brandBefore = await sharp(input).extract({left: 70, top: 70, width: 600, height: 200}).removeAlpha().raw().toBuffer();
  const brandAfter = await sharp(rendered).extract({left: 70, top: 70, width: 600, height: 200}).removeAlpha().raw().toBuffer();
  assert.ok(brandBefore.equals(brandAfter));
});

test('messages require an explicit compatible blank zone, and complete text must fit', async () => {
  const bytes = await back();
  await assert.rejects(renderKeepsakesPostcardBack({bytes, message: 'Hello'}), {code: 'MESSAGE_ZONE_REQUIRED'});
  await assert.rejects(renderKeepsakesPostcardBack({bytes, message: 'Hello', messageZone: {...zone, x: 1000}}), {code: 'MESSAGE_ZONE_REQUIRED'});
  await assert.rejects(renderKeepsakesPostcardBack({bytes, message: 'Hello', messageZone: {x: 70, y: 70, width: 600, height: 200}}), {code: 'MESSAGE_ZONE_REQUIRED'});
  await assert.rejects(renderKeepsakesPostcardBack({bytes, message: 'A long message '.repeat(40), messageZone: {...zone, height: 100}}), {code: 'MESSAGE_ZONE_REQUIRED'});
  const unchanged = await renderKeepsakesPostcardBack({bytes, message: ''});
  assert.ok((await bytesOf(bytes)).equals(await bytesOf(unchanged)));
});

test('retail back rejects dimensions that would require silently resizing the brand composition', async () => {
  await assert.rejects(renderKeepsakesPostcardBack({bytes: await image(1800, 1200), message: ''}), {code: 'KEEPSAKES_LOB_BACK_SPEC'});
});

test('US address mapping preserves leading-zero ZIP and rejects invalid state or excessive provider field lengths', () => {
  const result = keepsakesLobAddress(address);
  assert.equal(result.address_zip, '02134'); assert.equal(result.address_line2, 'Unit 2');
  assert.equal(result.address_country, 'US'); assert.equal(result.address_state, 'MA');
  assert.throws(() => keepsakesLobAddress({...address, state: 'Man'}), {code: 'KEEPSAKES_LOB_ADDRESS'});
  assert.throws(() => keepsakesLobAddress({...address, address1: 'x'.repeat(65)}), {code: 'KEEPSAKES_LOB_ADDRESS'});
});

test('production, live keys and disabled staging opt-in fail before any provider request', async () => {
  let calls = 0;
  const request = async () => {calls++; throw Error('should not be called');};
  for (const overridden of [{APP_ENV: 'production'}, {LOB_TEST_API_KEY: 'live_forbidden'}, {LOB_STAGING_TEST_ENABLED: 'false'}, {APP_ENV: 'unknown'}]) {
    await assert.rejects(sendKeepsakesLob({}, request, {...config, ...overridden}), {code: 'KEEPSAKES_LOB_SANDBOX_REQUIRED'});
  }
  assert.equal(calls, 0);
});

test('one test retail postcard uses mapped addresses, real print files and stable idempotency on retry', async () => {
  const front = await image(1800, 1200, '#336699'), approvedBack = await back(), requests = [];
  const request = async (url, options) => {
    requests.push({url, options});
    return {ok: true, status: 200, json: async () => ({id: 'psc_synthetic1', status: 'processed', to: {name: 'private'}, price: 'secret', metadata: {private: true}})};
  };
  const input = {idempotencyKey: 'keepsakes:order1:recipient1', front, back: approvedBack, to: address, from: {...address, name: 'The Lola Booth'}};
  const first = await sendKeepsakesLob(input, request, config), second = await sendKeepsakesLob(input, request, config);
  assert.equal(first.id, second.id); assert.equal(first.to, undefined); assert.equal(first.price, undefined); assert.equal(first.metadata, undefined);
  assert.equal(requests.length, 2);
  for (const {url, options} of requests) {
    assert.equal(url, 'https://api.lob.com/v1/postcards');
    assert.equal(options.headers['Idempotency-Key'], input.idempotencyKey);
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('test_synthetic:').toString('base64'));
    assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('to[address_zip]'), '02134');
    assert.equal(options.body.get('from[name]'), 'The Lola Booth');
    assert.equal(options.body.get('size'), '4x6');
    assert.equal(options.body.get('mail_type'), 'usps_first_class');
    assert.equal(options.body.get('use_type'), 'operational');
    for (const side of ['front', 'back']) {
      const upload = options.body.get(side);
      assert.equal(upload.type, 'image/png');
      const metadata = await sharp(Buffer.from(await upload.arrayBuffer())).metadata();
      assert.equal(metadata.width, 1875); assert.equal(metadata.height, 1275);
    }
  }
});

test('per-recipient reservations are required and provider failures never expose supplied secret/PII strings', async () => {
  await assert.rejects(sendKeepsakesLob({quantity: 2}, async () => {}, config), {code: 'KEEPSAKES_LOB_QUANTITY'});
  await assert.rejects(sendKeepsakesLob({idempotencyKey: 'bad\nheader'}, async () => {}, config), {code: 'KEEPSAKES_LOB_IDEMPOTENCY'});
  const input = {idempotencyKey: 'keepsakes:one', front: await image(1800, 1200), back: await back(), to: address, from: address};
  await assert.rejects(sendKeepsakesLob(input, async () => {throw Error('test_synthetic private@example.invalid');}, config), error => error.code === 'KEEPSAKES_LOB_OUTCOME_UNKNOWN' && error.details.outcomeUnknown && !/test_synthetic|private@example/.test(error.message));
  await assert.rejects(sendKeepsakesLob(input, async () => ({ok: false, status: 422, json: async () => ({error: {message: 'private@example.invalid test_synthetic'}})}), config), error => error.code === 'KEEPSAKES_LOB_REJECTED' && !/private@example|test_synthetic/.test(error.message));
});

test('reconciliation uses only the persisted postcard ID and returns raw test status without recipient data', async () => {
  let seen;
  const result = await reconcileKeepsakesLob('psc_synthetic1', async (url, options) => {
    seen = {url, options};
    return {ok: true, status: 200, json: async () => ({id: 'psc_synthetic1', status: 'rendered', expected_delivery_date: '2026-12-01', to: address, tracking_events: [{id: 'evt_1', type: 'in_transit', time: '2026-11-21', details: {address}}]})};
  }, config);
  assert.equal(seen.url, 'https://api.lob.com/v1/postcards/psc_synthetic1'); assert.equal(seen.options.method, 'GET');
  assert.equal(result.status, 'rendered'); assert.equal(result.expected_delivery_date, '2026-12-01'); assert.equal(result.to, undefined); assert.equal(result.tracking_events[0].details, undefined);
  await assert.rejects(reconcileKeepsakesLob('../live', async () => {}, config), {code: 'KEEPSAKES_LOB_REFERENCE'});
  await assert.rejects(reconcileKeepsakesLob('psc_synthetic1', async () => ({ok: true, json: async () => ({id: 'psc_other'})}), config), {code: 'KEEPSAKES_LOB_RESPONSE_INVALID'});
});
