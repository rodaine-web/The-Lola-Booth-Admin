import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';

test('Keepsakes isolates photo sessions, protects included originals, and fulfills only matching paid Stripe test orders', { skip: !process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL, timeout: 120000 }, async () => {
  const url = new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.match(url.pathname, /_qa$/);
  const schema = 'keepsakes_' + crypto.randomBytes(6).toString('hex'), bootstrap = new pg.Pool({ connectionString: url.toString() });
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lola-keepsakes-db-'));
  const originalFetch = globalThis.fetch, outbound = [], events = new Map(), taxReversals = [], taxReversalAttempts = [], taxCalculations = [], taxTransactions = [], lobRequests = [];
  let submitNotReady = false;
  let prodigiMode = 'success', prodigiOrderState = 'draft', prodigiCurrentId = 'ord_syntheticKeepsakes', prodigiCreates = 0, prodigiSubmits = 0, supplierArtworkUrl, supplierGate;
  let lobDelivered = false, localHttpOrigin, destinationTaxEnabled = false, taxReversalFails = false;
  const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
  let db;
  const signingSecret = 'whsec_synthetic_keepsakes_db_qa';
  try {
    await bootstrap.query('CREATE SCHEMA ' + schema); url.searchParams.set('options', '-c search_path=' + schema + ',public'); url.searchParams.set('application_name', schema);
    Object.assign(process.env, {
      DATABASE_URL: url.toString(), APP_ENV: 'test', NODE_ENV: 'test', GALLERY_ENABLED: 'true', GALLERY_STORAGE_PROVIDER: 'local', GALLERY_LOCAL_ROOT: storageRoot,
      GALLERY_PUBLIC_ORIGIN: 'https://staginggallery.thelolabooth.com', CLIENT_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'synthetic-keepsakes-gallery-signing-secret', INTEGRATION_SECRET_KEY: 'synthetic-keepsakes-encryption-secret',
      STRIPE_SECRET_KEY: 'sk_test_synthetic_keepsakes_qa', STRIPE_WEBHOOK_SECRET: signingSecret, STRIPE_ACCOUNT_ID: 'acct_syntheticKeepsakes',
      KEEPSAKES_CHECKOUT_ENABLED: 'false', KEEPSAKES_TAX_REVIEWED: 'false', KEEPSAKES_FULFILLMENT_ENABLED: 'false', EMAIL_PROVIDER: 'development', SMS_PROVIDER: 'none',
      PRODIGI_SANDBOX_API_KEY: 'sandbox_syntheticKeepsakes', KEEPSAKES_ARTWORK_ORIGIN: 'https://stagingapi.thelolabooth.com',
    });
    globalThis.fetch = async (input, options = {}) => {
      const address = new URL(typeof input === 'string' ? input : input.url), method = options.method || 'GET';
      if (localHttpOrigin && address.origin === localHttpOrigin && address.hostname === '127.0.0.1') return originalFetch(input, options);
      outbound.push({ host: address.host, path: address.pathname, method });
      const result = (json, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
      if (address.host === 'api.lob.com') {
        assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('test_syntheticKeepsakes:').toString('base64'));
        if (address.pathname === '/v1/postcards' && method === 'POST') {
          const form = options.body; assert.ok(form instanceof FormData);
          const front = Buffer.from(await form.get('front').arrayBuffer()), back = Buffer.from(await form.get('back').arrayBuffer());
          for (const bytes of [front, back]) { const metadata = await sharp(bytes).metadata(); assert.equal(metadata.width, 1875); assert.equal(metadata.height, 1275); }
          assert.equal(form.get('size'), '4x6'); assert.equal(form.get('mail_type'), 'usps_first_class'); assert.equal(form.get('use_type'), 'operational');
          const key = options.headers['Idempotency-Key']; assert.match(key, /^keepsakes:[a-f0-9-]{36}$/); assert.equal(form.get('metadata[keepsakes_reservation]'), key);
          const id = `psc_test${String(lobRequests.length + 1).padStart(4, '0')}`;
          lobRequests.push({ id, key, name: form.get('to[name]'), zip: form.get('to[address_zip]'), sender: form.get('from[name]'), frontHash: crypto.createHash('sha256').update(front).digest('hex'), backHash: crypto.createHash('sha256').update(back).digest('hex') });
          return result({ id, status: 'processed', send_date: '2035-11-19', expected_delivery_date: '2035-11-25' });
        }
        if (/^\/v1\/postcards\/psc_test\d{4}$/.test(address.pathname) && method === 'GET') return result({ id: address.pathname.split('/').at(-1), status: 'processed', send_date: '2035-11-19', expected_delivery_date: '2035-11-25', tracking_events: lobDelivered ? [{ id: 'evt_syntheticDelivered', name: 'Delivered', type: 'postcard.delivered', time: '2035-11-24T12:00:00Z' }] : [] });
        throw new Error('Unexpected synthetic Lob fixture request: ' + method + ' ' + address.pathname);
      }
      if (address.host === 'api.prodigi.com') {
        assert.equal(options.headers['X-API-Key'], 'sandbox_syntheticKeepsakes');
        if (address.pathname === '/v5/catalogue/variants/SYNTHETIC-PRINT') return result({ data: { sku: 'SYNTHETIC-PRINT', attributeOptions: {}, printAreas: [{ name: 'default', widthMm: 101.6, heightMm: 76.2, recommendedDpi: 300, required: true }] } });
        if (address.pathname === '/v5/quotes/order') return prodigiMode === 'reject' ? result({ error: 'Synthetic provider rejection' }, 429) : result({ data: { total: { amount: '5.00', currency: 'USD' }, shipping: { amount: '1.00', currency: 'USD' }, tax: { amount: '0.00', currency: 'USD' } } });
        if (address.pathname === '/v5/orders' && method === 'POST') {
          const body = JSON.parse(options.body); prodigiCreates++; assert.equal(body.submit, false); assert.match(options.headers['Idempotency-Key'], /^lola-keepsakes:[a-f0-9-]{36}$/);
          supplierArtworkUrl = body.items[0].assets[0].url; assert.match(supplierArtworkUrl, /^https:\/\/stagingapi\.thelolabooth\.com\/api\/keepsakes\/artwork\//);
          prodigiCurrentId = prodigiCreates === 1 ? 'ord_syntheticKeepsakes' : `ord_syntheticRace${prodigiCreates}`;
          if (supplierGate?.stage === 'create') { supplierGate.entered.resolve(); await supplierGate.release.promise; }
          return result({ data: { id: prodigiCurrentId, status: 'draft' } });
        }
        if (address.pathname === `/v5/orders/${prodigiCurrentId}:submit`) {
          prodigiSubmits++;
          if(submitNotReady){submitNotReady=false;return result({message:'Synthetic draft not ready'},409);}
          if (supplierGate?.stage === 'submit') { supplierGate.entered.resolve(); await supplierGate.release.promise; }
          prodigiOrderState = 'submitted'; return result({ data: { id: prodigiCurrentId, status: prodigiOrderState, issues: [] } });
        }
        if (address.pathname === `/v5/orders/${prodigiCurrentId}/shipments`) return result({ data: [{ carrier: 'Synthetic Carrier', trackingNumber: 'SYNTHETIC001', trackingUrl: 'https://example.invalid/tracking/SYNTHETIC001', dispatchedAt: '2035-11-19T12:00:00Z' }] });
        if (address.pathname === `/v5/orders/${prodigiCurrentId}`) return result({ data: { id: prodigiCurrentId, status: prodigiOrderState, issues: [] } });
        throw new Error('Unexpected synthetic Prodigi fixture request: ' + method + ' ' + address.pathname);
      }
      assert.equal(address.host, 'api.stripe.com', 'External requests must use only intercepted synthetic Stripe/Prodigi fixtures');
      if (address.pathname === '/v1/account') return result({ id: 'acct_syntheticKeepsakes', charges_enabled: true });
      if (address.pathname === '/v1/tax/transactions/create_from_calculation') {
        const body = new URLSearchParams(options.body), reference = body.get('reference'), match = /^keepsakes:([a-f0-9-]{36})(?::(\d+))?$/.exec(reference);
        assert.ok(match); assert.ok(taxCalculations.some((calculation) => calculation.id === body.get('calculation')));
        const orderId = match[1], index = Number(match[2] || 0), key = options.headers['Idempotency-Key'];
        assert.equal(key, `keepsakes-tax:${orderId}${index ? ':' + index : ''}`);
        let transaction = taxTransactions.find((record) => record.key === key);
        if (!transaction) { transaction = { id: `tax_synthetic${taxTransactions.length + 1}`, orderId, index, key, calculation: body.get('calculation') }; taxTransactions.push(transaction); }
        return result({ id: transaction.id });
      }
      if (address.pathname === '/v1/tax/transactions/create_reversal') {
        const body = new URLSearchParams(options.body), match = /^keepsakes-refund:([a-f0-9-]{36})(?::(\d+))?$/.exec(body.get('reference'));
        assert.ok(match); const orderId = match[1], index = Number(match[2] || 0), original = taxTransactions.find((record) => record.orderId === orderId && record.index === index);
        assert.ok(original); assert.equal(body.get('mode'), 'full'); assert.equal(body.get('original_transaction'), original.id);
        assert.equal(options.headers['Idempotency-Key'], `keepsakes-tax-reversal:${orderId}${index ? ':' + index : ''}`);
        taxReversalAttempts.push({ orderId, index, key: options.headers['Idempotency-Key'] });
        if (taxReversalFails && index === 1) { taxReversalFails = false; return result({ error: 'Synthetic tax accounting outage' }, 503); }
        taxReversals.push({ orderId, index, original: original.id, key: options.headers['Idempotency-Key'] });
        return result({ id: 'taxrev_' + taxReversals.length });
      }
      if (address.pathname.startsWith('/v1/payment_intents/')) { assert.equal(address.searchParams.get('expand[]'), 'latest_charge.balance_transaction'); return result({ latest_charge: { balance_transaction: { currency: 'usd', fee: 37 } } }); }
      if (address.pathname === '/v1/tax/calculations') {
        const body = new URLSearchParams(options.body), amounts = [...body].filter(([key]) => /^line_items\[\d+\]\[amount\]$/.test(key));
        const state = body.get('customer_details[address][state]'), zip = body.get('customer_details[address][postal_code]'), amount = amounts.reduce((sum, [, value]) => sum + Number(value), 0), taxCents = destinationTaxEnabled ? state === 'MA' ? 10 : state === 'CA' ? 20 : 0 : 0;
        const calculation = { id: `taxcalc_synthetic${taxCalculations.length + 1}`, state, zip, source: body.get('customer_details[address_source]'), amount, taxCents }; taxCalculations.push(calculation);
        return result({ id: calculation.id, tax_amount_exclusive: taxCents, amount_total: amount + Number(body.get('shipping_cost[amount]') || 0) + taxCents });
      }
      if (address.pathname === '/v1/checkout/sessions' && method === 'POST') {
        const body = new URLSearchParams(options.body), id = body.get('metadata[keepsakes_order_id]');
        assert.equal(body.get('mode'), 'payment'); assert.equal(body.get('payment_intent_data[metadata][keepsakes_order_id]'), id);
        assert.equal(options.headers['Idempotency-Key'], `keepsakes:${id}`); assert.equal(body.get('metadata[invoice_id]'), null);
        assert.equal([...body.keys()].some((key) => key.startsWith('payment_method_types')), false);
        return result({ id: 'cs_test_' + id.replaceAll('-', ''), url: 'https://checkout.stripe.com/c/pay/synthetic-' + id, livemode: false });
      }
      if (address.pathname.startsWith('/v1/events/')) return result(events.get(decodeURIComponent(address.pathname.split('/').at(-1))) || {}, events.has(decodeURIComponent(address.pathname.split('/').at(-1))) ? 200 : 404);
      throw new Error('Unexpected external request in synthetic Keepsakes test: ' + method + ' ' + address.pathname);
    };
    db = await import('../server/src/db/pool.js'); const { query, transaction } = db;
    const one = async (sql, values = []) => (await query(sql, values)).rows[0];
    for (const file of (await fs.readdir(new URL('../server/migrations/', import.meta.url))).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort()) await transaction(() => fs.readFile(new URL('../server/migrations/' + file, import.meta.url), 'utf8').then((sql) => query(sql)));
    const user = await one("INSERT INTO users(name,email,password_hash) VALUES('Synthetic Keepsakes Admin','keepsakes-admin@example.invalid','not-a-login') RETURNING id");
    await query("INSERT INTO roles(name) VALUES('ADMIN') ON CONFLICT DO NOTHING"); await query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='ADMIN'", [user.id]);
    const admin = { ...user, roles: ['ADMIN'], permissions: ['*'] }, stranger = { id: crypto.randomUUID(), roles: ['ATTENDANT'], permissions: ['read:events'] };
    const client = await one("INSERT INTO clients(name,email,client_type) VALUES('Synthetic Keepsakes Client','keepsakes-client@example.invalid','CORPORATE') RETURNING id");
    const gallery = await import('../server/src/services/private-gallery-service.js'), shop = await import('../server/src/services/keepsakes-service.js'), manager = await import('../server/src/services/keepsakes-admin-service.js');
    const core = await import('../server/src/services/keepsakes-core-catalogue-service.js');
    const coreBefore = await core.keepsakesCoreCatalogue(); assert.equal(coreBefore.products.length,12); assert.ok(coreBefore.products.every(p=>p.retailCents===null&&!p.available));
    await assert.rejects(core.saveCoreCataloguePrice('keychain',{retailCents:2499},stranger),{code:'FORBIDDEN'});
    await core.saveCoreCataloguePrice('keychain',{retailCents:2499},admin);
    const coreAfter=await core.keepsakesCoreCatalogue();assert.equal(coreAfter.products.find(p=>p.key==='keychain').retailCents,2499);assert.equal(coreAfter.products.find(p=>p.key==='keychain').available,true);
    await assert.rejects(core.saveCoreCataloguePrice('mug',{retailCents:2499},admin),{code:'NOT_FOUND'});

    const { photoLink } = await import('../server/src/services/gallery-photo-link-service.js');
    const { encryptSecretJson, decryptSecretJson } = await import('../server/src/services/integration-secrets.js');
    const createAlbum = async (name) => {
      const event = await one("INSERT INTO events(event_name,event_type,event_date,client_id) VALUES($1,'CORPORATE','2035-11-18',$2) RETURNING id", [name, client.id]);
      return gallery.createGalleryAlbum(event.id, name, admin);
    };
    const album = await createAlbum('Synthetic Keepsakes Gallery'), otherAlbum = await createAlbum('Other Private Event');
    let sequence = 0;
    const upload = async (target, name, hidden = false) => {
      const bytes = await sharp({ create: { width: 1800, height: 1400, channels: 3, background: { r: 40 + (++sequence * 9) % 190, g: 80, b: 105 } } }).jpeg({ quality: 90 }).toBuffer();
      const media = await gallery.uploadGalleryMedia(target.id, { filename: name, mime_type: 'image/jpeg', base64: bytes.toString('base64'), source_provider: 'MANUAL' });
      if (hidden) await query("UPDATE gallery_media SET status='HIDDEN' WHERE id=$1", [media.id]);
      return { ...media, bytes };
    };
    const outsider = await upload(otherAlbum, 'other-event-photo.jpeg');
    const unrelated = await upload(album, 'unrelated-guest.jpeg');
    const key = await gallery.createGalleryKey(album.id, 'ALBUM', null, null, admin);
    await query("UPDATE gallery_albums SET status='PUBLISHED',expires_at=now()+interval '1 year' WHERE id=ANY($1::uuid[])", [[album.id, otherAlbum.id]]);
    assert.deepEqual(await shop.keepsakesSettings(album.id), { enabled: false, brandedMerchandise: false, originalSales: false, productIds: [], returnAddress: null });
    await assert.rejects(manager.keepsakesAlbumAdmin(album.id, stranger), { code: 'FORBIDDEN' });

    // The only expansion permitted by a single-photo capability is an explicitly
    // confirmed same-album session, never all photos allowed by its parent key.
    const sessions = [];
    for (const originals of [1, 2, 3, 4, 6]) {
      const anchor = await upload(album, `session-${originals}-composite.jpeg`), raw = [];
      for (let i = 1; i <= originals; i++) raw.push(await upload(album, `session-${originals}-original-${i}.jpeg`, true));
      const assets = [{ mediaId: anchor.id, kind: 'COMPOSITE', label: 'Complete collage', sortOrder: 0, branded: true, merchandiseEligible: true, digitalEligible: false, included: true }, ...raw.map((media, index) => ({ mediaId: media.id, kind: index % 2 ? 'PROCESSED' : 'ORIGINAL', label: `Photo ${index + 1}`, sortOrder: index + 1, branded: false, merchandiseEligible: true, digitalEligible: true, included: false }))];
      await manager.saveKeepsakesSession(album.id, { anchorMediaId: anchor.id, sourceRef: `synthetic-session-${originals}`, assets }, admin);
      const token = (await photoLink(album.id, anchor.id)).url.split('/').at(-1), scope = await shop.keepsakesScope('photo', token);
      assert.equal(scope.assets.length, originals + 1); assert.deepEqual(scope.assets.map((a) => a.label), assets.map((a) => a.label));
      assert.ok(scope.assets.every((a) => a.width === 1800 && a.height === 1400));
      assert.ok(scope.assets.every((a) => a.media_id !== unrelated.id && a.media_id !== outsider.id));
      assert.equal((await shop.keepsakesView('photo', token)).enabled, false);
      const preview = await shop.keepsakesAsset('photo', token, scope.assets[1].id), metadata = await sharp(preview).metadata();
      assert.ok(metadata.width <= 1200 && metadata.height <= 1200); assert.notEqual(preview.length, raw[0].bytes.length);
      sessions.push({ anchor, raw, assets, token, scope });
    }
    const first = sessions[0], last = sessions.at(-1);
    await assert.rejects(shop.keepsakesAsset('photo', first.token, last.scope.assets[1].id), { code: 'KEEPSAKES_UNAVAILABLE' });
    await assert.rejects(manager.saveKeepsakesSession(album.id, { anchorMediaId: first.anchor.id, assets: [first.assets[0], { ...first.assets[1], mediaId: outsider.id }] }, admin), { code: 'KEEPSAKES_SESSION_MISMATCH' });
    await assert.rejects(manager.saveKeepsakesSession(album.id, { anchorMediaId: unrelated.id, assets: [{ ...first.assets[0], mediaId: unrelated.id }, first.assets[1]] }, admin), { code: 'KEEPSAKES_SESSION_OVERLAP' });
    await assert.rejects(manager.saveKeepsakesSession(album.id, { anchorMediaId: first.anchor.id, assets: [{ ...first.assets[0], digitalEligible: true }, first.assets[1]] }, admin), { code: 'KEEPSAKES_INCLUDED_ASSET' });
    const completeVisible = await upload(album, 'already-free-original.jpeg');
    await assert.rejects(manager.saveKeepsakesSession(album.id, { anchorMediaId: completeVisible.id, assets: [{ ...first.assets[1], mediaId: completeVisible.id }] }, admin), { code: 'KEEPSAKES_INCLUDED_ASSET' });
    // The gallery's own free actions and visible media set remain unchanged.
    const albumGrant = (await import('../server/src/services/gallery-photo-link-service.js')).resolvePhotoLink;
    const freeView = await gallery.publicGalleryView((await albumGrant(first.token)).grant, false);
    assert.equal(freeView.allowDownload, true); assert.ok(freeView.media.some((m) => m.id === unrelated.id)); assert.ok(!freeView.media.some((m) => m.id === first.raw[0].id));

    const productInput = { title: 'Synthetic Digital Original', category: 'digital', provider: 'DIGITAL', active: false, retailCents: 799, currency: 'USD', taxCode: 'txcd_10505000', variants: [{ id: 'original', label: 'Original file' }] };
    let digital = await manager.saveKeepsakesProduct(null, productInput, admin);
    await assert.rejects(manager.saveKeepsakesProduct(digital.id, { ...productInput, active: true }, admin), { code: 'KEEPSAKES_SKU_UNVERIFIED' });
    assert.equal((await manager.verifyKeepsakesProduct(digital.id, admin)).verified, true, 'Product verification must persist before activation');
    digital = await manager.saveKeepsakesProduct(digital.id, { ...productInput, active: true }, admin);
    await manager.saveKeepsakesSettings(album.id, { enabled: true, brandedMerchandise: true, originalSales: true, productIds: [digital.id] }, admin);
    const shippingAddress = { name: 'Synthetic Guest', address1: '12 Test Street', address2: '', city: 'Test City', state: 'MA', zip: '02134', country: 'US' };
    const cart = { email: 'synthetic-guest@example.invalid', shippingAddress, items: [{ productId: digital.id, variantId: 'original', assetIds: [first.scope.assets[1].id], quantity: 1, customization: { fit: 'contain', zoom: 1, x: .5, y: .5 }, recipients: [] }] };
    await assert.rejects(shop.quoteKeepsakes('photo', first.token, { ...cart, items: [{ ...cart.items[0], assetIds: [first.scope.assets[0].id] }] }), { code: 'KEEPSAKES_DIGITAL_NOT_ELIGIBLE' });
    await assert.rejects(shop.quoteKeepsakes('photo', first.token, { ...cart, items: [{ ...cart.items[0], assetIds: [last.scope.assets[1].id] }] }), { code: 'KEEPSAKES_UNAVAILABLE' });
    const previewQuote = await shop.quoteKeepsakes('photo', first.token, cart); assert.equal(previewQuote.checkoutReady, false); assert.equal(outbound.length, 0);
    await assert.rejects(shop.checkoutKeepsakes('photo', first.token, previewQuote.quoteId), { code: 'KEEPSAKES_CHECKOUT_NOT_READY' });
    Object.assign(process.env, { KEEPSAKES_CHECKOUT_ENABLED: 'true', KEEPSAKES_FULFILLMENT_ENABLED:'true', KEEPSAKES_TAX_REVIEWED: 'true' });
    const quote = await shop.quoteKeepsakes('photo', first.token, cart); assert.equal(quote.checkoutReady, true); assert.equal(quote.totalCents, 799);
    await assert.rejects(shop.checkoutKeepsakes('photo', last.token, quote.quoteId), { code: 'KEEPSAKES_QUOTE_EXPIRED' });
    await manager.saveKeepsakesSettings(album.id, { enabled: true, brandedMerchandise: true, originalSales: false, productIds: [digital.id] }, admin);
    await assert.rejects(shop.checkoutKeepsakes('photo', first.token, quote.quoteId), { code: 'KEEPSAKES_QUOTE_CHANGED' });
    await manager.saveKeepsakesSettings(album.id, { enabled: true, brandedMerchandise: true, originalSales: true, productIds: [digital.id] }, admin);
    const checkout = await shop.checkoutKeepsakes('photo', first.token, quote.quoteId); assert.match(checkout.url, /^https:\/\/checkout\.stripe\.com\//);
    assert.deepEqual(await shop.checkoutKeepsakes('photo', first.token, quote.quoteId), checkout);
    let order = await one('SELECT * FROM keepsakes_orders WHERE quote_id=$1', [quote.quoteId]); const contact = decryptSecretJson(order.contact_ciphertext);
    assert.equal(order.status, 'AWAITING_PAYMENT'); assert.equal((await one('SELECT count(*)::int n FROM keepsakes_fulfillments')).n, 0);
    assert.equal(outbound.filter((request) => request.path === '/v1/checkout/sessions').length, 1);
    assert.ok(!(await shop.keepsakesOrderView(contact.statusToken)).downloads.length);
    const { handleStripeWebhook } = await import('../server/src/services/payment-service.js');
    const deliver = async (event, validSignature = true) => {
      events.set(event.id, event); const body = Buffer.from(JSON.stringify(event)), timestamp = Math.floor(Date.now() / 1000);
      const hash = crypto.createHmac('sha256', signingSecret).update(`${timestamp}.`).update(body).digest('hex');
      return handleStripeWebhook(body, `t=${timestamp},v1=${validSignature ? hash : '0'.repeat(64)}`);
    };
    const paidEvent = { id: 'evt_syntheticKeepsakesPaid', type: 'checkout.session.completed', livemode: false, data: { object: { id: order.stripe_session_id, payment_status: 'paid', amount_total: 799, currency: 'usd', payment_intent: 'pi_syntheticKeepsakes', metadata: { keepsakes_order_id: order.id } } } };
    await assert.rejects(deliver(paidEvent, false), { code: 'INVALID_STRIPE_SIGNATURE' });
    await assert.rejects(deliver({ ...paidEvent, id: 'evt_syntheticWrongMode', livemode: true }), { code: 'LIVE_PAYMENTS_DISABLED' });
    for (const [field, value] of [['amount_total', 798], ['id', 'cs_test_otherSession'], ['currency', 'eur']]) await assert.rejects(deliver({ ...paidEvent, id: `evt_syntheticMismatch_${field}`, data: { object: { ...paidEvent.data.object, [field]: value } } }), { code: 'KEEPSAKES_PAYMENT_MISMATCH' });
    assert.equal((await one('SELECT count(*)::int n FROM keepsakes_fulfillments')).n, 0);
    await Promise.all([deliver(paidEvent), deliver(paidEvent)]); await deliver(paidEvent);
    order = await one('SELECT * FROM keepsakes_orders WHERE id=$1', [order.id]); assert.equal(order.status, 'PAID'); assert.ok(order.paid_at);
    assert.equal((await one('SELECT count(*)::int n FROM keepsakes_fulfillments WHERE order_id=$1', [order.id])).n, 1);
    assert.equal((await one("SELECT count(*)::int n FROM webhook_events WHERE provider='STRIPE' AND external_event_id=$1 AND status='PROCESSED'", [paidEvent.id])).n, 1);
    assert.equal((await one("SELECT count(*)::int n FROM keepsakes_events WHERE provider_event_id=$1", [paidEvent.id])).n, 1);

    const worker = await import('../server/src/services/keepsakes-fulfillment-service.js');
    process.env.KEEPSAKES_FULFILLMENT_ENABLED = 'false';
    assert.deepEqual(await worker.processKeepsakesQueue({ limit: 5 }), []);
    assert.equal((await one('SELECT count(*)::int n FROM keepsakes_entitlements')).n, 0);
    process.env.KEEPSAKES_FULFILLMENT_ENABLED = 'true';
    const grants = await Promise.all([worker.processKeepsakesQueue({ limit: 5 }), worker.processKeepsakesQueue({ limit: 5 })]);
    assert.equal(grants.flat().length, 1); assert.equal(grants.flat()[0].status, 'PROCESSED');
    assert.equal((await one('SELECT count(*)::int n FROM keepsakes_entitlements WHERE order_id=$1', [order.id])).n, 1);
    assert.equal((await one('SELECT status FROM keepsakes_fulfillments WHERE order_id=$1', [order.id])).status, 'COMPLETE');
    const settled = await one('SELECT * FROM keepsakes_orders WHERE id=$1', [order.id]);
    const paidThumb=await shop.keepsakesOrderPreview(contact.statusToken,0),paidThumbMeta=await sharp(paidThumb).metadata();
    assert.ok(paidThumbMeta.width<=1200&&paidThumbMeta.height<=1200);assert.equal(paidThumbMeta.exif,undefined);assert.notEqual(paidThumb.length,first.raw[0].bytes.length);
    await assert.rejects(shop.keepsakesOrderPreview(contact.statusToken,99),{code:'KEEPSAKES_UNAVAILABLE'});
    assert.equal(settled.status, 'COMPLETE'); assert.equal(settled.stripe_fee_cents, 37); assert.ok(settled.tax_transaction_id);
    assert.equal(settled.tax_transactions.length, 1); assert.equal(settled.tax_transactions[0].id, settled.tax_transaction_id);
    const taxRequests = outbound.filter((request) => request.path === '/v1/tax/transactions/create_from_calculation').length;
    assert.deepEqual(await worker.processKeepsakesQueue({ limit: 5 }), []);
    assert.equal(outbound.filter((request) => request.path === '/v1/tax/transactions/create_from_calculation').length, taxRequests);
    const source = await one('SELECT * FROM gallery_media WHERE id=$1', [first.raw[0].id]);
    const entitlement = await one('SELECT * FROM keepsakes_entitlements WHERE order_id=$1 AND media_id=$2', [order.id, source.id]);
    assert.ok(new Date(entitlement.expires_at).getTime() > Date.now() + 6 * 86400000);
    const download = await shop.keepsakesDownload(contact.statusToken, entitlement.id); assert.deepEqual(download.bytes, first.raw[0].bytes);
    await assert.rejects(shop.keepsakesDownload(crypto.randomBytes(32).toString('base64url'), entitlement.id), { code: 'KEEPSAKES_UNAVAILABLE' });
    await query("UPDATE keepsakes_entitlements SET expires_at=now()-interval '1 minute' WHERE id=$1", [entitlement.id]);
    await assert.rejects(shop.keepsakesDownload(contact.statusToken, entitlement.id), { code: 'KEEPSAKES_UNAVAILABLE' });
    assert.equal((await shop.keepsakesOrderView(contact.statusToken)).downloads.length, 0);
    await query("UPDATE keepsakes_entitlements SET expires_at=now()+interval '7 days' WHERE id=$1", [entitlement.id]);
    const fullRefund = { id: 'evt_syntheticKeepsakesRefund', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_syntheticKeepsakes', payment_intent: order.stripe_payment_intent, amount_refunded: 799 } } };
    const { processKeepsakesTaxRefunds } = await import('../server/src/services/keepsakes-refund-tax-service.js');
    await deliver(fullRefund);
    assert.equal(taxReversals.length, 0, 'The refund webhook must revoke access without waiting for tax accounting');
    assert.equal((await one('SELECT status,tax_refund_status FROM keepsakes_orders WHERE id=$1', [order.id])).status, 'REFUNDED');
    assert.equal((await one('SELECT tax_refund_status FROM keepsakes_orders WHERE id=$1', [order.id])).tax_refund_status, 'PENDING');
    await assert.rejects(shop.keepsakesDownload(contact.statusToken, entitlement.id), { code: 'KEEPSAKES_UNAVAILABLE' });
    await processKeepsakesTaxRefunds({ limit: 5 }); assert.equal(taxReversals.length, 1); assert.equal(taxReversals[0].orderId, order.id);
    await deliver(fullRefund); await processKeepsakesTaxRefunds({ limit: 5 }); assert.equal(taxReversals.length, 1, 'Duplicate signed refund webhooks must not create a second tax reversal');
    assert.equal((await one('SELECT status FROM keepsakes_orders WHERE id=$1', [order.id])).status, 'REFUNDED');
    assert.ok((await one('SELECT revoked_at FROM keepsakes_entitlements WHERE id=$1', [entitlement.id])).revoked_at);
    await assert.rejects(shop.keepsakesDownload(contact.statusToken, entitlement.id), { code: 'KEEPSAKES_UNAVAILABLE' });
    assert.equal((await shop.keepsakesOrderView(contact.statusToken)).downloads.length, 0);

    // A paid physical order is retained for review on supplier failure. A lost
    // processing lease never retries a supplier create automatically.
    const printSpec = { widthPx: 1200, heightPx: 900, dpi: 300, bleedPx: 0, safePx: 0 };
    const printInput = { title: 'Synthetic Photo Print', category: 'print', provider: 'PRODIGI', active: false, retailCents: 1499, currency: 'USD', taxCode: 'txcd_99999999', variants: [{ id: 'synthetic-print', label: 'Synthetic 4 × 3', sku: 'SYNTHETIC-PRINT', printSpec, specEvidence: { sourceUrl: 'https://www.prodigi.com/print-api/docs/', colorProfile: 'sRGB', bleedPx: 0, safePx: 0 } }] };
    let print = await manager.saveKeepsakesProduct(null, printInput, admin); await manager.verifyKeepsakesProduct(print.id, admin); print = await manager.saveKeepsakesProduct(print.id, { ...printInput, active: true }, admin);
    await manager.saveKeepsakesSettings(album.id, { enabled: true, brandedMerchandise: true, originalSales: true, productIds: [digital.id, print.id] }, admin);
    const printCart = { ...cart, items: [{ ...cart.items[0], productId: print.id, variantId: 'synthetic-print', assetIds: [first.scope.assets[0].id] }] };
    const physicalQuote = await shop.quoteKeepsakes('photo', first.token, printCart); assert.equal(physicalQuote.totalCents, 1599);
    await manager.saveKeepsakesSettings(album.id, { enabled: true, brandedMerchandise: false, originalSales: true, productIds: [digital.id, print.id] }, admin);
    await assert.rejects(shop.checkoutKeepsakes('photo', first.token, physicalQuote.quoteId, { proofReviewed: true }), { code: 'KEEPSAKES_QUOTE_CHANGED' });
    await manager.saveKeepsakesSettings(album.id, { enabled: true, brandedMerchandise: true, originalSales: true, productIds: [digital.id, print.id] }, admin);
    await assert.rejects(shop.checkoutKeepsakes('photo', first.token, physicalQuote.quoteId), { code: 'KEEPSAKES_PROOF_REVIEW_REQUIRED' });
    await shop.checkoutKeepsakes('photo', first.token, physicalQuote.quoteId, { proofReviewed: true });
    const physicalOrder = await one('SELECT * FROM keepsakes_orders WHERE quote_id=$1', [physicalQuote.quoteId]);
    assert.ok(physicalOrder.snapshot.proofReviewedAt);
    await deliver({ ...paidEvent, id: 'evt_syntheticPrintPaid', data: { object: { ...paidEvent.data.object, id: physicalOrder.stripe_session_id, amount_total: 1599, payment_intent: 'pi_syntheticPrint', metadata: { keepsakes_order_id: physicalOrder.id } } } });
    prodigiMode = 'reject';
    assert.equal((await worker.processKeepsakesQueue({ limit: 5 }))[0].status, 'REQUIRES_REVIEW');
    let physical = await one('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1', [physicalOrder.id]);
    assert.equal(physical.status, 'REQUIRES_REVIEW'); assert.equal(physical.last_error, 'PRODIGI_REQUEST_FAILED'); assert.equal(prodigiCreates, 0);
    assert.equal(physical.artwork.length, 1); const lockedArtwork = physical.artwork;
    assert.equal((await one('SELECT status FROM keepsakes_orders WHERE id=$1', [physicalOrder.id])).status, 'REQUIRES_REVIEW');
    assert.ok((await one('SELECT paid_at FROM keepsakes_orders WHERE id=$1', [physicalOrder.id])).paid_at);
    await manager.retryKeepsakesOrder(physicalOrder.id, admin);
    await query("UPDATE keepsakes_fulfillments SET status='PROCESSING',lease_until=now()-interval '1 minute' WHERE id=$1", [physical.id]);
    const requestsBeforeLeaseRecovery = outbound.length;
    assert.deepEqual(await worker.processKeepsakesQueue({ limit: 5 }), []);
    physical = await one('SELECT * FROM keepsakes_fulfillments WHERE id=$1', [physical.id]);
    assert.equal(physical.status, 'REQUIRES_REVIEW'); assert.match(physical.last_error, /lease expired/); assert.equal(outbound.length, requestsBeforeLeaseRecovery);
    // An explicit administrator retry uses the saved artwork and one stable
    // supplier identity. Polls reconcile that same order through shipment.
    await manager.retryKeepsakesOrder(physicalOrder.id, admin); prodigiMode = 'success';
    assert.equal((await worker.processKeepsakesQueue({ limit: 5 }))[0].status, 'PROCESSED');
    physical = await one('SELECT * FROM keepsakes_fulfillments WHERE id=$1', [physical.id]);
    assert.equal(physical.status, 'SUBMITTED'); assert.equal(physical.provider_order_id, 'ord_syntheticKeepsakes'); assert.equal(prodigiCreates, 1); assert.equal(prodigiSubmits, 1);
    assert.equal(physical.provider_cost_cents, 400); assert.equal(physical.shipping_cost_cents, 100); assert.equal(physical.artwork.length, 1);
    assert.deepEqual(physical.artwork, lockedArtwork, 'Administrator retry must reuse the immutable purchased artwork');
    const artToken = new URL(supplierArtworkUrl).pathname.split('/').at(-1), artwork = await worker.keepsakesSupplierArtwork(artToken), artMetadata = await sharp(artwork).metadata();
    assert.equal(artMetadata.width, 1200); assert.equal(artMetadata.height, 900); assert.equal(artMetadata.density, 300);
    await assert.rejects(worker.keepsakesSupplierArtwork(artToken + 'tampered'));
    await assert.rejects(worker.keepsakesSupplierArtwork(worker.keepsakesArtworkToken(physical.id, 0, physical.artwork[0].checksum, Math.floor(Date.now() / 1000) - 1)));
    prodigiOrderState = 'shipped'; await query('UPDATE keepsakes_fulfillments SET next_attempt_at=now() WHERE id=$1', [physical.id]);
    await worker.processKeepsakesQueue({ limit: 5 }); physical = await one('SELECT * FROM keepsakes_fulfillments WHERE id=$1', [physical.id]);
    assert.equal(physical.status, 'SHIPPED'); assert.equal(physical.tracking[0].trackingNumber, 'SYNTHETIC001'); assert.equal(prodigiCreates, 1);
    prodigiOrderState = 'completed'; await query('UPDATE keepsakes_fulfillments SET next_attempt_at=now() WHERE id=$1', [physical.id]);
    await worker.processKeepsakesQueue({ limit: 5 }); assert.equal((await one('SELECT status FROM keepsakes_orders WHERE id=$1', [physicalOrder.id])).status, 'COMPLETE'); assert.equal(prodigiCreates, 1); assert.equal(prodigiSubmits, 1);

    const beforePaidCancel = outbound.length;
    await assert.rejects(manager.cancelKeepsakesOrder(physicalOrder.id, admin), { code: 'KEEPSAKES_PAID_CANCEL_REQUIRES_REFUND' });
    assert.equal(outbound.length, beforePaidCancel, 'Rejecting a paid cancellation without refund must not cancel its supplier order');

    // Pause real worker execution inside the mocked supplier call. Observe the
    // refund transaction blocked on the same order lock before releasing it.
    for (const stage of ['create', 'submit']) {
      const reversalsBeforeRace = taxReversals.length;
      const raceQuote = await shop.quoteKeepsakes('photo', first.token, printCart); await shop.checkoutKeepsakes('photo', first.token, raceQuote.quoteId, { proofReviewed: true });
      const raceOrder = await one('SELECT * FROM keepsakes_orders WHERE quote_id=$1', [raceQuote.quoteId]);
      const racePaid = { ...paidEvent, id: `evt_syntheticRacePaid_${stage}`, data: { object: { ...paidEvent.data.object, id: raceOrder.stripe_session_id, amount_total: 1599, payment_intent: `pi_syntheticRace_${stage}`, metadata: { keepsakes_order_id: raceOrder.id } } } };
      await deliver(racePaid); prodigiOrderState = 'draft';
      const gate = { stage, entered: deferred(), release: deferred() }; supplierGate = gate;
      const workerPromise = worker.processKeepsakesQueue({ limit: 1 });
      await Promise.race([gate.entered.promise, workerPromise.then(() => { throw new Error(`Supplier ${stage} fixture was not reached`); })]);
      let refundSettled = false;
      const refundPromise = deliver({ id: `evt_syntheticRaceRefund_${stage}`, type: 'charge.refunded', livemode: false, data: { object: { id: `ch_syntheticRace_${stage}`, payment_intent: `pi_syntheticRace_${stage}`, amount_refunded: 1599 } } }).then((value) => { refundSettled = true; return value; });
      const completion = Promise.allSettled([workerPromise, refundPromise]); let concurrencyError;
      try {
        let waiting = false;
        for (let n = 0; n < 100 && !waiting; n++) {
          waiting = Boolean((await one("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory' AND query LIKE 'SELECT pg_advisory_xact_lock%' LIMIT 1", [schema])));
          if (!waiting) await new Promise((resolve) => setImmediate(resolve));
        }
        assert.equal(waiting, true, `Refund must wait for the supplier ${stage} order lock`); assert.equal(refundSettled, false);
        assert.equal((await one('SELECT status FROM keepsakes_orders WHERE id=$1', [raceOrder.id])).status, 'PAID');
      } catch (error) { concurrencyError = error; } finally { gate.release.resolve(); }
      const completed = await completion; supplierGate = null;
      if (concurrencyError) throw concurrencyError;
      for (const result of completed) if (result.status === 'rejected') throw result.reason;
      const refunded = await one('SELECT * FROM keepsakes_orders WHERE id=$1', [raceOrder.id]);
      assert.equal(refunded.status, 'REFUNDED'); assert.equal(refunded.refunded_cents, 1599); assert.ok(refunded.paid_at);
      await processKeepsakesTaxRefunds({ limit: 5 });
      assert.equal(taxReversals.length, reversalsBeforeRace + 1); assert.equal(taxReversals.at(-1).orderId, raceOrder.id);
      assert.equal((await one('SELECT status FROM keepsakes_fulfillments WHERE order_id=$1', [raceOrder.id])).status, 'REQUIRES_REVIEW');
      await deliver({ ...racePaid, id: `evt_syntheticLatePaid_${stage}` });
      await worker.processKeepsakesQueue({ limit: 5 });
      assert.equal((await one('SELECT status FROM keepsakes_orders WHERE id=$1', [raceOrder.id])).status, 'REFUNDED', 'Late payment events and worker aggregation must not overwrite a refund');
      await assert.rejects(worker.keepsakesSupplierArtwork(new URL(supplierArtworkUrl).pathname.split('/').at(-1)));
      await assert.rejects(manager.retryKeepsakesOrder(raceOrder.id, admin), { code: 'KEEPSAKES_RETRY_BLOCKED' });
    }
    assert.equal(prodigiCreates, 3); assert.equal(prodigiSubmits, 3);
    assert.equal(taxReversals.length, 3); assert.equal(new Set(taxReversals.map((reversal) => reversal.key)).size, 3);

    // Historical Lob outcomes are seeded as records only: no Lob API request or
    // postcard draft is created to prove the 23-hour manual-retry protection.
    const lobSnapshot = { items: [{ ...physicalOrder.snapshot.items[0], product: { ...physicalOrder.snapshot.items[0].product, provider: 'LOB', category: 'postcard' }, recipients: [{ ...shippingAddress, message: 'Synthetic postcard' }] }] };
    const lobQuote = await one('INSERT INTO keepsakes_quotes(album_id,scope_hash,snapshot,contact_ciphertext,subtotal_cents,shipping_cents,tax_cents,total_cents) VALUES($1,$2,$3,$4,599,0,0,599) RETURNING id', [album.id, first.scope.scopeHash, JSON.stringify(lobSnapshot), physicalOrder.contact_ciphertext]);
    const lobOrder = await one("INSERT INTO keepsakes_orders(quote_id,album_id,token_hash,contact_ciphertext,snapshot,subtotal_cents,shipping_cents,tax_cents,total_cents,status,paid_at) VALUES($1,$2,$3,$4,$5,599,0,0,599,'REQUIRES_REVIEW',now()) RETURNING id", [lobQuote.id, album.id, shop.keepsakesHash(crypto.randomBytes(32).toString('base64url')), physicalOrder.contact_ciphertext, JSON.stringify(lobSnapshot)]);
    const lobJob = await one("INSERT INTO keepsakes_fulfillments(order_id,item_index,provider,status,attempts,created_at) VALUES($1,0,'LOB','REQUIRES_REVIEW',1,now()-interval '24 hours') RETURNING id", [lobOrder.id]);
    const beforeLobRetry = outbound.length;
    await assert.rejects(manager.retryKeepsakesOrder(lobOrder.id, admin), { code: 'KEEPSAKES_LOB_OUTCOME_UNKNOWN' });
    assert.equal(outbound.length, beforeLobRetry); assert.equal((await one('SELECT attempts FROM keepsakes_fulfillments WHERE id=$1', [lobJob.id])).attempts, 1);
    assert.equal((await one('SELECT status FROM keepsakes_fulfillments WHERE id=$1', [lobJob.id])).status, 'REQUIRES_REVIEW');

    // Actual guest-paid Lob path: one native Stripe order splits into independent
    // recipient/copy reservations, separate from client-sponsored gallery mail.
    Object.assign(process.env, { LOB_TEST_API_KEY: 'test_syntheticKeepsakes', LOB_STAGING_TEST_ENABLED: 'true' });
    const postcardSource = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#7d6150' } }).jpeg().toBuffer();
    const postcardMedia = await gallery.uploadGalleryMedia(album.id, { filename: 'synthetic-retail-postcard.jpeg', mime_type: 'image/jpeg', base64: postcardSource.toString('base64') });
    await manager.saveKeepsakesSession(album.id, { anchorMediaId: postcardMedia.id, assets: [{ mediaId: postcardMedia.id, kind: 'COMPOSITE', label: 'Retail postcard photo', sortOrder: 0, branded: true, merchandiseEligible: true, digitalEligible: false, included: true }] }, admin);
    const postcardToken = (await photoLink(album.id, postcardMedia.id)).url.split('/').at(-1), postcardScope = await shop.keepsakesScope('photo', postcardToken);
    const postcardBack = await sharp({ create: { width: 1875, height: 1275, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const { galleryStorage } = await import('../server/src/services/gallery-storage.js'), storage = galleryStorage(), backKey = await storage.put(postcardBack, 'image/png'), backChecksum = crypto.createHash('sha256').update(postcardBack).digest('hex');
    const approvedBack = await one("INSERT INTO gallery_postcard_back_artworks(album_id,version,original_filename,mime_type,width_px,height_px,sha256,storage_provider,storage_key,status,created_by,approved_by,approved_at) VALUES($1,1,'synthetic-approved-back.png','image/png',1875,1275,$2,$3,$4,'APPROVED',$5,$5,now()) RETURNING id", [album.id, backChecksum, storage.provider, backKey, admin.id]);
    const postcardInput = { title: 'Synthetic Retail Postcard', category: 'postcard', provider: 'LOB', active: false, retailCents: 599, currency: 'USD', taxCode: 'txcd_99999999', variants: [{ id: '4x6', label: '4 × 6 inch postcard', printSpec: { widthPx: 1875, heightPx: 1275, dpi: 300, bleedPx: 37, safePx: 37 }, messageZone: { x: 50, y: 100, width: 800, height: 500 } }] };
    let postcard = await manager.saveKeepsakesProduct(null, postcardInput, admin); await manager.verifyKeepsakesProduct(postcard.id, admin); postcard = await manager.saveKeepsakesProduct(postcard.id, { ...postcardInput, active: true }, admin);
    const returnAddress = { ...shippingAddress, name: 'The Lola Booth QA' };
    await manager.saveKeepsakesSettings(album.id, { enabled: true, brandedMerchandise: true, originalSales: true, productIds: [digital.id, print.id, postcard.id], returnAddress }, admin);
    const recipientAddresses = [{ ...shippingAddress, name: 'Synthetic Recipient One', message: 'A note for recipient one.',messageFont:'typewriter',messageColor:'#17365d' }, { ...shippingAddress, name: 'Synthetic Recipient Two', address1: '22 Test Street', city: 'San Francisco', state: 'CA', zip: '94105', message: 'A different note for recipient two.',messageFont:'handwritten',messageColor:'#703040' }];
    const retailCart = { ...cart, items: [{ ...cart.items[0], productId: postcard.id, variantId: '4x6', assetIds: [postcardScope.assets[0].id], quantity: 2, returnAddress, recipients: recipientAddresses }] };
    const sponsoredCounts = await one('SELECT (SELECT count(*)::int FROM gallery_postcards) postcards,(SELECT count(*)::int FROM gallery_live_mailing_jobs) live,(SELECT count(*)::int FROM gallery_mailing_jobs) test');
    const beforeRetailCalculations = taxCalculations.length; destinationTaxEnabled = true;
    await assert.rejects(shop.quoteKeepsakes('photo',postcardToken,{...retailCart,items:[{...retailCart.items[0],returnAddress:undefined}]}),{code:'KEEPSAKES_POSTCARD_ADDRESS'});
    const retailQuote = await shop.quoteKeepsakes('photo', postcardToken, retailCart); assert.equal(retailQuote.subtotalCents, 2396); assert.equal(retailQuote.taxCents, 30); assert.equal(retailQuote.totalCents, 2426); assert.equal(retailQuote.checkoutReady, true);
    const retailCalculations = taxCalculations.slice(beforeRetailCalculations);
    assert.equal(retailCalculations.length, 2); assert.deepEqual(retailCalculations.map(({ state, zip, source, amount, taxCents }) => ({ state, zip, source, amount, taxCents })), [{ state: 'MA', zip: '02134', source: 'shipping', amount: 1198, taxCents: 10 }, { state: 'CA', zip: '94105', source: 'shipping', amount: 1198, taxCents: 20 }]);
    assert.equal(retailQuote.proofs.length, 3); assert.equal(retailQuote.proofs.filter((proof) => proof.side === 'back').length, 2);
    await assert.rejects(shop.checkoutKeepsakes('photo', postcardToken, retailQuote.quoteId), { code: 'KEEPSAKES_PROOF_REVIEW_REQUIRED' });
    await shop.checkoutKeepsakes('photo', postcardToken, retailQuote.quoteId, { proofReviewed: true });
    const retailOrder = await one('SELECT * FROM keepsakes_orders WHERE quote_id=$1', [retailQuote.quoteId]);
    assert.ok(retailOrder.snapshot.proofReviewedAt);
    const styledRecipients=shop.keepsakesSnapshot(retailOrder.snapshot).items[0].recipients;
    assert.deepEqual(styledRecipients.map(r=>[r.messageFont,r.messageColor]),[['typewriter','#17365d'],['handwritten','#703040']]);
    assert.equal(retailOrder.snapshot.items[0].recipients, undefined, 'Mailing recipients must remain encrypted at rest'); assert.ok(retailOrder.snapshot.items[0].recipientsCiphertext); assert.equal(retailOrder.snapshot.items[0].backArtworkId, approvedBack.id); assert.equal(retailOrder.snapshot.items[0].backArtworkChecksum, backChecksum);
    assert.deepEqual(retailOrder.snapshot.taxCalculations.map(({ id }) => id), retailCalculations.map(({ id }) => id)); assert.equal(retailOrder.snapshot.taxCalculationId, retailCalculations[0].id);
    const retailPaid = { ...paidEvent, id: 'evt_syntheticRetailLobPaid', data: { object: { ...paidEvent.data.object, id: retailOrder.stripe_session_id, amount_total: retailQuote.totalCents, payment_intent: 'pi_syntheticRetailLob', metadata: { keepsakes_order_id: retailOrder.id } } } };
    await deliver(retailPaid); await deliver(retailPaid);
    let retailJobs = (await query('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 ORDER BY recipient_index,copy_index', [retailOrder.id])).rows;
    assert.equal(retailJobs.length, 4); assert.deepEqual(retailJobs.map((job) => `${job.recipient_index}:${job.copy_index}`), ['0:0', '0:1', '1:0', '1:1']); assert.ok(retailJobs.every((job) => job.provider === 'LOB' && job.status === 'QUEUED'));
    const beforeRetailTaxRecordCalls = outbound.filter((request) => request.path === '/v1/tax/transactions/create_from_calculation').length;
    const retailProcessed = await worker.processKeepsakesQueue({ limit: 10 }); assert.equal(retailProcessed.length, 4); assert.ok(retailProcessed.every((job) => job.status === 'PROCESSED'));
    retailJobs = (await query('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 ORDER BY recipient_index,copy_index', [retailOrder.id])).rows;
    const recordedRetail = await one('SELECT * FROM keepsakes_orders WHERE id=$1', [retailOrder.id]), retailTaxRecords = taxTransactions.filter((record) => record.orderId === retailOrder.id);
    assert.equal(recordedRetail.tax_transactions.length, 2); assert.equal(retailTaxRecords.length, 2); assert.deepEqual(retailTaxRecords.map((record) => record.calculation), retailCalculations.map(({ id }) => id));
    assert.equal(outbound.filter((request) => request.path === '/v1/tax/transactions/create_from_calculation').length, beforeRetailTaxRecordCalls + 2);
    assert.deepEqual(retailTaxRecords.map(({ key }) => key), [`keepsakes-tax:${retailOrder.id}`, `keepsakes-tax:${retailOrder.id}:1`]);
    assert.ok(retailJobs.every((job) => job.status === 'SUBMITTED')); assert.equal(new Set(retailJobs.map((job) => job.provider_order_id)).size, 4);
    assert.equal(lobRequests.length, 4); assert.equal(new Set(lobRequests.map((call) => call.key)).size, 4); assert.equal(new Set(lobRequests.map((call) => call.frontHash)).size, 1); assert.equal(new Set(lobRequests.map((call) => call.backHash)).size, 2);
    assert.equal(lobRequests.filter((call) => call.name === 'Synthetic Recipient One' && call.zip === '02134').length, 2); assert.equal(lobRequests.filter((call) => call.name === 'Synthetic Recipient Two' && call.zip === '94105').length, 2); assert.ok(lobRequests.every((call) => call.sender === returnAddress.name));
    assert.ok(retailJobs.every((job) => lobRequests.some((call) => call.id === job.provider_order_id && call.key === `keepsakes:${job.id}`)));
    assert.deepEqual(await worker.processKeepsakesQueue({ limit: 10 }), []); assert.equal(lobRequests.length, 4);
    lobDelivered = true; await query('UPDATE keepsakes_fulfillments SET next_attempt_at=now() WHERE order_id=$1', [retailOrder.id]);
    await worker.processKeepsakesQueue({ limit: 10 });
    assert.ok((await query('SELECT status FROM keepsakes_fulfillments WHERE order_id=$1', [retailOrder.id])).rows.every((job) => job.status === 'COMPLETE'));
    assert.equal((await one('SELECT status FROM keepsakes_orders WHERE id=$1', [retailOrder.id])).status, 'COMPLETE'); assert.equal(lobRequests.length, 4);
    assert.equal(taxTransactions.filter((record) => record.orderId === retailOrder.id).length, 2, 'Copy fulfillment and delivery polls must reuse both recorded tax groups');
    assert.equal(outbound.filter((request) => request.path === '/v1/tax/transactions/create_from_calculation').length, beforeRetailTaxRecordCalls + 2);
    const reversalsBeforeRetailRefund = taxReversals.length, retailRefund = { id: 'evt_syntheticRetailLobRefund', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_syntheticRetailLob', payment_intent: 'pi_syntheticRetailLob', amount_refunded: retailQuote.totalCents } } };
    taxReversalFails = true; await deliver(retailRefund);
    assert.equal((await one('SELECT status FROM keepsakes_orders WHERE id=$1', [retailOrder.id])).status, 'REFUNDED'); assert.equal(taxReversals.length, reversalsBeforeRetailRefund);
    assert.equal((await one("SELECT status FROM webhook_events WHERE external_event_id=$1", [retailRefund.id])).status, 'PROCESSED');
    assert.equal((await processKeepsakesTaxRefunds({ limit: 5 }))[0].status, 'REQUIRES_REVIEW');
    const accountingFailed = await one('SELECT * FROM keepsakes_orders WHERE id=$1', [retailOrder.id]);
    assert.equal(accountingFailed.status, 'REFUNDED'); assert.equal(accountingFailed.tax_refund_status, 'REQUIRES_REVIEW'); assert.equal(accountingFailed.tax_reversals.length, 1); assert.equal(accountingFailed.tax_reversals[0].index, 0);
    assert.equal(taxReversals.length, reversalsBeforeRetailRefund + 1, 'The first completed destination reversal must remain durable when the second fails');
    const beforeAccountingRetry = outbound.length;
    assert.equal((await manager.cancelKeepsakesOrder(retailOrder.id, admin, { refund: true })).alreadyProcessed, true);
    assert.equal(outbound.length, beforeAccountingRetry, 'Accounting retry must not issue another Stripe refund or supplier cancellation');
    assert.equal((await one('SELECT tax_refund_status FROM keepsakes_orders WHERE id=$1', [retailOrder.id])).tax_refund_status, 'PENDING');
    assert.equal((await processKeepsakesTaxRefunds({ limit: 5 }))[0].status, 'COMPLETE');
    const accounted = await one('SELECT * FROM keepsakes_orders WHERE id=$1', [retailOrder.id]); assert.equal(accounted.status, 'REFUNDED'); assert.equal(accounted.tax_refund_status, 'COMPLETE'); assert.equal(accounted.tax_reversals.length, 2);
    assert.equal(taxReversalAttempts.filter((attempt) => attempt.orderId === retailOrder.id && attempt.index === 0).length, 1); assert.equal(taxReversalAttempts.filter((attempt) => attempt.orderId === retailOrder.id && attempt.index === 1).length, 2);
    assert.equal(taxReversals.length, reversalsBeforeRetailRefund + 2); assert.deepEqual(taxReversals.slice(-2).map(({ original }) => original), retailTaxRecords.map(({ id }) => id));
    await deliver(retailRefund); await deliver({ ...retailRefund, id: 'evt_syntheticRetailLobRefundRepeated' }); await processKeepsakesTaxRefunds({ limit: 5 }); assert.equal(taxReversals.length, reversalsBeforeRetailRefund + 2, 'Duplicate and repeated full refunds must not reverse either tax group twice');
    assert.deepEqual(await one('SELECT (SELECT count(*)::int FROM gallery_postcards) postcards,(SELECT count(*)::int FROM gallery_live_mailing_jobs) live,(SELECT count(*)::int FROM gallery_mailing_jobs) test'), sponsoredCounts);

    // A submitted Lob item blocks mixed-order refunds before the system even
    // looks up or cancels its other provider's already submitted order.
    const mixedSnapshot = { items: [physicalOrder.snapshot.items[0], retailOrder.snapshot.items[0]] };
    const mixedQuote = await one('INSERT INTO keepsakes_quotes(album_id,scope_hash,snapshot,contact_ciphertext,subtotal_cents,shipping_cents,tax_cents,total_cents) VALUES($1,$2,$3,$4,3895,100,0,3995) RETURNING id', [album.id, first.scope.scopeHash, JSON.stringify(mixedSnapshot), physicalOrder.contact_ciphertext]);
    const mixedOrder = await one("INSERT INTO keepsakes_orders(quote_id,album_id,token_hash,contact_ciphertext,snapshot,subtotal_cents,shipping_cents,tax_cents,total_cents,status,paid_at) VALUES($1,$2,$3,$4,$5,3895,100,0,3995,'FULFILLING',now()) RETURNING id", [mixedQuote.id, album.id, shop.keepsakesHash(crypto.randomBytes(32).toString('base64url')), physicalOrder.contact_ciphertext, JSON.stringify(mixedSnapshot)]);
    await query("INSERT INTO keepsakes_fulfillments(order_id,item_index,provider,status,provider_order_id) VALUES($1,0,'PRODIGI','SUBMITTED','ord_syntheticMixedPreflight'),($1,1,'LOB','SUBMITTED','psc_testMixedPreflight')", [mixedOrder.id]);
    const beforeMixedRefund = outbound.length;
    await assert.rejects(manager.cancelKeepsakesOrder(mixedOrder.id, admin, { refund: true }), { code: 'KEEPSAKES_LOB_CANCEL_REVIEW' });
    assert.equal(outbound.length, beforeMixedRefund, 'Lob preflight must run before any supplier lookup, cancellation or Stripe refund');
    assert.equal((await one('SELECT status FROM keepsakes_orders WHERE id=$1', [mixedOrder.id])).status, 'FULFILLING');
    assert.ok((await query('SELECT status FROM keepsakes_fulfillments WHERE order_id=$1', [mixedOrder.id])).rows.every((job) => job.status === 'SUBMITTED'));

    // Eventual supplier draft readiness retries the same saved order, then
    // submits it once. Failed/ambiguous creates retain their existing review gate.
    const delayedQuote = await shop.quoteKeepsakes('photo', first.token, printCart);
    await shop.checkoutKeepsakes('photo', first.token, delayedQuote.quoteId, { proofReviewed: true });
    const delayedOrder = await one('SELECT * FROM keepsakes_orders WHERE quote_id=$1', [delayedQuote.quoteId]);
    await deliver({ ...paidEvent, id: 'evt_syntheticDelayedDraft', data: { object: { ...paidEvent.data.object, id: delayedOrder.stripe_session_id, amount_total: delayedQuote.totalCents, payment_intent: 'pi_syntheticDelayedDraft', metadata: { keepsakes_order_id: delayedOrder.id } } } });
    prodigiOrderState='draft';submitNotReady=true;const createsBeforeDelay=prodigiCreates;
    await query("UPDATE keepsakes_fulfillments SET next_attempt_at=now()+interval '1 day' WHERE order_id<>$1 AND status IN('QUEUED','RETRY','SUBMITTED','SHIPPED')",[delayedOrder.id]);
    await worker.processKeepsakesQueue({limit:1});
    const delayedJob=await one('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1',[delayedOrder.id]);
    assert.equal(delayedJob.status,'RETRY');assert.equal(delayedJob.last_error,'PRODIGI_SUBMISSION_PENDING');
    assert.equal(prodigiCreates,createsBeforeDelay+1);assert.ok(delayedJob.provider_order_id);
    await query('UPDATE keepsakes_fulfillments SET next_attempt_at=now() WHERE id=$1',[delayedJob.id]);
    await worker.processKeepsakesQueue({limit:1});
    const delayedSubmitted=await one('SELECT * FROM keepsakes_fulfillments WHERE id=$1',[delayedJob.id]);
    assert.equal(delayedSubmitted.status,'SUBMITTED');assert.equal(delayedSubmitted.provider_order_id,delayedJob.provider_order_id);
    assert.equal(prodigiCreates,createsBeforeDelay+1);
    const temporary={code:'PRODIGI_REQUEST_FAILED',details:{providerStatus:409}};
    assert.equal(worker.prodigiDraftMayRetry({status:'draft',issues:[]},temporary,1),true);
    assert.equal(worker.prodigiDraftMayRetry({status:'draft',issues:[]},temporary,3),false);
    assert.equal(worker.prodigiDraftMayRetry({status:'draft',issues:[{code:'invalid_artwork'}]},temporary,1),false);
    assert.equal(worker.prodigiDraftMayRetry({status:'draft',issues:[]},{...temporary,details:{providerStatus:401}},1),false);

    // The approved back uses one unit per recipient, independently rendered
    // from the pinned asset, without a separately uploaded gallery back.
    const { messageZone: legacyZone, ...standardVariant } = postcardInput.variants[0];
    const standardInput = { ...postcardInput, title: 'Synthetic Approved Back', variants: [{ ...standardVariant, backTemplate: 'lola-connect-v2' }] };
    let standard = await manager.saveKeepsakesProduct(null, standardInput, admin);
    await manager.verifyKeepsakesProduct(standard.id, admin);
    standard = await manager.saveKeepsakesProduct(standard.id, { ...standardInput, active: true }, admin);
    await manager.saveKeepsakesSettings(album.id, { enabled: true, brandedMerchandise: true, originalSales: true, productIds: [digital.id, print.id, postcard.id, standard.id], returnAddress }, admin);
    const standardItem = { returnAddress, ...retailCart.items[0], productId: standard.id, quantity: 1, postcardArtworkColor: '#703040', recipients: Array.from({ length: 4 }, (_, i) => ({ ...retailCart.items[0].recipients[i % 2], message: `Approved postcard note ${i + 1}` })) };
    const standardCart = { ...retailCart, items: [standardItem] };
    await assert.rejects(shop.quoteKeepsakes('photo', postcardToken, { ...standardCart, items: [{ ...standardItem, quantity: 4 }] }), { code: 'KEEPSAKES_POSTCARD_QUANTITY' });
    const standardQuote = await shop.quoteKeepsakes('photo', postcardToken, standardCart);
    assert.equal(standardQuote.subtotalCents, 4 * standardInput.retailCents);
    assert.equal(standardQuote.proofs.length, 5);
    const standardSnapshot = (await one('SELECT snapshot FROM keepsakes_quotes WHERE id=$1', [standardQuote.quoteId])).snapshot;
    assert.equal(standardSnapshot.items[0].units, 4);
    assert.equal(standardSnapshot.items[0].backArtworkId, undefined);
    assert.equal(standardSnapshot.items[0].backArtworkChecksum, 'f22eedf5e365a2a1b797c85e13736a34e56bec82ff6a1ed45411001f48845eca');
    await shop.checkoutKeepsakes('photo', postcardToken, standardQuote.quoteId, { proofReviewed: true });
    const standardOrder = await one('SELECT * FROM keepsakes_orders WHERE quote_id=$1', [standardQuote.quoteId]);
    await deliver({ ...paidEvent, id: 'evt_syntheticApprovedBackPaid', data: { object: { ...paidEvent.data.object, id: standardOrder.stripe_session_id, amount_total: standardQuote.totalCents, payment_intent: 'pi_syntheticApprovedBack', metadata: { keepsakes_order_id: standardOrder.id } } } });
    const standardJobs = (await query('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 ORDER BY recipient_index', [standardOrder.id])).rows;
    assert.equal(standardJobs.length, 4);
    assert.ok(standardJobs.every(job => job.copy_index === 0));
    const lobCallsBeforeStandard = lobRequests.length;
    await worker.processKeepsakesQueue({ limit: 10 });
    assert.equal(lobRequests.length, lobCallsBeforeStandard + 4);
    assert.equal(new Set(lobRequests.slice(-4).map(call => call.backHash)).size, 4);

    // Verify the actual HTTP routers preserve authentication, capability scope,
    // private response headers and server-only credentials.
    const { default: express } = await import('express'), { keepsakesPublicRouter, keepsakesAdminRouter } = await import('../server/src/routes/keepsakes.js'), { errorHandler } = await import('../server/src/middleware/error-handler.js');
    const app = express(); app.use(express.json()); app.use('/api/keepsakes', keepsakesPublicRouter); app.use('/api/keepsakes-admin', keepsakesAdminRouter); app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); localHttpOrigin = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(localHttpOrigin + '/api/keepsakes-admin/')).status, 401);
      assert.equal((await fetch(localHttpOrigin + `/api/keepsakes-admin/albums/${album.id}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
      const response = await fetch(localHttpOrigin + `/api/keepsakes/access/photo/${first.token}`), publicView = await response.json(); assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.deepEqual(publicView.assets.map((asset) => asset.id), first.scope.assets.map((asset) => asset.id));
      assert.doesNotMatch(JSON.stringify(publicView), /sk_test_|sandbox_synthetic|storage_key|contact_ciphertext|token_hash/);
      assert.equal((await fetch(localHttpOrigin + `/api/keepsakes/access/photo/${first.token}/assets/${last.scope.assets[1].id}`)).status, 404);
      assert.equal((await fetch(localHttpOrigin + `/api/keepsakes/access/photo/${first.token}/assets/${outsider.id}`)).status, 404);
      const sourceResponse = await fetch(localHttpOrigin + `/api/keepsakes/access/photo/${first.token}/assets/${first.scope.assets[1].id}`); assert.equal(sourceResponse.status, 200); assert.match(sourceResponse.headers.get('content-type'), /^image\/jpeg/);
      assert.ok((await sharp(Buffer.from(await sourceResponse.arrayBuffer())).metadata()).width <= 1200);
      assert.equal((await fetch(localHttpOrigin + '/api/keepsakes/orders/' + crypto.randomBytes(32).toString('base64url'))).status, 404);
      const standardContact=decryptSecretJson(standardOrder.contact_ciphertext);
      const thumbnailResponse=await fetch(localHttpOrigin+`/api/keepsakes/orders/${standardContact.statusToken}/items/0/preview`);
      assert.equal(thumbnailResponse.status,200);assert.match(thumbnailResponse.headers.get('cache-control'),/no-store/);
      assert.equal((await sharp(Buffer.from(await thumbnailResponse.arrayBuffer())).metadata()).width,1200);
      assert.equal((await fetch(localHttpOrigin+`/api/keepsakes/orders/${standardContact.statusToken}/items/1/preview`)).status,404);
      assert.equal((await fetch(localHttpOrigin+`/api/keepsakes/orders/${contact.statusToken}/items/0/preview`)).status,404,'Refunded previews must be revoked');
      const beforeProofRequests = outbound.length, renderedBacks = [];
      for (const proof of retailQuote.proofs) {
        const proofResponse = await fetch(localHttpOrigin + proof.url); assert.equal(proofResponse.status, 200); assert.match(proofResponse.headers.get('content-type'), /^image\/jpeg/);
        assert.match(proofResponse.headers.get('cache-control'), /no-store/);
        const bytes = Buffer.from(await proofResponse.arrayBuffer()), metadata = await sharp(bytes).metadata();
        assert.ok(metadata.width <= 1200 && metadata.height <= 1200); assert.equal(metadata.exif, undefined);
        if (proof.side === 'back') renderedBacks.push(crypto.createHash('sha256').update(bytes).digest('hex'));
        const otherGuestUrl = proof.url.replace(`/photo/${postcardToken}/`, `/photo/${first.token}/`);
        assert.equal((await fetch(localHttpOrigin + otherGuestUrl)).status, 404);
      }
      assert.equal(new Set(renderedBacks).size, 2); assert.equal(outbound.length, beforeProofRequests, 'Proof review must not create payments or supplier requests');
      await query("UPDATE keepsakes_quotes SET expires_at=now()-interval '1 minute' WHERE id=$1", [retailQuote.quoteId]);
      assert.equal((await fetch(localHttpOrigin + retailQuote.proofs[0].url)).status, 404);
    } finally { localHttpOrigin = undefined; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await query("UPDATE gallery_access_keys SET status='REVOKED' WHERE id=$1", [key.id]); await assert.rejects(shop.keepsakesScope('photo', first.token), { statusCode: 404 });
    const dashboard=await manager.keepsakesDashboard(admin); assert.ok(dashboard.orders.length>0); assert.ok(dashboard.metrics.intervention>0); assert.ok(dashboard.metrics.grossCents>=dashboard.metrics.netCents);
    {
    // New storefront session uses the same verified payment/order pipeline.
    const photoAccess=await import('../server/src/services/keepsakes-photo-access-service.js'),editing=await import('../server/src/services/keepsakes-editing-service.js');
    const retailAlbum=await createAlbum('Approved retail QA');await query("UPDATE gallery_albums SET status='PUBLISHED',expires_at=now()+interval '1 year' WHERE id=$1",[retailAlbum.id]);await gallery.createGalleryKey(retailAlbum.id,'ALBUM',null,null,admin);
    const anchor=await upload(retailAlbum,'retail-anchor.jpg'),original=await upload(retailAlbum,'retail-original.jpg',true),strip=await upload(retailAlbum,'retail-strip.jpg',true);
    await manager.saveKeepsakesSession(retailAlbum.id,{anchorMediaId:anchor.id,assets:[{mediaId:anchor.id,kind:'COMPOSITE',label:'Reference',sortOrder:0,branded:true,merchandiseEligible:true,digitalEligible:false,included:true},{mediaId:original.id,kind:'ORIGINAL',label:'Original',sortOrder:1,branded:false,merchandiseEligible:true,digitalEligible:true,included:false},{mediaId:strip.id,kind:'BRANDED_STRIP',label:'Strip',sortOrder:2,branded:true,merchandiseEligible:true,digitalEligible:false,included:true}]},admin);
    const retailToken=(await photoAccess.directPhotoAccess('photo',(await photoLink(retailAlbum.id,anchor.id)).url.split('/').at(-1))).token,retailScope=await shop.keepsakesScope('session',retailToken);
    const ids=Object.fromEntries(retailScope.assets.map(a=>[a.kind,a.id])),keys=['edited-photo','edited-strip','edited-package','keychain','acrylic-display','postcard'],configured=[];
    for(const key of keys){await core.saveCoreCataloguePrice(key,{retailCents:1000},admin);await core.configureCoreRetail(key,{active:true,taxCode:'txcd_99999999',reason:'Synthetic test specifications; not actual supplier evidence.',productionReady:true,editingReady:true,stockUnits:10,shippingCents:100,variants:[{id:'test',label:'Synthetic test variant',...(key.startsWith('edited')?{}:{dimensions:key==='postcard'?'6 × 4':'Synthetic QA dimensions',printSpec:key==='postcard'?{widthPx:1875,heightPx:1275,dpi:300,bleedPx:37,safePx:37}:{widthPx:1200,heightPx:1800,dpi:300,bleedPx:0,safePx:0}})}]},admin);configured.push(await one('SELECT * FROM keepsakes_products WHERE catalogue_key=$1',[key]));}
    await manager.saveKeepsakesSettings(retailAlbum.id,{enabled:true,brandedMerchandise:true,originalSales:true,productIds:configured.map(p=>p.id)},admin);
    const address={name:'Synthetic Recipient',address1:'123 QA Street',address2:'',city:'Chicago',state:'IL',zip:'60601',country:'US'},lines=configured.map(p=>({productId:p.id,variantId:'test',assetIds:p.catalogue_key==='edited-package'?[ids.ORIGINAL,ids.BRANDED_STRIP]:[p.catalogue_key==='edited-strip'?ids.BRANDED_STRIP:ids.ORIGINAL],quantity:1,customization:{fit:'contain',zoom:1,x:.5,y:.5},...(p.provider==='LOB'?{returnAddress:address,recipients:Array.from({length:5},(_,n)=>({...address,name:'QA Guest '+n,message:'With love',messageFont:'serif'}))}:{})}));
    const cart={email:'synthetic-checkout@example.invalid',shippingAddress:address,items:lines},quote=await shop.quoteKeepsakes('session',retailToken,cart);assert.equal(quote.checkoutReady,true);assert.equal(quote.proofs.length,8);assert.ok(quote.proofs.every(p=>!p.url.includes(retailToken)),'Bearer tokens never appear in proof URLs');
    await assert.rejects(shop.quoteKeepsakes('session',retailToken,{...cart,items:[{...lines[0],assetIds:[ids.COMPOSITE]}]}),{code:'KEEPSAKES_EDIT_SOURCE'});
    await assert.rejects(shop.quoteKeepsakes('session',retailToken,{...cart,items:[{...lines[0],assetIds:[outsider.id]}]}),{code:'KEEPSAKES_UNAVAILABLE'});
    await assert.rejects(core.configureCoreRetail('premium-acrylic',{active:true},admin),{code:'KEEPSAKES_CONFIGURATION_PENDING'});
    const {reviewBulkCsv}=await import('../server/src/services/keepsakes-bulk-service.js');await assert.rejects(reviewBulkCsv(retailToken,''),{code:'KEEPSAKES_CLIENT_REQUIRED'});
    await assert.rejects(shop.quoteKeepsakes('session',retailToken,{...cart,items:[{...lines[3],quantity:6},{...lines[3],quantity:6}]}),{code:'KEEPSAKES_PRODUCTION_NOT_READY'});
    // Regression: a current in-house frame and style must survive Review Total;
    // a general catalog listing never grants a Gallery permission implicitly.
    await core.saveCoreCataloguePrice('framed-photo',{retailCents:1000},admin);
    await core.configureCoreRetail('framed-photo',{active:true,taxCode:'txcd_99999999',reason:'Synthetic framed-photo checkout regression fixture.',productionReady:true,shippingCents:100,stockUnits:10,variants:[{id:'test-frame',label:'QA frame',dimensions:'4 × 6',previewAssetId:'frame-champagne',printSpec:{widthPx:1200,heightPx:1800,dpi:300,bleedPx:0,safePx:0}}]},admin);
    const frame=await one("SELECT * FROM keepsakes_products WHERE catalogue_key='framed-photo'"),frameLine={...lines[3],productId:frame.id,variantId:'test-frame'};
    await assert.rejects(shop.quoteKeepsakes('session',retailToken,{...cart,items:[frameLine]}),e=>e.code==='KEEPSAKES_PRODUCT_UNAVAILABLE'&&/not enabled for these Gallery photos/.test(e.message));
    await manager.saveKeepsakesSettings(retailAlbum.id,{enabled:true,brandedMerchandise:true,originalSales:true,productIds:[...configured.map(p=>p.id),frame.id]},admin);
    const frameCollection=await photoAccess.photoCollection(retailToken);assert.ok(frameCollection.assets.every(a=>a.allowedProductIds.includes(frame.id)));
    const frameQuote=await shop.quoteKeepsakes('session',retailToken,{...cart,items:[frameLine]});assert.equal(frameQuote.checkoutReady,true);assert.equal(frameQuote.subtotalCents,frame.retail_cents);
    await assert.rejects(shop.quoteKeepsakes('session',retailToken,{...cart,items:[{...frameLine,variantId:'removed-style'}]}),e=>e.code==='KEEPSAKES_PRODUCT_UNAVAILABLE'&&/selected style changed/.test(e.message));
    await manager.saveKeepsakesSettings(retailAlbum.id,{enabled:true,brandedMerchandise:false,originalSales:true,productIds:configured.map(p=>p.id)},admin);
    const stripScope=await shop.keepsakesScope('session',retailToken),stripProduct=configured.find(p=>p.catalogue_key==='edited-strip');
    assert.ok((await shop.availableProducts({...stripScope,assets:stripScope.assets.filter(a=>a.id===ids.BRANDED_STRIP)})).products.some(p=>p.id===stripProduct.id));
    assert.ok(stripScope.assets.find(a=>a.id===ids.BRANDED_STRIP).digital_eligible);assert.equal(stripScope.assets.find(a=>a.id===ids.BRANDED_STRIP).merchandise_eligible,false);
    const stripQuote=await shop.quoteKeepsakes('session',retailToken,{email:cart.email,billingAddress:address,items:[lines[1]]});assert.equal(stripQuote.checkoutReady,true);
    await manager.saveKeepsakesSettings(retailAlbum.id,{enabled:true,brandedMerchandise:true,originalSales:true,productIds:[...configured.map(p=>p.id),frame.id]},admin);
    const digitalQuote=await shop.quoteKeepsakes('session',retailToken,{email:cart.email,billingAddress:address,items:[lines[0]]});assert.equal(digitalQuote.checkoutReady,true);assert.equal(digitalQuote.shippingCents,0);
    await assert.rejects(shop.quoteKeepsakes('session',retailToken,{email:cart.email,billingAddress:address,items:[frameLine]}),{code:'KEEPSAKES_SHIPPING_REQUIRED'});
    const proofService=await import('../server/src/services/keepsakes-proof-service.js');await proofService.keepsakesQuoteProof('session',retailToken,quote.quoteId,{itemIndex:3,side:'front'});
    await shop.checkoutKeepsakes('session',retailToken,quote.quoteId,{proofReviewed:true});const newOrder=await one('SELECT * FROM keepsakes_orders WHERE quote_id=$1',[quote.quoteId]);assert.equal(newOrder.paid_at,null);assert.equal((await one('SELECT count(*)::int n FROM keepsakes_fulfillments WHERE order_id=$1',[newOrder.id])).n,0);
    const paid={...paidEvent,id:'evt_approvedMixedPaid',data:{object:{...paidEvent.data.object,id:newOrder.stripe_session_id,amount_total:quote.totalCents,payment_intent:'pi_approvedMixed',metadata:{keepsakes_order_id:newOrder.id}}}};await deliver(paid);await deliver({...paid,id:'evt_approvedMixedReplay'});
    assert.equal((await one('SELECT count(*)::int n FROM keepsakes_fulfillments WHERE order_id=$1',[newOrder.id])).n,10);assert.equal((await one("SELECT (operational_config->>'stockUnits')::int n FROM keepsakes_products WHERE catalogue_key='keychain'")).n,9);
    await worker.processKeepsakesQueue({limit:10});const editJobs=(await editing.editingJobs(admin)).jobs.filter(j=>j.order_id===newOrder.id);assert.equal(editJobs.length,3);assert.ok(editJobs.every(j=>j.status==='EDITING'));
    const production=await import('../server/src/services/keepsakes-production-service.js'),productionJobs=(await production.productionJobs(admin)).jobs.filter(j=>j.order_id===newOrder.id);assert.equal(productionJobs.length,2);assert.ok(productionJobs.every(j=>j.status==='AWAITING_PRODUCTION'&&j.shippingAddress.name===address.name));const productionJob=productionJobs[0];await assert.rejects(production.progressProduction(productionJob.id,{action:'APPROVE_PRODUCTION'},admin),{code:'KEEPSAKES_PRODUCTION_APPROVAL'});await production.productionArtwork(productionJob.id,admin);await production.progressProduction(productionJob.id,{action:'APPROVE_PRODUCTION',stockAndCapacityConfirmed:true,proofReviewed:true},admin);await assert.rejects(production.progressProduction(productionJob.id,{action:'SHIPPED'},admin),{code:'KEEPSAKES_TRACKING_REQUIRED'});await production.progressProduction(productionJob.id,{action:'SHIPPED',carrier:'QA courier',trackingNumber:'QA123',trackingUrl:'https://example.invalid/QA123'},admin);await production.progressProduction(productionJob.id,{action:'COMPLETE'},admin);
    const edited=await sharp({create:{width:1800,height:1200,channels:3,background:'#305040'}}).jpeg().toBuffer();for(const job of editJobs)for(const deliverable of job.item.product.key==='edited-package'?['PHOTO','STRIP']:job.item.product.key==='edited-strip'?['STRIP']:['PHOTO'])await editing.completeEditedOutput(job.id,deliverable,edited,admin);
    const statusToken=decryptSecretJson(newOrder.contact_ciphertext).statusToken,outputs=(await shop.keepsakesOrderView(statusToken)).downloads.filter(d=>d.url.includes('/edited/'));assert.equal(outputs.length,4);assert.ok((await editing.editedDownload(statusToken,outputs[0].id)).bytes.length>0);assert.equal((await one('SELECT checksum FROM gallery_media WHERE id=$1',[original.id])).checksum,crypto.createHash('sha256').update(original.bytes).digest('hex'));
    const owner=await one('SELECT * FROM clients WHERE id=$1',[client.id]),eventId=(await one('SELECT event_id FROM gallery_albums WHERE id=$1',[retailAlbum.id])).event_id;
    const proposal=await one("INSERT INTO proposals(proposal_number,client_id,event_id,status,total) VALUES('RETAIL-BULK-QA',$1,$2,'CONVERTED',999) RETURNING id",[client.id,eventId]);const version=await one('INSERT INTO proposal_versions(proposal_id,version_number,snapshot) VALUES($1,1,$2) RETURNING id',[proposal.id,{}]);await query('UPDATE proposals SET accepted_version_id=$2 WHERE id=$1',[proposal.id,version.id]);const agreement=await one("INSERT INTO contracts(proposal_id,revision,status,title,terms,snapshot,signed_at,signer_name,signer_email,document_hash) VALUES($1,1,'SIGNED','Synthetic','No real obligation',$2,now(),'QA',$3,'fixture') RETURNING id",[proposal.id,{accepted_version_id:version.id},owner.email]);const grant=await one('INSERT INTO client_workspace_grants(proposal_id,client_id,signed_contract_id) VALUES($1,$2,$3) RETURNING id',[proposal.id,client.id,agreement.id]);const invite=await one('INSERT INTO client_workspace_invitations(grant_id,token_hash,token_ciphertext,recipient_email) VALUES($1,$2,$3,$4) RETURNING id',[grant.id,crypto.randomBytes(32).toString('hex'),encryptSecretJson({token:'fixture'}),owner.email]);const workspace=await one('INSERT INTO client_workspace_sessions(invitation_id,client_id,email,token_hash) VALUES($1,$2,$3,$4) RETURNING *',[invite.id,client.id,owner.email,crypto.randomBytes(32).toString('hex')]);
    const clientPhotos=await photoAccess.clientPhotoAccess(workspace,eventId),{BULK_TEMPLATE}=await import('../shared/keepsakes-bulk.js');const row=ref=>['QA Buyer','','',ref,'keychain','test','1','123 QA Street','','Chicago','IL','60601','US','With love'].join(',');const unique=(await photoLink(retailAlbum.id,anchor.id)).url;
    const review=await reviewBulkCsv(clientPhotos.token,BULK_TEMPLATE+[row(ids.ORIGINAL),row(unique),row(ids.ORIGINAL),row(outsider.id)].join('\n'));assert.equal(review.rows[0].candidates[0].id,ids.ORIGINAL);assert.equal(review.rows[1].candidates[0].id,ids.COMPOSITE);assert.equal(review.rows[2].duplicateOf,2);assert.equal(review.rows[3].candidates.length,0);assert.equal((await one('SELECT count(*)::int n FROM keepsakes_orders WHERE album_id=$1',[retailAlbum.id])).n,1,'Bulk preview creates no orders or manufacturing');await query('UPDATE client_workspace_sessions SET revoked_at=now() WHERE id=$1',[workspace.id]);await assert.rejects(reviewBulkCsv(clientPhotos.token,BULK_TEMPLATE+row(ids.ORIGINAL)),{code:'PHOTO_ACCESS_UNAVAILABLE'});
    await query("UPDATE keepsakes_orders SET refunded_cents=total_cents,status='REFUNDED' WHERE id=$1",[newOrder.id]);await assert.rejects(editing.editedDownload(statusToken,outputs[0].id),{code:'KEEPSAKES_EDIT_UNAVAILABLE'});
    }
    process.env.APP_ENV = 'production'; assert.throws(() => shop.assertKeepsakes(), { code: 'KEEPSAKES_DISABLED' }); process.env.APP_ENV = 'test';
    assert.ok(outbound.every((request) => ['api.stripe.com', 'api.prodigi.com', 'api.lob.com'].includes(request.host)));
  } finally {
    globalThis.fetch = originalFetch;
    if (db) await db.pool.end();
    await bootstrap.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await bootstrap.end();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
