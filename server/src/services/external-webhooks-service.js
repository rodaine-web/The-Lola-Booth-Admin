import { query, transaction } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { digest, sameSecret, verifyMeta, verifyTikTok, verifyMailchimp, redactProvider, memberHash } from './external-provider-security.js';
import { connection, queueExternal } from './external-connections-service.js';
import { providerApi, providerConfig } from './external-provider-adapters.js';
import { ingestProviderLead } from './social-lead-service.js';
export async function validateMailchimpSecret(secret) {
  if (!process.env.MAILCHIMP_WEBHOOK_SECRET || !sameSecret(secret, process.env.MAILCHIMP_WEBHOOK_SECRET)) throw new AppError('Invalid webhook authorization.', 401, 'WEBHOOK_SIGNATURE_INVALID');
}
export async function receiveExternalWebhook(provider, body, headers = {}, queryParams = {}) {
  if (provider === 'META' && !verifyMeta(body, headers['x-hub-signature-256'], process.env.META_CLIENT_SECRET)) throw new AppError('Invalid webhook signature.', 401, 'WEBHOOK_SIGNATURE_INVALID');
  if (provider === 'TIKTOK' && (!providerConfig(provider).approved || !verifyTikTok(body, headers['tiktok-signature'], process.env.TIKTOK_WEBHOOK_SECRET))) throw new AppError('Invalid or unapproved webhook.', 401, 'WEBHOOK_SIGNATURE_INVALID');
  if (provider === 'MAILCHIMP') {
    await validateMailchimpSecret(queryParams.key);
    if (process.env.MAILCHIMP_WEBHOOK_SIGNING_SECRET && !verifyMailchimp(body, headers['x-mailchimp-signature'], process.env.MAILCHIMP_WEBHOOK_SIGNING_SECRET)) throw new AppError('Invalid webhook signature.', 401, 'WEBHOOK_SIGNATURE_INVALID');
  }
  let payload;
  try {
    if (provider === 'MAILCHIMP' && Buffer.isBuffer(body) && String(headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
      payload = {
        data: {}
      };
      for (const [key, value] of new URLSearchParams(body.toString('utf8'))) {
        const nested = /^data\[([a-zA-Z0-9_]+)\]$/.exec(key);
        if (nested) payload.data[nested[1]] = value;else if (['type', 'fired_at', 'id'].includes(key)) payload[key] = value;
      }
    } else payload = Buffer.isBuffer(body) ? JSON.parse(body.toString('utf8')) : body;
  } catch {
    throw new AppError('Invalid webhook body.', 400, 'WEBHOOK_BODY_INVALID');
  }
  const row = await connection(provider);
  if (row.status === 'DISABLED' || !row.encrypted_credentials || row.metadata.needs_selection) throw new AppError('Provider is not enabled.', 409, 'PROVIDER_NOT_CONNECTED');
  const events = [];
  if (provider === 'META') {
    for (const entry of payload.entry || []) for (const change of entry.changes || []) if (change.field === 'leadgen' && change.value?.leadgen_id) {
      const value = change.value;
      if (String(value.page_id || entry.id) !== row.metadata.page_id) continue;
      events.push({
        id: String(value.leadgen_id),
        type: 'leadgen',
        payload: {
          ...value,
          page_id: String(value.page_id || entry.id),
          received_at: new Date().toISOString()
        }
      });
    }
  } else if (provider === 'TIKTOK') {
    // Approved Business webhook contracts must include identity/account and actual fields.
    const data = typeof payload.content === 'string' ? JSON.parse(payload.content) : payload.data || payload.content || payload;
    if (String(data.advertiser_id || data.account_id) !== String(row.metadata.advertiser_id)) throw new AppError('Webhook account does not match the selected advertiser.', 403, 'WEBHOOK_ACCOUNT_MISMATCH');
    const id = data.lead_id || data.id;
    if (!id) throw new AppError('TikTok lead identifier is missing.', 422, 'WEBHOOK_BODY_INVALID');
    events.push({
      id: String(id),
      type: 'lead',
      payload: {
        ...data,
        received_at: new Date().toISOString()
      }
    });
  } else {
    if (String(payload.data?.list_id || '') !== row.metadata.audience_id) throw new AppError('Webhook audience does not match.', 403, 'WEBHOOK_ACCOUNT_MISMATCH');
    if (!['subscribe', 'unsubscribe', 'profile', 'upemail', 'cleaned', 'campaign'].includes(payload.type)) return {
      accepted: true,
      ignored: true
    };
    events.push({
      id: payload.id || digest(JSON.stringify(payload)),
      type: payload.type,
      payload
    });
  }
  await transaction(async () => {
    for (const item of events) {
      const result = await query("INSERT INTO webhook_events(provider,event_type,external_event_id,provider_event_id,payload) VALUES($1,$2,$3,$3,$4) ON CONFLICT(provider,external_event_id) DO UPDATE SET external_event_id=EXCLUDED.external_event_id RETURNING id,status", [provider, item.type, item.id, redactProvider(item.payload)]);
      const event = result.rows[0];
      if (!['PROCESSED', 'IGNORED'].includes(event.status)) await queueExternal(provider, 'WEBHOOK_PROCESS', {
        webhook_id: event.id
      }, null, `${provider}:webhook:${event.id}`);
    }
    await query('UPDATE integration_connections SET last_webhook_at=now(),updated_at=now() WHERE id=$1', [row.id]);
  });
  return {
    accepted: true,
    events: events.length
  };
}
function leadFields(data) {
  const fields = {};
  for (const f of data.field_data || data.fields || []) {
    const key = f.name || f.key;
    if (key) fields[key] = f.values?.[0] ?? f.value;
  }
  return {
    ...fields,
    ...(data.email ? {
      email: data.email
    } : {}),
    ...(data.phone ? {
      phone: data.phone
    } : {}),
    ...(fields.phone_number ? {
      phone: fields.phone_number
    } : {}),
    ...(fields.full_name && !fields.first_name ? {
      first_name: fields.full_name.split(' ')[0],
      last_name: fields.full_name.split(' ').slice(1).join(' ')
    } : {})
  };
}
export async function processSocialEvent(provider, row, tokens, event) {
  const p = event.payload;
  if (provider === 'META') {
    if (String(p.page_id) !== String(row.metadata.page_id)) throw new AppError('Selected page changed. Review the queued lead.', 409, 'WEBHOOK_ACCOUNT_MISMATCH');
    const lead = await providerApi(provider, {
      access_token: tokens.page_token
    }, `/${encodeURIComponent(p.leadgen_id)}?fields=id,created_time,field_data,form_id,ad_id,platform`);
    let ad = {};
    if (lead.ad_id || p.ad_id) try {
      ad = await providerApi(provider, tokens, `/${encodeURIComponent(lead.ad_id || p.ad_id)}?fields=id,name,campaign{id,name},adset{id,name}`);
    } catch (e) {
      if (!['PROVIDER_PERMISSION_DENIED', 'PROVIDER_NOT_FOUND', 'PROVIDER_REJECTED'].includes(e.code)) throw e;
    }
    const payload = {
      ...p,
      ...lead,
      ...leadFields(lead),
      external_lead_id: p.leadgen_id,
      source_subtype: lead.platform === 'ig' ? 'INSTAGRAM' : 'FACEBOOK',
      campaign_id: ad.campaign?.id || p.campaign_id,
      campaign_name: ad.campaign?.name,
      ad_set_id: ad.adset?.id || p.adset_id,
      ad_id: lead.ad_id || p.ad_id,
      instagram_account_id: row.metadata.instagram_account_id
    };
    return ingestProviderLead({
      provider,
      payload,
      sourceSubtype: payload.source_subtype,
      webhookEventId: event.id
    });
  }
  // Do not fabricate a lead from an ID-only event. Keep it retryable/reviewable until
  // the app's approved lead-retrieval contract is configured and verified.
  const payload = {
    ...p,
    ...leadFields(p),
    external_lead_id: p.lead_id || p.id,
    account_id: p.advertiser_id || p.account_id,
    source_subtype: 'TIKTOK'
  };
  if (!payload.email && !payload.phone) throw new AppError('TikTok webhook does not contain approved lead fields. Confirm the app lead retrieval contract.', 422, 'TIKTOK_LEAD_FIELDS_REQUIRED');
  return ingestProviderLead({
    provider,
    payload,
    sourceSubtype: 'TIKTOK',
    webhookEventId: event.id
  });
}
export async function processMailchimpEvent(row, tokens, event) {
  const p = event.payload,
    data = p.data || {},
    email = String(data.email || data.new_email || '').trim().toLowerCase();
  if (data.list_id !== row.metadata.audience_id) throw new AppError('Selected audience changed.', 409, 'WEBHOOK_ACCOUNT_MISMATCH');
  if (p.type === 'campaign') return {
    records_processed: 0
  };
  if (!email || !email.includes('@')) throw new AppError('Missing webhook contact.', 422, 'WEBHOOK_BODY_INVALID');
  const denied = ['unsubscribe', 'cleaned'].includes(p.type);
  if (denied) {
    for (const table of ['leads', 'clients']) await query(`UPDATE ${table} SET marketing_email_opt_in=false,marketing_opted_out_at=now(),updated_at=now() WHERE lower(email)=$1 AND deleted_at IS NULL`, [email]);
    await query('INSERT INTO campaign_suppressions(email,reason) VALUES($1,$2) ON CONFLICT(email) DO NOTHING', [email, `MAILCHIMP_${p.type.toUpperCase()}`]);
    return {
      records_processed: 1,
      records_updated: 1
    };
  }
  // Provider profiles and subscribes are evidence, not permission to overwrite CRM
  // or erase a local opt-out. Fetch current membership to reject forged/stale values.
  const member = await providerApi('MAILCHIMP', tokens, `/lists/${row.metadata.audience_id}/members/${memberHash(email)}`);
  await query("UPDATE clients SET communication_preferences=jsonb_set(communication_preferences,'{mailchimp}', $1::jsonb) WHERE lower(email)=$2 AND deleted_at IS NULL", [JSON.stringify({
    status: member.status,
    last_event: p.type,
    review_required: p.type === 'upemail' || p.type === 'subscribe',
    received_at: event.received_at
  }), email]);
  await query("UPDATE leads SET source_details=jsonb_set(COALESCE(source_details,'{}'),'{mailchimp}', $1::jsonb) WHERE lower(email)=$2 AND deleted_at IS NULL", [JSON.stringify({
    status: member.status,
    last_event: p.type,
    review_required: p.type === 'upemail' || p.type === 'subscribe',
    received_at: event.received_at
  }), email]);
  return {
    records_processed: 1,
    records_updated: 1
  };
}
