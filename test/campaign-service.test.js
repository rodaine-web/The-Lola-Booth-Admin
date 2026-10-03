import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../server/src/db/pool.js';
import { env } from '../server/src/config/env.js';
import * as campaigns from '../server/src/services/campaign-service.js';
import { campaignContent } from '../shared/campaign-content.js';
const id = randomUUID(),
  recipientId = randomUUID(),
  communicationId = randomUUID(),
  leadId = randomUUID();
const req = {
  user: {
    id: randomUUID(),
    name: 'QA Admin'
  },
  headers: {}
};
const campaign = (status = 'DRAFT') => ({
  id,
  name: 'QA outreach',
  status,
  subject: 'Hello {{contact.first_name}}',
  preview_text: 'QA',
  content_json: campaignContent({
    mailing_address: 'Synthetic QA address'
  }),
  audience_json: {
    ids: [leadId],
    companies: [],
    manual: []
  },
  reply_to: 'qa@example.invalid',
  timezone: 'America/Chicago'
});
function fixture(t, handle) {
  const calls = [];
  const db = async (sql, args = []) => {
    calls.push({
      sql,
      args
    });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return {
      rows: [],
      rowCount: 0
    };
    const rows = await handle(sql, args);
    return {
      rows: rows || [],
      rowCount: rows?.length || 0
    };
  };
  t.mock.method(pool, 'query', db);
  t.mock.method(pool, 'connect', async () => ({
    query: db,
    release() {}
  }));
  return calls;
}
test('campaign CRUD validates content, writes audit/activity and saves draft only', async t => {
  const c = campaign();
  const calls = fixture(t, (sql, args) => {
    if (sql.startsWith('INSERT INTO campaigns')) return [c];
    if (sql.startsWith('SELECT * FROM campaigns')) return [c];
    return [];
  });
  const saved = await campaigns.saveCampaign(c, req);
  assert.equal(saved.status, 'DRAFT');
  assert.ok(calls.some(c => c.sql.includes('INSERT INTO audit_logs') && c.args.includes('campaign_created')));
  assert.ok(calls.some(c => c.sql.includes('INSERT INTO campaign_events')));
  assert.equal(calls.some(c => c.sql.includes('INSERT INTO communications')), false);
});
test('editing a sending campaign is rejected before updating any fields', async t => {
  const calls = fixture(t, sql => sql.startsWith('SELECT * FROM campaigns') ? [campaign('SENDING')] : []);
  await assert.rejects(campaigns.saveCampaign(campaign(), req, id), e => e.code === 'CAMPAIGN_STATE');
  assert.equal(calls.some(c => c.sql.startsWith('UPDATE campaigns')), false);
});
test('duplicate contains content/settings but no recipient, delivery, metrics or interest state', async t => {
  let inserted;
  fixture(t, (sql, args) => {
    if (sql.startsWith('SELECT * FROM campaigns')) return [campaign('SENT')];
    if (sql.startsWith('INSERT INTO campaigns')) {
      inserted = {
        sql,
        args
      };
      return [campaign()];
    }
    return [];
  });
  await campaigns.duplicateCampaign(id, req);
  const columns = inserted.sql.match(/campaigns\(([^)]+)/)[1].split(',');
  const data = Object.fromEntries(columns.map((key, i) => [key, inserted.args[i]]));
  assert.equal(data.name, 'QA outreach (copy)');
  assert.deepEqual(data.audience_json.manual, []);
  assert.deepEqual(data.audience_json.ids, []);
  assert.equal(data.status, undefined);
  assert.equal(data.content_json.glam_price, 999);
});
test('audience filtering combines CRM selection, companies and consented manual recipients', async t => {
  fixture(t, sql => sql.includes("'lead' kind") ? [{
    id: leadId,
    email: 'CRM@EXAMPLE.INVALID',
    first_name: 'CRM',
    company: 'Acme',
    marketing_email_opt_in: true
  }, {
    id: randomUUID(),
    email: 'no@example.invalid',
    company: 'Acme',
    marketing_email_opt_in: false
  }] : sql === 'SELECT email FROM campaign_suppressions' ? [] : []);
  const out = await campaigns.resolveCampaignAudience({
    companies: ['Acme'],
    manual: [{
      email: 'crm@example.invalid',
      marketing_email_opt_in: true
    }, {
      email: 'manual@example.invalid',
      marketing_email_opt_in: true
    }]
  });
  assert.equal(out.count, 2);
  assert.equal(out.excluded.length, 2);
});
test('invalid scheduling is rejected before any database mutation', async t => {
  const calls = fixture(t, () => []);
  await assert.rejects(campaigns.queueCampaign(id, req, {
    scheduled_at: '2020-01-01'
  }), e => e.code === 'INVALID_SCHEDULE');
  assert.equal(calls.length, 0);
});
test('queue creates one draft communication per eligible recipient without sending at request time', async t => {
  const c = campaign(),
    r = {
      id: recipientId,
      lead_id: leadId
    };
  const calls = fixture(t, (sql, args) => {
    if (sql.startsWith('SELECT * FROM campaigns')) return [c];
    if (sql.includes("'lead' kind")) return [{
      id: leadId,
      kind: 'lead',
      email: 'qa@example.invalid',
      first_name: 'QA',
      marketing_email_opt_in: true
    }];
    if (sql.startsWith('INSERT INTO campaign_recipients')) return [r];
    if (sql.startsWith('INSERT INTO communications')) return [{
      id: communicationId
    }];
    if (sql.startsWith('UPDATE campaigns')) return [{
      ...c,
      status: args[1]
    }];
    return [];
  });
  const queued = await campaigns.queueCampaign(id, req, {
    scheduled_at: '2099-12-20T18:00:00Z'
  });
  assert.equal(queued.status, 'SCHEDULED');
  assert.equal(calls.filter(c => c.sql.startsWith('INSERT INTO communications')).length, 1);
  const recipient = calls.find(c => c.sql.startsWith('INSERT INTO campaign_recipients'));
  assert.equal(recipient.args[7].length, 64);
  assert.ok(calls.some(c => c.sql.includes('reply_to=$3') && c.args[2] === 'qa@example.invalid'));
  assert.equal(calls.some(c => c.sql.includes("status='PROCESSING'")), false);
});
test('pause and resume keep queued messages intact; cancel stops only unclaimed recipients', async t => {
  let c = campaign('SENDING');
  const calls = fixture(t, (sql, args) => {
    if (sql.startsWith('SELECT * FROM campaigns')) return [c];
    if (sql.startsWith('UPDATE campaigns')) {
      c = {
        ...c,
        status: args[1]
      };
      return [c];
    }
    return [];
  });
  assert.equal((await campaigns.campaignAction(id, 'pause', req)).status, 'PAUSED');
  assert.equal((await campaigns.campaignAction(id, 'resume', req)).status, 'SENDING');
  assert.equal((await campaigns.campaignAction(id, 'cancel', req)).status, 'CANCELLED');
  assert.ok(calls.some(c => c.sql.includes("status='CANCELLED'") && c.sql.includes("status='QUEUED'")));
});
test('cancelled campaigns cannot resume or be edited', async t => {
  fixture(t, sql => sql.startsWith('SELECT * FROM campaigns') ? [campaign('CANCELLED')] : []);
  await assert.rejects(campaigns.campaignAction(id, 'resume', req), e => e.code === 'CAMPAIGN_STATE');
  await assert.rejects(campaigns.saveCampaign(campaign(), req, id), e => e.code === 'CAMPAIGN_STATE');
});
test('retry never queues delivery-outcome-unknown failures', async t => {
  const calls = fixture(t, (sql, args) => sql.startsWith('SELECT * FROM campaigns') ? [campaign('FAILED')] : sql.startsWith('UPDATE campaigns') ? [{
    ...campaign(),
    status: args[1]
  }] : []);
  await campaigns.campaignAction(id, 'retry', req);
  const retry = calls.find(c => c.sql.startsWith('UPDATE campaign_recipients'));
  assert.ok(retry.sql.includes("m.failure_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'"));
});
test('worker is opt-in and staging processing cannot enable unrelated automations', async t => {
  const previous = process.env.CAMPAIGN_JOBS_ENABLED;
  process.env.CAMPAIGN_JOBS_ENABLED = 'false';
  try {
    const calls = fixture(t, () => []);
    const result = await campaigns.processCampaignJobs();
    assert.equal(result.paused, true);
    assert.equal(calls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.CAMPAIGN_JOBS_ENABLED;else process.env.CAMPAIGN_JOBS_ENABLED = previous;
  }
});
test('worker atomically claims a recipient, uses existing provider abstraction and finalizes acceptance', async t => {
  const previous = process.env.CAMPAIGN_JOBS_ENABLED;
  process.env.CAMPAIGN_JOBS_ENABLED = 'true';
  let recipient = {
    id: recipientId,
    campaign_id: id,
    communication_id: communicationId,
    email: 'qa@example.invalid',
    status: 'QUEUED'
  };
  let message = {
    id: communicationId,
    campaign_recipient_id: recipientId,
    status: 'DRAFT',
    channel: 'EMAIL',
    recipient: recipient.email,
    subject: 'QA',
    rendered_body: 'Synthetic QA',
    rendered_html: '<p>QA</p>'
  };
  const calls = fixture(t, (sql, args) => {
    if (sql.startsWith('SELECT r.* FROM campaign_recipients')) return [recipient];
    if (sql.startsWith('SELECT status FROM campaign_recipients')) return [recipient];
    if (sql.startsWith('SELECT * FROM communications')) return [message];
    if (sql.startsWith('UPDATE campaign_recipients SET status=\'PROCESSING\'')) {
      recipient.status = 'PROCESSING';
      return [];
    }
    if (sql.startsWith("UPDATE communications SET status='PROCESSING'")) {
      message.status = 'PROCESSING';
      return [message];
    }
    if (sql.includes("SET status='SENT_TO_PROVIDER'")) {
      message.status = 'SENT_TO_PROVIDER';
      return [message];
    }
    return [];
  });
  try {
    const result = await campaigns.processCampaignJobs({
      limit: 1
    });
    assert.equal(result.processed[0].status, 'SENT_TO_PROVIDER');
    assert.ok(calls.some(c => c.sql.includes('FOR UPDATE OF r,c SKIP LOCKED')));
    assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO email_messages')));
  } finally {
    if (previous === undefined) delete process.env.CAMPAIGN_JOBS_ENABLED;else process.env.CAMPAIGN_JOBS_ENABLED = previous;
  }
});
test('malformed public token is rejected before database lookup', async t => {
  const calls = fixture(t, () => []);
  await assert.rejects(campaigns.resolveCampaignToken('123'), e => e.code === 'INVALID_TOKEN');
  assert.equal(calls.length, 0);
});
test('duplicate interest does not create duplicate activity, notifications or events', async t => {
  const r = {
    id: recipientId,
    campaign_id: id,
    lead_id: leadId,
    first_name: 'QA',
    campaign_name: 'QA'
  };
  const calls = fixture(t, sql => sql.includes('WHERE token_hash=') ? [r] : sql.startsWith('SELECT * FROM campaign_interests') ? [{
    package: '360'
  }] : []);
  const out = await campaigns.submitCampaignInterest(campaigns.newCampaignToken(), {
    package: '360',
    event_date: '2099-12-20',
    event_time: '18:00'
  });
  assert.equal(out.duplicate, true);
  assert.equal(calls.some(c => c.sql.startsWith('INSERT INTO notifications')), false);
  assert.equal(calls.some(c => c.sql.startsWith('INSERT INTO activities')), false);
});
test('new interest records CRM activity and notification without booking, invoice or proposal', async t => {
  const r = {
    id: recipientId,
    campaign_id: id,
    lead_id: leadId,
    first_name: 'QA',
    company: 'Synthetic',
    campaign_name: 'QA outreach'
  };
  const calls = fixture(t, sql => sql.includes('WHERE token_hash=') ? [r] : sql.startsWith('INSERT INTO campaign_interests') ? [{
    id: randomUUID(),
    package: 'DUO'
  }] : sql.startsWith('INSERT INTO notifications') ? [{
    id: randomUUID()
  }] : []);
  await campaigns.submitCampaignInterest(campaigns.newCampaignToken(), {
    package: 'DUO',
    event_date: '2099-12-20',
    event_time: '18:00',
    location: 'Synthetic'
  });
  assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO activities')));
  assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO notifications')));
  assert.equal(calls.some(c => /INSERT INTO (events|proposals|invoices)\b/.test(c.sql)), false);
});
test('unsubscribe suppresses marketing across campaigns but preserves transactional preferences', async t => {
  const calls = fixture(t, sql => sql.includes('WHERE token_hash=') ? [{
    id: recipientId,
    campaign_id: id,
    email: 'qa@example.invalid'
  }] : []);
  await campaigns.unsubscribeCampaign(campaigns.newCampaignToken());
  assert.ok(calls.some(c => c.sql.startsWith('INSERT INTO campaign_suppressions')));
  assert.ok(calls.some(c => c.sql.includes('marketing_email_opt_in=false')));
  assert.ok(calls.some(c => c.sql.includes('communication_preferences=communication_preferences||')));
  assert.equal(calls.some(c => c.sql.includes('transactional')), false);
});
test('authenticated adapter replay is idempotent and does not update tracking twice', async t => {
  const calls = fixture(t, sql => sql.startsWith('SELECT * FROM campaign_recipients') ? [{
    id: recipientId,
    campaign_id: id
  }] : []);
  const out = await campaigns.recordCampaignProviderEvent({
    recipientId,
    eventKey: 'verified-provider-event',
    type: 'DELIVERED'
  });
  assert.equal(out.duplicate, true);
  assert.equal(calls.some(c => c.sql.startsWith('UPDATE campaign_recipients')), false);
});

test('campaign messages reject direct send outside worker even with a communication-send grant',async t=>{
 const {sendCommunication}=await import('../server/src/services/automation-service.js');
 const calls=fixture(t,sql=>sql.startsWith('SELECT * FROM communications')?[{id:communicationId,status:'DRAFT',channel:'EMAIL',campaign_recipient_id:recipientId}]:sql.startsWith('SELECT status FROM campaign_recipients')?[{status:'QUEUED'}]:[]);
 await assert.rejects(sendCommunication(communicationId,req.user),e=>e.code==='CAMPAIGN_WORKER_REQUIRED');assert.equal(calls.some(c=>c.sql.startsWith('UPDATE communications')),false);
});
test('repeated worker send returns existing provider acceptance without sending again',async t=>{
 const {sendCommunication}=await import('../server/src/services/automation-service.js');
 const calls=fixture(t,sql=>sql.startsWith('SELECT * FROM communications')?[{id:communicationId,status:'SENT_TO_PROVIDER',campaign_recipient_id:recipientId,provider:'development',provider_message_id:'previous'}]:sql.startsWith('SELECT status FROM campaign_recipients')?[{status:'PROCESSING'}]:[]);
 const result=await sendCommunication(communicationId,{}, {workerClaim:true});assert.equal(result.delivery.duplicatePrevented,true);assert.equal(calls.some(c=>c.sql.startsWith('INSERT INTO email_messages')),false);
});
test('provider failure remains visible and does not mark a campaign recipient sent',async t=>{
 const previousFlag=process.env.CAMPAIGN_JOBS_ENABLED,previousProvider=env.emailProvider;process.env.CAMPAIGN_JOBS_ENABLED='true';env.emailProvider='synthetic-unconfigured-provider';
 let recipient={id:recipientId,campaign_id:id,communication_id:communicationId,email:'qa@example.invalid',status:'QUEUED'};
 let message={id:communicationId,campaign_recipient_id:recipientId,status:'DRAFT',channel:'EMAIL',recipient:recipient.email,subject:'QA',rendered_body:'QA'};
 const calls=fixture(t,(sql)=>{if(sql.startsWith('SELECT r.* FROM campaign_recipients'))return [recipient];if(sql.startsWith('SELECT status FROM campaign_recipients'))return [recipient];if(sql.startsWith('SELECT * FROM communications'))return [message];if(sql.startsWith("UPDATE campaign_recipients SET status='PROCESSING'")){recipient.status='PROCESSING';return [];}if(sql.startsWith("UPDATE communications SET status='PROCESSING'")){message.status='PROCESSING';return [message];}return [];});
 try{const out=await campaigns.processCampaignJobs({limit:1});assert.equal(out.processed[0].status,'FAILED');assert.ok(calls.some(c=>c.sql.includes("UPDATE communications SET status='FAILED'")));assert.equal(calls.some(c=>c.sql.includes("UPDATE campaign_recipients SET status='SENT_TO_PROVIDER'")),false);}
 finally{env.emailProvider=previousProvider;if(previousFlag===undefined)delete process.env.CAMPAIGN_JOBS_ENABLED;else process.env.CAMPAIGN_JOBS_ENABLED=previousFlag;}
});
test('explicit conversion links to an existing email instead of creating a duplicate lead',async t=>{
 const interestId=randomUUID();const calls=fixture(t,sql=>sql.includes('i.id=$1 AND i.campaign_id=$2')?[{id:recipientId,campaign_recipient_id:recipientId,email:'qa@example.invalid',package:'DUO',event_date:'2099-12-20',event_time:'18:00'}]:sql.startsWith('SELECT id FROM leads')?[{id:leadId}]:[]);
 const out=await campaigns.convertCampaignInterest(id,interestId,req);assert.equal(out.lead_id,leadId);assert.ok(calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));assert.equal(calls.some(c=>c.sql.startsWith('INSERT INTO leads')),false);
});
test('unsubscribe token stays usable after campaign archive and interest token expiry',async t=>{
 const calls=fixture(t,sql=>sql.includes('WHERE token_hash=')?[{id:recipientId,campaign_id:id,email:'qa@example.invalid'}]:[]);
 await campaigns.unsubscribeCampaign(campaigns.newCampaignToken());assert.equal(calls.find(c=>c.sql.includes('WHERE token_hash=')).args[1],true);
});
