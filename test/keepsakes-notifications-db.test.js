import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';

test('Keepsakes notifications drain batches, deduplicate milestones and respect transactional-only test recipients', {skip: !process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL, timeout: 120000}, async () => {
  const url = new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.match(url.pathname, /_qa$/);
  const schema = 'keepsakes_notifications_' + crypto.randomBytes(6).toString('hex');
  const bootstrap = new pg.Pool({connectionString: url.toString()});
  const originalFetch = globalThis.fetch, attemptedFetches = [];
  const environment = {
    DATABASE_URL: '', APP_ENV: 'test', NODE_ENV: 'test', JWT_SECRET: 'synthetic-keepsakes-notification-jwt',
    INTEGRATION_SECRET_KEY: 'synthetic-keepsakes-notification-encryption-secret',
    EMAIL_PROVIDER: 'development', EMAIL_FROM: 'The Lola Booth <notify@example.invalid>', SMS_PROVIDER: 'none',
    CLIENT_ORIGIN: 'http://localhost:5173', GALLERY_PUBLIC_ORIGIN: 'https://staginggallery.thelolabooth.com',
    GALLERY_ENABLED: 'true', KEEPSAKES_FULFILLMENT_ENABLED: 'true', KEEPSAKES_TEST_EMAIL_ALLOWLIST: 'notify@example.invalid'
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  let db;
  try {
    await bootstrap.query('CREATE SCHEMA ' + schema);
    url.searchParams.set('options', '-c search_path=' + schema + ',public');
    url.searchParams.set('application_name', schema);
    Object.assign(process.env, {...environment, DATABASE_URL: url.toString()});
    globalThis.fetch = async (...args) => {
      attemptedFetches.push(String(args[0]));
      throw new Error('No external network request is allowed by the synthetic notification test.');
    };
    db = await import('../server/src/db/pool.js');
    const {query, transaction} = db;
    const one = async (sql, values = []) => (await query(sql, values)).rows[0];
    for (const file of (await fs.readdir(new URL('../server/migrations/', import.meta.url))).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort()) {
      await transaction(async () => query(await fs.readFile(new URL('../server/migrations/' + file, import.meta.url), 'utf8')));
    }
    const {encryptSecretJson} = await import('../server/src/services/integration-secrets.js');
    const {processKeepsakesNotifications} = await import('../server/src/services/keepsakes-fulfillment-service.js');
    const user = await one("INSERT INTO users(name,email,password_hash) VALUES('Synthetic Notification Admin','notification-admin@example.invalid','not-a-login') RETURNING id");
    const client = await one("INSERT INTO clients(name,email,client_type) VALUES('Synthetic Notification Client','notification-client@example.invalid','CORPORATE') RETURNING id");
    const event = await one("INSERT INTO events(event_name,event_type,event_date,client_id) VALUES('Synthetic Notification Event','CORPORATE','2035-11-18',$1) RETURNING id", [client.id]);
    const album = await one("INSERT INTO gallery_albums(event_id,title) VALUES($1,'Synthetic Notification Gallery') RETURNING id", [event.id]);
    assert.ok(user.id);
    const createOrder = async (email, index) => {
      const quote = await one(`INSERT INTO keepsakes_quotes(album_id,scope_hash,snapshot,contact_ciphertext,subtotal_cents,shipping_cents,tax_cents,total_cents,checkout_ready)
        VALUES($1,$2,'{"items":[]}'::jsonb,$3,100,0,0,100,true) RETURNING id`, [album.id, crypto.randomBytes(32).toString('hex'), encryptSecretJson({email})]);
      const statusToken = crypto.randomBytes(32).toString('base64url');
      return one(`INSERT INTO keepsakes_orders(quote_id,album_id,status,token_hash,contact_ciphertext,snapshot,subtotal_cents,shipping_cents,tax_cents,total_cents,paid_at,updated_at)
        VALUES($1,$2,'COMPLETE',$3,$4,'{"items":[]}'::jsonb,100,0,0,100,now(),now()-($5::int*interval '1 second')) RETURNING id`,
      [quote.id, album.id, crypto.createHash('sha256').update(statusToken).digest('hex'), encryptSecretJson({email, statusToken}), index]);
    };
    const orders = [];
    for (let index = 0; index < 17; index++) orders.push(await createOrder('notify@example.invalid', index + 1));
    const blocked = await createOrder('not-allowed@example.invalid', 0);
    const marketingBefore = await one(`SELECT (SELECT count(*)::int FROM campaign_recipients) AS campaign_recipients,
      (SELECT count(*)::int FROM crm_contacts WHERE marketing_consent='OPTED_IN') AS opted_in_contacts,
      (SELECT count(*)::int FROM clients WHERE marketing_email_opt_in=true) AS opted_in_clients`);

    const first = await processKeepsakesNotifications();
    assert.equal(first.length, 10, JSON.stringify((await query("SELECT details FROM keepsakes_events WHERE action='notification_requires_review'")).rows));
    assert.ok(first.every(result => result.status === 'SENT_TO_PROVIDER'), 'Processor results must report the persisted provider-acceptance status');
    const sentCount = async () => Number((await one("SELECT count(*)::int AS count FROM communications WHERE trigger_key='KEEPSAKES_TRANSACTIONAL' AND status='SENT_TO_PROVIDER'")).count);
    assert.equal(await sentCount(), 10);
    const second = await processKeepsakesNotifications();
    assert.equal(second.length, 7, 'Previously sent newest orders must not starve the remaining seven');
    assert.ok(second.every(result => result.status === 'SENT_TO_PROVIDER'));
    assert.equal(await sentCount(), 17);
    assert.equal((await processKeepsakesNotifications()).length, 0);
    assert.equal((await one("SELECT count(*)::int AS count FROM communications WHERE trigger_key='KEEPSAKES_TRANSACTIONAL'")).count, 17);

    const communications = (await query("SELECT recipient,provider,status,idempotency_key,rendered_body FROM communications WHERE trigger_key='KEEPSAKES_TRANSACTIONAL' ORDER BY idempotency_key")).rows;
    assert.ok(communications.every(row => row.recipient === 'notify@example.invalid' && row.provider === 'development' && row.status === 'SENT_TO_PROVIDER'));
    assert.ok(communications.every(row => /^keepsakes:[a-f0-9-]{36}:CONFIRMATION$/.test(row.idempotency_key)));
    assert.ok(communications.every(row => row.rendered_body.includes('/keepsakes/orders/')));
    assert.equal((await one('SELECT count(*)::int AS count FROM email_messages WHERE provider=\'development\'')).count, 17);
    assert.equal((await one("SELECT count(*)::int AS count FROM communications WHERE idempotency_key LIKE $1", [`keepsakes:${blocked.id}:%`])).count, 0, 'Non-allowlisted orders must never queue email');

    await query("UPDATE keepsakes_orders SET status='REFUNDED',refunded_cents=100,updated_at=now() WHERE id=$1", [orders[0].id]);
    assert.equal((await processKeepsakesNotifications()).length, 1);
    assert.equal(await sentCount(), 18);
    assert.equal((await processKeepsakesNotifications()).length, 0);
    const milestones = (await query("SELECT idempotency_key FROM communications WHERE idempotency_key LIKE $1 ORDER BY idempotency_key", [`keepsakes:${orders[0].id}:%`])).rows;
    assert.deepEqual(milestones.map(row => row.idempotency_key), [`keepsakes:${orders[0].id}:CONFIRMATION`, `keepsakes:${orders[0].id}:REFUNDED`]);
    // Physical stages survive fast changes, never deliver early for split lines,
    // and generate exactly three distinct customer messages.
    const physical=await createOrder('notify@example.invalid',99);
    await query("UPDATE keepsakes_orders SET status='PAID',snapshot=$2 WHERE id=$1",[physical.id,{items:[{product:{title:'Synthetic keychain'},units:1},{product:{title:'Synthetic magnet'},units:1}]}]);
    for(const index of [0,1])await query("INSERT INTO keepsakes_fulfillments(order_id,item_index,provider,status) VALUES($1,$2,'IN_HOUSE','AWAITING_PRODUCTION')",[physical.id,index]);
    const {syncKeepsakesOrder}=await import('../server/src/services/keepsakes-lifecycle-service.js');
    await syncKeepsakesOrder(physical.id);await processKeepsakesNotifications();
    await query("UPDATE keepsakes_fulfillments SET status='FULFILLED' WHERE order_id=$1",[physical.id]);await syncKeepsakesOrder(physical.id);
    assert.equal((await processKeepsakesNotifications()).length,0,'Packing does not send a dispatched email');
    await query("UPDATE keepsakes_fulfillments SET status='SHIPPED',tracking=$2 WHERE order_id=$1",[physical.id,JSON.stringify([{carrier:'USPS',trackingNumber:'SYNTHETIC',trackingUrl:'https://example.invalid/track'}])]);await syncKeepsakesOrder(physical.id);
    await query("UPDATE keepsakes_fulfillments SET status='COMPLETE' WHERE order_id=$1 AND item_index=0",[physical.id]);await syncKeepsakesOrder(physical.id);
    assert.equal((await one("SELECT count(*)::int n FROM keepsakes_order_milestones WHERE order_id=$1 AND kind='DELIVERED'",[physical.id])).n,0,'One delivered line cannot complete another shipment');
    await query("UPDATE keepsakes_fulfillments SET status='COMPLETE' WHERE order_id=$1",[physical.id]);await syncKeepsakesOrder(physical.id);
    await processKeepsakesNotifications();await syncKeepsakesOrder(physical.id);await processKeepsakesNotifications();
    const physicalEmails=(await query("SELECT subject,rendered_body,status FROM communications WHERE idempotency_key LIKE $1 ORDER BY created_at",[`keepsakes:${physical.id}:%`])).rows;
    assert.deepEqual(physicalEmails.map(e=>e.subject),['Your Lola Keepsakes order confirmation','Your Lola Keepsakes order has shipped','Your Lola Keepsakes order has been delivered']);
    assert.ok(physicalEmails.every(e=>e.status==='SENT_TO_PROVIDER'));assert.ok(physicalEmails[1].rendered_body.includes('SYNTHETIC'));
    assert.equal((await one("SELECT count(*)::int n FROM keepsakes_events WHERE order_id=$1 AND action='order_delivered'",[physical.id])).n,1);
    const marketingAfter = await one(`SELECT (SELECT count(*)::int FROM campaign_recipients) AS campaign_recipients,
      (SELECT count(*)::int FROM crm_contacts WHERE marketing_consent='OPTED_IN') AS opted_in_contacts,
      (SELECT count(*)::int FROM clients WHERE marketing_email_opt_in=true) AS opted_in_clients`);
    assert.deepEqual(marketingAfter, marketingBefore, 'Transactional purchases must not create marketing memberships or opt-ins');
    assert.equal((await one("SELECT count(*)::int AS count FROM keepsakes_events WHERE action='notification_requires_review'")).count, 0);
    assert.deepEqual(attemptedFetches, [], 'The development email provider must make zero external calls');
  } finally {
    globalThis.fetch = originalFetch;
    if (db) await db.pool.end();
    await bootstrap.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await bootstrap.end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
