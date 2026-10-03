import { randomBytes, createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { recordActivity } from './activity-service.js';
import { writeAudit } from './audit-service.js';
import { createNotification } from './notification-service.js';
import { sendCommunication, createCommunicationDraft } from './automation-service.js';
import { stagingJobsPaused, isStaging } from '../config/staging-safety.js';
import { campaignContent, eligibleAudience, campaignPackages } from '../../../shared/campaign-content.js';
import { renderCampaignEmail } from './campaign-email.js';
export const hashCampaignToken = token => createHash('sha256').update(token).digest('hex');
export const newCampaignToken = () => randomBytes(32).toString('base64url');
const contentSchema = z.object({
  headline: z.string().min(1).max(200),
  intro: z.string().min(1).max(2000),
  cta: z.string().min(1).max(80),
  footer: z.string().max(1000),
  mailing_address: z.string().max(500),
  images: z.record(z.string(), z.string().max(2000)),
  glam_price: z.number().nonnegative(),
  '360_price': z.number().nonnegative(),
  duo_price: z.number().nonnegative(),
  glam_extra: z.number().nonnegative(),
  '360_extra': z.number().nonnegative(),
  duo_extra: z.number().nonnegative(),
  duo_features:z.array(z.string().max(200)).max(20),
  glam_features: z.array(z.string().max(200)).max(20),
  '360_features': z.array(z.string().max(200)).max(20)
});
export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(180),
  description: z.string().max(2000).default(''),
  type: z.enum(['CORPORATE_OUTREACH', 'EMPLOYEE_APPRECIATION', 'SUMMER_EVENT', 'OTHER']).default('CORPORATE_OUTREACH'),
  subject: z.string().min(1).max(200).default('{{contact.first_name}}, make {{company.name}}\'s year-end celebration unforgettable'),
  preview_text: z.string().max(250).default('The LOLA Glam, The LOLA 360 or both. Premium year-end experiences for your team.'),
  sender_name: z.string().min(1).max(100).default('The LOLA Booth'),
  reply_to: z.email().default('info@thelolabooth.com'),
  timezone: z.string().max(80).default('America/Chicago'),
  content_json: contentSchema.optional(),
  audience_json: z.object({
    ids: z.array(z.uuid()).max(10000).default([]),
    companies: z.array(z.string().max(200)).max(100).default([]),
    source: z.string().max(100).default(''),
    tags: z.array(z.string().max(100)).max(100).default([]),
    manual: z.array(z.object({
      email: z.email(),
      first_name: z.string().max(100).default(''),
      last_name: z.string().max(100).default(''),
      company: z.string().max(200).default(''),
      marketing_email_opt_in: z.boolean()
    })).max(1000).default([])
  }).default({
    ids: [],
    companies: [],
    source: '',
    manual: []
  })
});
export const interestSchema = z.object({
  package: z.enum(campaignPackages),
  event_date: z.iso.date(),
  event_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  location: z.string().trim().max(300).optional().default('').transform(value=>sanitizeHtml(value,{allowedTags:[],allowedAttributes:{}})),
  website: z.string().max(0).optional()
}).refine(x => x.event_date >= new Date().toISOString().slice(0, 10), {
  message: 'Choose today or a future event date.',
  path: ['event_date']
});
function fail(message = 'This campaign cannot be changed in its current state.') {
  throw new AppError(message, 409, 'CAMPAIGN_STATE');
}
async function event(campaignId, type, metadata = {}, recipientId = null, key = null) {
  return query('INSERT INTO campaign_events(campaign_id,event_type,metadata,recipient_id,event_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING RETURNING *', [campaignId, type, metadata, recipientId, key]);
}
async function audit(req, campaign, action) {
  await writeAudit({
    req,
    action,
    entity: 'campaign',
    entityId: campaign.id,
    after: {
      name: campaign.name,
      status: campaign.status
    }
  });
  await event(campaign.id, action, {
    actor: req.user?.name
  });
}
export async function getCampaign(id, {
  lock = false
} = {}) {
  const c = (await query(`SELECT * FROM campaigns WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!c) throw new AppError('Campaign not found.', 404, 'NOT_FOUND');
  return {
    ...c,
    content_json: campaignContent(c.content_json)
  };
}
export async function listCampaigns(filters = {}) {
  const rows = (await query(`SELECT c.*,u.name creator_name,count(r.id)::int recipients,count(r.sent_at)::int sent,count(r.interested_at)::int interested,count(r.failed_at)::int failed FROM campaigns c LEFT JOIN users u ON u.id=c.created_by LEFT JOIN campaign_recipients r ON r.campaign_id=c.id WHERE ($1='' OR c.status=$1) AND ($2='' OR c.type=$2) AND ($3='' OR c.name ILIKE '%'||$3||'%' OR EXISTS(SELECT 1 FROM campaign_recipients s WHERE s.campaign_id=c.id AND (s.email ILIKE '%'||$3||'%' OR s.company ILIKE '%'||$3||'%'))) AND ($4='' OR c.created_by::text=$4) AND ($5='' OR c.created_at::date>=NULLIF($5,'')::date) AND ($6='' OR c.created_at::date<=NULLIF($6,'')::date) AND ($7='' OR EXISTS(SELECT 1 FROM campaign_recipients a WHERE a.campaign_id=c.id AND a.company ILIKE '%'||$7||'%') OR c.audience_json::text ILIKE '%'||$7||'%') GROUP BY c.id,u.name ORDER BY c.updated_at DESC`, [filters.status || '', filters.type || '', filters.search || '',filters.owner||'',filters.from||'',filters.to||'',filters.audience||''])).rows;
  return {
    data: rows.map(c => ({
      ...c,
      delivered: null,
      opened: null,
      clicked: null
    })),
    tracking: {
      delivered: false,
      opened: false,
      clicked: false
    }
  };
}
export async function campaignContacts() {
  return (await query(`SELECT id,'lead' kind,first_name,last_name,email,company,lead_source source,marketing_email_opt_in,'{}'::jsonb communication_preferences,'{}'::text[] tags FROM leads WHERE deleted_at IS NULL UNION ALL SELECT id,'client',split_part(name,' ',1),CASE WHEN position(' ' in name)>0 THEN substring(name from position(' ' in name)+1) ELSE '' END,email,company,referral_source,marketing_email_opt_in,communication_preferences,tags FROM clients WHERE deleted_at IS NULL ORDER BY first_name`)).rows;
}
export async function resolveCampaignAudience(audience = {}) {
  const contacts = await campaignContacts(),
    suppressions = (await query('SELECT email FROM campaign_suppressions')).rows;
  const filtered = contacts.filter(c => (audience.ids?.includes(c.id) || audience.companies?.includes(c.company) || audience.tags?.some(t => c.tags?.includes(t))) && (!audience.source || c.source === audience.source));
  return eligibleAudience([...filtered, ...(audience.manual || []).map(c => ({
    ...c,
    kind: 'manual'
  }))], suppressions);
}
export async function saveCampaign(input, req, id = null) {
  const data = campaignSchema.parse(input);
  try {
    new Intl.DateTimeFormat('en', {
      timeZone: data.timezone
    });
  } catch {
    throw new AppError('Choose a valid timezone.', 422, 'INVALID_TIMEZONE');
  }
  renderCampaignEmail({
    ...data,
    content_json: campaignContent(data.content_json)
  }, {
    first_name: 'Jordan',
    company: 'Northstar Group'
  }, {
    test: true
  });
  return transaction(async () => {
    if (id && !['DRAFT', 'READY'].includes((await getCampaign(id, {
      lock: true
    })).status)) fail();
    const fields = Object.keys(data),
      values = fields.map(k => data[k]);
    const c = (await query(id ? `UPDATE campaigns SET ${fields.map((k, i) => k + '=$' + (i + 1)).join(',')},updated_at=now() WHERE id=$${values.length + 1} RETURNING *` : `INSERT INTO campaigns(${fields.join(',')},created_by) VALUES(${values.map((_, i) => '$' + (i + 1)).join(',')},$${values.length + 1}) RETURNING *`, [...values, id || req.user.id])).rows[0];
    await audit(req, c, id ? 'campaign_edited' : 'campaign_created');
    if (id) await event(id, 'audience_changed');
    return getCampaign(c.id);
  });
}
export async function duplicateCampaign(id, req) {
  const c = await getCampaign(id);
  return saveCampaign({
    ...c,
    name: c.name + ' (copy)',
    audience_json: {
      ids: [],
      companies: [],
      source: '',
      manual: []
    }
  }, req);
}
export async function campaignDetail(id) {
  const c = await getCampaign(id);
  const [recipients, interests, events] = await Promise.all([query('SELECT r.*,m.failure_message,m.failure_code FROM campaign_recipients r LEFT JOIN communications m ON m.id=r.communication_id WHERE campaign_id=$1 ORDER BY r.company,r.first_name', [id]), query(`SELECT i.*,r.first_name,r.last_name,r.email,r.company,r.lead_id,r.client_id,l.status lead_status,l.assigned_user_id owner FROM campaign_interests i JOIN campaign_recipients r ON r.id=i.campaign_recipient_id LEFT JOIN leads l ON l.id=r.lead_id WHERE i.campaign_id=$1 ORDER BY submitted_at DESC`, [id]), query('SELECT * FROM campaign_events WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 300', [id])]);
  return {
    ...c,
    recipients: recipients.rows,
    interests: interests.rows,
    activity: events.rows,
    metrics: {
      recipients: recipients.rowCount,
      sent: recipients.rows.filter(r => r.sent_at).length,
      interested: interests.rowCount,
      failed: recipients.rows.filter(r => r.failed_at).length,
      delivered: null,
      opened: null,
      clicked: null,
      interest_rate: null
    },
    provider_note: 'Microsoft confirms provider acceptance. Delivery, opens and clicks are unavailable in the current provider integration.'
  };
}
export async function queueCampaign(id, req, {
  scheduled_at = null
} = {}) {
  if (scheduled_at && (!Number.isFinite(Date.parse(scheduled_at)) || Date.parse(scheduled_at) <= Date.now())) throw new AppError('Choose a future schedule time.', 422, 'INVALID_SCHEDULE');
  return transaction(async () => {
    const c = await getCampaign(id, {
      lock: true
    });
    if (!['DRAFT', 'READY'].includes(c.status)) fail();
    if (!c.content_json.mailing_address.trim()) throw new AppError('Add your business mailing address before sending marketing email.', 422, 'MAILING_ADDRESS_REQUIRED');
    const audience = await resolveCampaignAudience(c.audience_json);
    if (!audience.count) throw new AppError('Choose at least one consented recipient.', 422, 'EMPTY_AUDIENCE');
    for (const r of audience.recipients) {
      const token = newCampaignToken(),
        rendered = renderCampaignEmail(c, r, {
          token
        });
      const recipient = (await query(`INSERT INTO campaign_recipients(campaign_id,lead_id,client_id,email,first_name,last_name,company,token_hash,token_expires_at,status,queued_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '1 year','QUEUED',now()) ON CONFLICT(campaign_id,email) DO NOTHING RETURNING *`, [id, r.kind === 'lead' ? r.id : null, r.kind === 'client' ? r.id : null, r.email, r.first_name, r.last_name, r.company, hashCampaignToken(token)])).rows[0];
      if (!recipient) continue;
      const m = await createCommunicationDraft({
        lead_id: recipient.lead_id,
        client_id: recipient.client_id,
        recipient: r.email,
        subject: rendered.subject,
        body: rendered.text,
        html: rendered.html,
        status: 'DRAFT'
      }, req.user);
      await query('UPDATE communications SET campaign_recipient_id=$2,reply_to=$3,idempotency_key=$4,sender_name=$5 WHERE id=$1', [m.id, recipient.id, c.reply_to, 'campaign:' + recipient.id, c.sender_name]);
      await query('UPDATE campaign_recipients SET communication_id=$2 WHERE id=$1', [recipient.id, m.id]);
    }
    const updated = (await query("UPDATE campaigns SET status=$2,scheduled_at=$3,updated_at=now() WHERE id=$1 RETURNING *", [id, scheduled_at ? 'SCHEDULED' : 'SENDING', scheduled_at])).rows[0];
    await audit(req, updated, scheduled_at ? 'campaign_scheduled' : 'campaign_send_initiated');
    return updated;
  });
}
export async function campaignAction(id, action, req) {
  return transaction(async () => {
    const c = await getCampaign(id, {
      lock: true
    });
    const allowed = {
      retry: ['FAILED'],
      pause: ['SENDING', 'SCHEDULED'],
      resume: ['PAUSED'],
      cancel: ['DRAFT', 'READY', 'PAUSED', 'SENDING', 'SCHEDULED'],
      archive: ['DRAFT', 'READY', 'SENT', 'CANCELLED', 'FAILED'],
      ready: ['DRAFT']
    };
    if (!allowed[action]?.includes(c.status)) fail();
    if (action === 'retry') {
      await query("UPDATE campaign_recipients r SET status='QUEUED',failed_at=NULL,queued_at=now() FROM communications m WHERE r.campaign_id=$1 AND r.status='FAILED' AND r.communication_id=m.id AND m.status='FAILED' AND m.failure_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'", [id]);
    }
    const status = {
      retry: 'SENDING',
      pause: 'PAUSED',
      resume: c.scheduled_at && Date.parse(c.scheduled_at) > Date.now() ? 'SCHEDULED' : 'SENDING',
      cancel: 'CANCELLED',
      archive: 'ARCHIVED',
      ready: 'READY'
    }[action];
    if (action === 'cancel') await query("UPDATE campaign_recipients SET status='CANCELLED' WHERE campaign_id=$1 AND status='QUEUED'", [id]);
    const updated = (await query('UPDATE campaigns SET status=$2,updated_at=now() WHERE id=$1 RETURNING *', [id, status])).rows[0];
    await audit(req, updated, 'campaign_' + action);
    return updated;
  });
}
export async function campaignTestSend(id, email, req, sample = {
  first_name: 'Jordan',
  company: 'Northstar Group'
}) {
  z.email().parse(email);
  const c = await getCampaign(id),
    rendered = renderCampaignEmail(c, sample, {
      test: true
    });
  const draft = await createCommunicationDraft({
    recipient: email,
    subject: '[TEST] ' + rendered.subject,
    body: rendered.text,
    html: rendered.html
  }, req.user);
  await query('UPDATE communications SET reply_to=$2,sender_name=$3 WHERE id=$1', [draft.id, c.reply_to, c.sender_name]);
  const result = await sendCommunication(draft.id, req.user);
  await audit(req, c, 'campaign_test_sent');
  return {
    status: result.communication.status
  };
}
export async function resolveCampaignToken(token, {
  preferences = false
} = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError('This campaign link is invalid or expired.', 404, 'INVALID_TOKEN');
  const r = (await query('SELECT r.*,c.name campaign_name,c.content_json,c.reply_to FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE token_hash=$1 AND ($2 OR (token_expires_at>now() AND c.status NOT IN (\'CANCELLED\',\'ARCHIVED\')))', [hashCampaignToken(token), preferences])).rows[0];
  if (!r) throw new AppError('This campaign link is invalid or expired.', 404, 'INVALID_TOKEN');
  return r;
}
export async function publicCampaign(token) {
  const r = await resolveCampaignToken(token);
  return {
    first_name: r.first_name,
    company: r.company,
    content: campaignContent(r.content_json),
    unsubscribed: Boolean(r.unsubscribed_at),
    interest: (await query('SELECT package,event_date,event_time,location FROM campaign_interests WHERE campaign_recipient_id=$1', [r.id])).rows[0] || null
  };
}
export async function submitCampaignInterest(token, input) {
  const data = interestSchema.parse(input);
  return transaction(async () => {
    const r = await resolveCampaignToken(token);
    if (r.unsubscribed_at) throw new AppError('This marketing link has been unsubscribed.', 410, 'UNSUBSCRIBED');
    const inserted = (await query('INSERT INTO campaign_interests(campaign_id,campaign_recipient_id,package,event_date,event_time,location) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(campaign_recipient_id) DO NOTHING RETURNING *', [r.campaign_id, r.id, data.package, data.event_date, data.event_time, data.location || null])).rows[0];
    if (!inserted) return {
      duplicate: true,
      interest: (await query('SELECT * FROM campaign_interests WHERE campaign_recipient_id=$1', [r.id])).rows[0]
    };
    await query('UPDATE campaign_recipients SET interested_at=now() WHERE id=$1', [r.id]);
    await event(r.campaign_id, 'interest_submitted', data, r.id);
    if (r.lead_id || r.client_id) await recordActivity({
      entityType: r.lead_id ? 'lead' : 'client',
      entityId: r.lead_id || r.client_id,
      action: 'campaign_interest',
      summary: 'Responded to ' + r.campaign_name,
      metadata: data
    });
    await createNotification({
      roleTarget: 'OWNER_ADMIN',
      category: 'LEADS',
      title: 'New campaign interest',
      body: [r.first_name, r.last_name, r.company, data.package, data.event_date, data.event_time, data.location].filter(Boolean).join(' · '),
      entityType: 'campaign',
      entityId: r.campaign_id,
      actionUrl: '/communications/campaigns/' + r.campaign_id,
      email: {
        enabled: true
      }
    });
    return {
      interest: inserted
    };
  });
}
export async function campaignPreference(token) {
  const r = await resolveCampaignToken(token, {
    preferences: true
  });
  return {
    unsubscribed: Boolean(r.unsubscribed_at)
  };
}
export async function unsubscribeCampaign(token) {
  return transaction(async () => {
    const r = await resolveCampaignToken(token, {
      preferences: true
    });
    await query("INSERT INTO campaign_suppressions(email,reason) VALUES($1,'UNSUBSCRIBED') ON CONFLICT(email) DO NOTHING", [r.email]);
    await query("UPDATE campaign_recipients SET unsubscribed_at=COALESCE(unsubscribed_at,now()),status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END WHERE email=$1", [r.email]);
    await query('UPDATE leads SET marketing_email_opt_in=false WHERE lower(email)=$1', [r.email]);
    await query("UPDATE clients SET marketing_email_opt_in=false,communication_preferences=communication_preferences||'{\"marketing_email\":false}'::jsonb WHERE lower(email)=$1", [r.email]);
    await event(r.campaign_id, 'unsubscribed', {}, r.id, 'unsubscribe:' + r.id);
    return {
      unsubscribed: true
    };
  });
}
export async function processCampaignJobs({
  limit = 25
} = {}) {
  if (process.env.CAMPAIGN_JOBS_ENABLED !== 'true' || stagingJobsPaused() && !isStaging()) return {
    processed: [],
    paused: true
  };
  const started=await query("UPDATE campaigns SET status='SENDING',started_at=COALESCE(started_at,now()) WHERE status='SCHEDULED' AND scheduled_at<=now() RETURNING id");
  for(const c of started.rows)await event(c.id,'campaign_sending_started',{},null,'started:'+c.id);
  // Unknown outcomes remain failed for operator review; never automatically re-send.
  await query("UPDATE communications m SET status='FAILED',failed_at=now(),failure_code='DELIVERY_OUTCOME_UNKNOWN',failure_message='Campaign worker stopped during send. Review provider history before retry.' FROM campaign_recipients r WHERE m.id=r.communication_id AND r.status='PROCESSING' AND r.queued_at<now()-interval '10 minutes' AND m.status='PROCESSING'");
  await query("UPDATE campaign_recipients r SET status=CASE WHEN m.status='SENT_TO_PROVIDER' THEN 'SENT_TO_PROVIDER' ELSE 'FAILED' END,sent_at=m.sent_at,failed_at=CASE WHEN m.status='SENT_TO_PROVIDER' THEN NULL ELSE now() END FROM communications m WHERE m.id=r.communication_id AND r.status='PROCESSING' AND r.queued_at<now()-interval '10 minutes'");
  const processed = [];
  for (let i = 0; i < limit; i++) {
    const r = await transaction(async () => {
      const row = (await query("SELECT r.* FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.status='QUEUED' AND c.status='SENDING' ORDER BY r.queued_at LIMIT 1 FOR UPDATE OF r,c SKIP LOCKED")).rows[0];
      if (!row) return null;
      const suppressed = (await query('SELECT 1 FROM campaign_suppressions WHERE email=$1', [row.email])).rowCount;
      const contact=row.lead_id?(await query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL',[row.lead_id])).rows[0]:row.client_id?(await query('SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL',[row.client_id])).rows[0]:null;
      if (suppressed || (row.lead_id || row.client_id) && (!contact || !eligibleAudience([contact]).count)) {
        await query("UPDATE campaign_recipients SET status='EXCLUDED' WHERE id=$1", [row.id]);
        return {
          excluded: true,
          ...row
        };
      }
      await query("UPDATE campaign_recipients SET status='PROCESSING',queued_at=now() WHERE id=$1", [row.id]);
      return row;
    });
    if (!r) break;
    if (r.excluded) {
      processed.push({
        id: r.id,
        status: 'EXCLUDED'
      });
      continue;
    }
    try {
      const sent = await sendCommunication(r.communication_id, {}, {
        workerClaim: true
      });
      await query("UPDATE campaign_recipients SET status='SENT_TO_PROVIDER',sent_at=now(),failed_at=NULL WHERE id=$1", [r.id]);
      await event(r.campaign_id, 'provider_accepted', {}, r.id);
      processed.push({
        id: r.id,
        status: sent.communication.status
      });
    } catch (e) {
      await query("UPDATE campaign_recipients SET status='FAILED',failed_at=now() WHERE id=$1", [r.id]);
      await event(r.campaign_id, 'delivery_failed', {
        message: e.message,
        code: e.code
      }, r.id);
      processed.push({
        id: r.id,
        status: 'FAILED'
      });
    }
  }
  const completed=await query("UPDATE campaigns c SET status=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='FAILED') THEN 'FAILED' ELSE 'SENT' END,completed_at=now(),updated_at=now() WHERE c.status='SENDING' AND NOT EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status IN ('QUEUED','PROCESSING')) RETURNING c.id,c.status");
  for(const c of completed.rows)await event(c.id,'campaign_completed',{status:c.status},null,'completed:'+c.id);
  return {
    processed
  };
}
export async function convertCampaignInterest(campaignId, interestId, req) {
  return transaction(async () => {
    const i = (await query('SELECT i.*,r.* ,i.id interest_id FROM campaign_interests i JOIN campaign_recipients r ON r.id=i.campaign_recipient_id WHERE i.id=$1 AND i.campaign_id=$2 FOR UPDATE OF r', [interestId, campaignId])).rows[0];
    if (!i) throw new AppError('Interest not found.', 404, 'NOT_FOUND');
    if (i.lead_id) return {
      lead_id: i.lead_id,
      existing: true
    };
    // Serializes explicit conversion for the same email, including other campaigns.
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [i.email]);
    let lead = (await query('SELECT id FROM leads WHERE lower(email)=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1', [i.email])).rows[0];
    if (!lead) {
      lead = (await query(`INSERT INTO leads(first_name,last_name,email,phone,event_date,event_start_time,event_type,venue_name,company,lead_source,message,marketing_email_opt_in,assigned_user_id) VALUES($1,$2,$3,NULL,$4,$5,'CORPORATE',$6,$7,'MANUAL',$8,false,$9) RETURNING id`, [i.first_name || 'Prospect', i.last_name || '', i.email, i.event_date, i.event_time, i.location || null, i.company, `Campaign interest: ${i.package}. Requested ${i.event_date} ${i.event_time}.`, req.user.id])).rows[0];
    }
    await query('UPDATE campaign_recipients SET lead_id=$2 WHERE id=$1', [i.campaign_recipient_id, lead.id]);
    await recordActivity({
      actorUserId: req.user.id,
      entityType: 'lead',
      entityId: lead.id,
      action: 'campaign_interest_converted',
      summary: 'Campaign interest linked to lead',
      metadata: {
        package: i.package,
        event_date: i.event_date,
        event_time: i.event_time,
        location: i.location,
        campaign_id: campaignId
      }
    });
    await audit(req, {
      id: campaignId,
      name: 'Campaign interest',
      status: 'LINKED'
    }, 'campaign_interest_converted');
    return {
      lead_id: lead.id
    };
  });
}
// Provider adapters call this only AFTER authenticating the provider webhook.
// Microsoft Graph sendMail does not expose these events in the current adapter.
export async function recordCampaignProviderEvent({
  recipientId,
  eventKey,
  type,
  occurredAt = new Date().toISOString()
}) {
  const fields = {
    DELIVERED: 'delivered_at',
    OPENED: 'opened_at',
    CLICKED: 'clicked_at',
    BOUNCED: 'failed_at'
  };
  if (!fields[type] || !eventKey || !Number.isFinite(Date.parse(occurredAt))) throw new AppError('Invalid delivery event.', 422, 'INVALID_DELIVERY_EVENT');
  return transaction(async () => {
    const r = (await query('SELECT * FROM campaign_recipients WHERE id=$1 FOR UPDATE', [recipientId])).rows[0];
    if (!r) throw new AppError('Recipient not found.', 404, 'NOT_FOUND');
    const logged = await event(r.campaign_id, type, {
      occurred_at: occurredAt
    }, r.id, eventKey);
    if (!logged.rowCount) return {
      duplicate: true
    };
    await query(`UPDATE campaign_recipients SET ${fields[type]}=COALESCE(${fields[type]},$2) WHERE id=$1`, [r.id, occurredAt]);
    if (type === 'BOUNCED') await query("INSERT INTO campaign_suppressions(email,reason) VALUES($1,'HARD_BOUNCE') ON CONFLICT(email) DO NOTHING", [r.email]);
    return {
      recorded: true
    };
  });
}
