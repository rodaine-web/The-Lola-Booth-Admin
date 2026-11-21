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
      const {integrationMarketplace}=await import('../server/src/services/integration-marketplace-service.js');
      const marketplace=await integrationMarketplace({days:30});
      assert.equal(marketplace.apps.length,35);
      assert.ok(marketplace.apps.filter(a=>a.implementationStatus==='planned').every(a=>a.state.status==='COMING_SOON'));
      assert.equal(marketplace.metrics.connected,0,'Fresh schema has no verified provider evidence');
      assert.ok(!JSON.stringify(marketplace).includes('encrypted_credentials'));
      await assert.rejects(integrationMarketplace({days:'invalid'}),error=>error.code==='INVALID_DATE_RANGE');
      await query("UPDATE integration_connections SET encrypted_credentials=$1,status='CONNECTED',metadata=$2 WHERE provider='MAILCHIMP'", [encryptSecretJson({
        access_token: 'test-only-token',
        dc: 'us21'
      }), {
        audience_id: 'list1',
        needs_selection: false
      }]);
      await query("INSERT INTO leads(first_name,last_name,email,event_type,marketing_email_opt_in,status,created_at) VALUES('QA','External','consented@example.invalid','Corporate',true,'NEW','2026-11-12T12:00:00Z')");
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
      // Multiple bookings must not multiply the inquiry cohort. ZIP/guest data never leaves this local fixture.
      const analyticsLead=(await query("INSERT INTO leads(first_name,last_name,email,event_type,status,created_at,utm_campaign,utm_source,utm_medium) VALUES('Analytics','QA','analytics@example.invalid','Corporate','NEW','2026-11-10T12:00:00Z','qa','google','cpc') RETURNING id")).rows[0];
      await query("INSERT INTO leads(first_name,last_name,email,event_type,status,created_at,test_mode) VALUES('Test','Only','test@example.invalid','Corporate','NEW','2026-11-10T12:00:00Z',true)");
      const client=(await query("INSERT INTO clients(name) VALUES('Analytics QA') RETURNING id")).rows[0];
      for(const [total,deleted] of [[100,null],[200,null],[900,'2026-11-11']]){
        const event=(await query("INSERT INTO events(event_name,event_type,event_date,client_id) VALUES('Analytics QA','Corporate','2026-11-10',$1) RETURNING id",[client.id])).rows[0];
        await query('INSERT INTO bookings(event_id,client_id,lead_id,total,deleted_at) VALUES($1,$2,$3,$4,$5)',[event.id,client.id,analyticsLead.id,total,deleted]);
      }
      t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({rows:[]})));
      const ga=(await query("SELECT * FROM integration_connections WHERE provider='GA4'")).rows[0];
      ga.metadata={property_id:'123',property_name:'QA'};
      const {refreshAnalytics}=await import('../server/src/services/external-reporting-service.js');
      await refreshAnalytics(ga,{access_token:'local-test-only'},{dates:{startDate:'2026-11-01',endDate:'2026-11-20',timeZone:'America/Chicago'},event:'generate_lead',cache_key:'qa-cohort'});
      const cached=(await query("SELECT report FROM integration_report_cache WHERE connection_id=$1 AND cache_key='qa-cohort'",[ga.id])).rows[0].report;
      assert.deepEqual(cached.crmSummary,{inquiries:2,bookings:2,bookingValue:300});
      assert.equal(cached.crmOnlyCampaigns.find(row=>row.campaign==='qa').inquiries,1);
      await query(`DROP SCHEMA ${schema} CASCADE`);
    });
  } finally {
    await pool.end();
  }
});
