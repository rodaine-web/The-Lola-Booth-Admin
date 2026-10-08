import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
test('external hub migration and queue run against disposable PostgreSQL', {
  skip: !process.env.EXTERNAL_TEST_DATABASE_URL
}, async t => {
  const target = new URL(process.env.EXTERNAL_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'Use a disposable local database only.');
  process.env.DATABASE_URL = process.env.EXTERNAL_TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  delete process.env.APP_ENV;
  const {
    pool,
    query,
    transaction
  } = await import('../server/src/db/pool.js');
  const {
    encryptSecretJson
  } = await import('../server/src/services/integration-secrets.js');
  const {
    queueExternal,
    externalConnections,
    disconnect
  } = await import('../server/src/services/external-connections-service.js');
  const {
    dispatchExternalJob
  } = await import('../server/src/services/external-integration-jobs.js');
  const {
    processIntegrationJobs
  } = await import('../server/src/services/integration-jobs-service.js');
  try {
    await transaction(async () => {
      const schema = 'external_' + crypto.randomBytes(8).toString('hex');
      await query(`CREATE SCHEMA ${schema}`);
      await query(`SET LOCAL search_path TO ${schema},public`);
      const dir = new URL('../server/migrations/', import.meta.url);
      for (const file of (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await query(await fs.readFile(new URL(file, dir), 'utf8'));
      const user = (await query("INSERT INTO users(name,email,password_hash) VALUES('External QA','qa@example.invalid','test-only') RETURNING id")).rows[0],
        req = {
          user,
          headers: {}
        };
      await query("UPDATE integration_connections SET encrypted_credentials=$1,status='CONNECTED',metadata=$2 WHERE provider='MAILCHIMP'", [encryptSecretJson({
        access_token: 'test-only-token',
        dc: 'us21'
      }), {
        audience_id: 'list1',
        needs_selection: false
      }]);
      await query("INSERT INTO leads(first_name,email,marketing_email_opt_in,status) VALUES('QA','consented@example.invalid',true,'NEW')");
      t.mock.method(globalThis, 'fetch', async (_url, opts) => new Response(JSON.stringify(opts.method === 'GET' ? {} : {
        id: 'member'
      }), {
        status: opts.method === 'GET' ? 404 : 200
      }));
      const first = await queueExternal('MAILCHIMP', 'CONTACT_SYNC', {}, req, 'external-qa-sync'),
        second = await queueExternal('MAILCHIMP', 'CONTACT_SYNC', {}, req, 'external-qa-sync');
      assert.equal(first.id, second.id);
      const results = await processIntegrationJobs({
        limit: 1
      });
      assert.equal(results.length, 1);
      const job = (await query('SELECT status FROM integration_jobs WHERE id=$1', [first.id])).rows[0];
      assert.equal(job.status, 'SUCCEEDED');
      assert.ok(!JSON.stringify(await externalConnections()).includes('test-only-token'));
      const pending = await queueExternal('MAILCHIMP', 'CONTACT_SYNC', {}, req, 'external-qa-stop');
      await disconnect('MAILCHIMP', req);
      assert.equal((await query('SELECT status FROM integration_jobs WHERE id=$1', [pending.id])).rows[0].status, 'CANCELLED');
      const connection = (await query("SELECT encrypted_credentials,status FROM integration_connections WHERE provider='MAILCHIMP'")).rows[0];
      assert.equal(connection.encrypted_credentials, null);
      assert.equal(connection.status, 'DISABLED');
      await query(`DROP SCHEMA ${schema} CASCADE`);
    });
  } finally {
    await pool.end();
  }
});
