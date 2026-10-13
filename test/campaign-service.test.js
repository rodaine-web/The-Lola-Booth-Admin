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
  const oldOrigin=process.env.CAMPAIGN_TRACKING_ORIGIN;
  process.env.CAMPAIGN_TRACKING_ORIGIN='https://api.example.invalid';
  t.after(()=>{if(oldOrigin===undefined)delete process.env.CAMPAIGN_TRACKING_ORIGIN;else process.env.CAMPAIGN_TRACKING_ORIGIN=oldOrigin;});
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
  assert.ok(calls.some(c=>c.sql.startsWith('INSERT INTO campaign_tracking_links')&&c.args[2]==='OPEN'));
  assert.ok(calls.some(c=>c.sql.startsWith('UPDATE campaign_recipients SET tracking_enabled=true')));
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
test('production campaigns can process while reminders remain paused, only with their own opt-in', async t => {
  const keys = ['APP_ENV', 'PRODUCTION_AUTOMATIONS_ENABLED', 'CAMPAIGN_JOBS_ENABLED'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APP_ENV = 'production';
  process.env.PRODUCTION_AUTOMATIONS_ENABLED = 'false';
  const calls = fixture(t, () => []);
  try {
    for (const flag of [undefined, 'false']) {
      if (flag === undefined) delete process.env.CAMPAIGN_JOBS_ENABLED;
      else process.env.CAMPAIGN_JOBS_ENABLED = flag;
      assert.equal((await campaigns.processCampaignJobs({limit: 1})).paused, true);
      assert.equal(calls.length, 0);
    }
    process.env.CAMPAIGN_JOBS_ENABLED = 'true';
    const result = await campaigns.processCampaignJobs({limit: 1});
    assert.deepEqual(result.processed, []);
    assert.ok(calls.some(call => call.sql.includes('FOR UPDATE OF r,c SKIP LOCKED')));
    const {stagingJobsPaused} = await import('../server/src/config/staging-safety.js');
    assert.equal(stagingJobsPaused(), true);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
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
    status: 'QUEUED',
    campaign_status: 'SENDING'
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
    if (sql.startsWith('SELECT r.*')) return [recipient];
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
    email:'qa@example.invalid',
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
    email:'qa@example.invalid',first_name: 'QA',
    company: 'Synthetic',
    campaign_name: 'QA outreach'
  };
  const calls = fixture(t, sql => sql.includes('WHERE token_hash=') ? [r] : sql.startsWith('INSERT INTO campaign_interests') ? [{
    id: randomUUID(),
    package: 'DUO'
  }] : sql.includes('i.id=$1 AND i.campaign_id=$2') ? [{id:recipientId,campaign_recipient_id:recipientId,email:'qa@example.invalid',lead_id:leadId,offer_snapshot:{name:'Duo'},event_date:'2099-12-20'}] : sql.startsWith('SELECT * FROM leads') || sql.startsWith("UPDATE leads SET status='FOLLOW_UP'") ? [{id:leadId,status:'FOLLOW_UP'}] : sql.startsWith('INSERT INTO notifications') ? [{
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
 let recipient={id:recipientId,campaign_id:id,communication_id:communicationId,email:'qa@example.invalid',status:'QUEUED',campaign_status:'SENDING'};
 let message={id:communicationId,campaign_recipient_id:recipientId,status:'DRAFT',channel:'EMAIL',recipient:recipient.email,subject:'QA',rendered_body:'QA'};
 const calls=fixture(t,(sql)=>{if(sql.startsWith('SELECT r.*'))return [recipient];if(sql.startsWith('SELECT status FROM campaign_recipients'))return [recipient];if(sql.startsWith('SELECT * FROM communications'))return [message];if(sql.startsWith("UPDATE campaign_recipients SET status='PROCESSING'")){recipient.status='PROCESSING';return [];}if(sql.startsWith("UPDATE communications SET status='PROCESSING'")){message.status='PROCESSING';return [message];}return [];});
 try{const out=await campaigns.processCampaignJobs({limit:1});assert.equal(out.processed[0].status,'FAILED');assert.ok(calls.some(c=>c.sql.includes("UPDATE communications SET status='FAILED'")));assert.equal(calls.some(c=>c.sql.includes("UPDATE campaign_recipients SET status='SENT_TO_PROVIDER'")),false);}
 finally{env.emailProvider=previousProvider;if(previousFlag===undefined)delete process.env.CAMPAIGN_JOBS_ENABLED;else process.env.CAMPAIGN_JOBS_ENABLED=previousFlag;}
});
test('explicit conversion links to an existing email instead of creating a duplicate lead',async t=>{
 const interestId=randomUUID();const calls=fixture(t,sql=>sql.includes('i.id=$1 AND i.campaign_id=$2')?[{id:recipientId,campaign_recipient_id:recipientId,email:'qa@example.invalid',package:'DUO',event_date:'2099-12-20',event_time:'18:00',offer_snapshot:{name:'Duo'}}]:sql.startsWith('SELECT * FROM leads')||sql.startsWith("UPDATE leads SET status='FOLLOW_UP'")?[{id:leadId,status:'FOLLOW_UP'}]:[]);
 const out=await campaigns.convertCampaignInterest(id,interestId,req);assert.equal(out.lead_id,leadId);assert.ok(calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));assert.equal(calls.some(c=>c.sql.startsWith('INSERT INTO leads')),false);
});
test('unsubscribe token stays usable after campaign archive and interest token expiry',async t=>{
 const calls=fixture(t,sql=>sql.includes('WHERE token_hash=')?[{id:recipientId,campaign_id:id,email:'qa@example.invalid'}]:[]);
 await campaigns.unsubscribeCampaign(campaigns.newCampaignToken());assert.equal(calls.find(c=>c.sql.includes('WHERE token_hash=')).args[1],true);
});


test('custom campaign rejects an experience outside its offers before recording interest',async t=>{
 const experienceId=randomUUID();
 const calls=fixture(t,sql=>sql.includes('WHERE token_hash=')?[{id:recipientId,campaign_id:id,content_json:campaignContent({format:'TEXT',offers:[]})}]:[]);
 await assert.rejects(campaigns.submitCampaignInterest(campaigns.newCampaignToken(),{package:'EXPERIENCE_'+experienceId,event_date:'2099-12-20',event_time:'18:00'}),e=>e.code==='INVALID_CAMPAIGN_OFFER');
 assert.equal(calls.some(c=>c.sql.startsWith('INSERT INTO campaign_interests')),false);
});
test('explicit conversion carries imported phone and selected catalog experience/package into the lead',async t=>{
 const experienceId=randomUUID(),packageId=randomUUID(),interestId=randomUUID();
 const offer={key:'EXPERIENCE_'+experienceId,kind:'EXPERIENCE',catalog_id:experienceId,package_id:packageId,name:'360 Signature',original_price:999,discount_type:'NONE',discount_value:0};
 const calls=fixture(t,sql=>sql.includes('i.id=$1 AND i.campaign_id=$2')?[{id:recipientId,campaign_recipient_id:recipientId,email:'qa@example.invalid',phone:'+1 312 555 0100',package:offer.key,event_date:'2099-12-20',event_time:'18:00',offer_snapshot:{...offer,selections:[{experience_id:experienceId,packages:[{package_id:packageId}]}]}}]:sql.startsWith('INSERT INTO leads')?[{id:leadId}]:[]);
 const out=await campaigns.convertCampaignInterest(id,interestId,req);
 assert.equal(out.lead_id,leadId);
 const insert=calls.find(c=>c.sql.startsWith('INSERT INTO leads'));
 assert.equal(insert.args[3],'+1 312 555 0100');assert.equal(insert.args[10],experienceId);assert.equal(insert.args[11],packageId);assert.match(insert.args[8],/360 Signature/);assert.match(insert.sql,/'FOLLOW_UP'/);
});

test('draft deletion is staging-only and records removal without deleting contacts or suppressions',async t=>{
 const previous=process.env.APP_ENV;
 const calls=fixture(t,sql=>sql.startsWith('SELECT * FROM campaigns')||sql.startsWith('UPDATE campaigns SET deleted_at')?[campaign()]:[]);
 try{
  process.env.APP_ENV='production';await assert.rejects(campaigns.deleteCampaign(id,req),e=>e.statusCode===404);assert.equal(calls.length,0);
  process.env.APP_ENV='staging';assert.deepEqual(await campaigns.deleteCampaign(id,req),{deleted:true});
  assert.ok(calls.some(c=>c.sql.includes('FOR UPDATE')));
  assert.ok(calls.some(c=>c.sql.includes('INSERT INTO audit_logs')&&c.args.includes('campaign_deleted')));
  assert.equal(calls.some(c=>/DELETE FROM/.test(c.sql)),false);
 }finally{if(previous===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=previous;}
});
test('non-draft campaigns and drafts with sending history cannot be deleted',async t=>{
 const previous=process.env.APP_ENV;process.env.APP_ENV='staging';let c=campaign('SENT'),history=[];
 const calls=fixture(t,sql=>sql.startsWith('SELECT * FROM campaigns')?[c]:sql.startsWith('SELECT 1 FROM campaign_recipients')?history:[]);
 try{
  for(const status of ['READY','SCHEDULED','SENDING','SENT','PAUSED','FAILED','CANCELLED','ARCHIVED']){c=campaign(status);await assert.rejects(campaigns.deleteCampaign(id,req),e=>e.code==='CAMPAIGN_STATE');}
  c=campaign();history=[{}];await assert.rejects(campaigns.deleteCampaign(id,req),e=>e.code==='CAMPAIGN_STATE');
  assert.equal(calls.some(c=>c.sql.startsWith('UPDATE campaigns')),false);
 }finally{if(previous===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=previous;}
});
