import { eligibleAudience } from '../../../shared/campaign-content.js';
import { AppError } from '../utils/errors.js';
import { grantUsable } from './gallery-policy.js';

// Recheck after claiming work. A provider request already in flight cannot be recalled.
export async function dispatchDecision(client, message) {
  if (message.trigger_key === 'BOOKING_SEND_ACCEPTED_INVOICE') {
    if (process.env.BOOKING_INVOICE_HANDOFF_ENABLED !== 'true') return 'CANCELLED';
    const [prefix, proposalId, versionId] = String(message.idempotency_key || '').split(':');
    if (prefix !== 'booking-invoice' || !proposalId || !versionId) return 'CANCELLED';
    const allowed = await client.query(`SELECT 1 FROM invoices i JOIN proposals p ON p.id=i.proposal_id
      JOIN clients c ON c.id=i.client_id LEFT JOIN events e ON e.id=i.event_id
      WHERE i.id=$1 AND p.id=$2 AND p.accepted_version_id::text=$3
      AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND c.deleted_at IS NULL
      AND lower(c.email)=lower($4) AND p.status IN ('ACCEPTED','CONVERTED')
      AND i.status NOT IN ('PAID','VOID','REFUNDED')
      AND i.amount_paid < COALESCE((i.pricing_snapshot->>'amount_due_now')::numeric,0)
      AND (i.event_id IS NULL OR (e.id IS NOT NULL AND e.deleted_at IS NULL AND e.status<>'CANCELLED'))`,
    [message.invoice_id, proposalId, versionId, message.recipient]);
    if (!allowed.rowCount) return 'CANCELLED';
  }

  if(message.trigger_key==='PLANNING_RECURRING_REMINDER'){
    if(process.env.PLANNING_REMINDERS_ENABLED!=='true')return 'CANCELLED';
    const allowed=await client.query(`SELECT 1 FROM planning_reminder_ledger l JOIN events e ON e.id=l.event_id
      JOIN clients c ON c.id=e.client_id WHERE l.communication_id=$1 AND e.id=$2 AND c.id=$3
      AND e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.status IN ('CONFIRMED','PREPARING','READY') AND e.event_date>=current_date
      AND ((l.kind='PLANNING' AND EXISTS(SELECT 1 FROM event_planning p WHERE p.id=l.entity_id AND p.event_id=e.id AND p.client_id=c.id
        AND p.token_hash=l.grant_version AND p.revoked_at IS NULL AND p.expires_at>now() AND p.submitted_at IS NULL))
       OR (l.kind='CREATIVE' AND EXISTS(SELECT 1 FROM creative_approvals a WHERE a.id=l.entity_id AND a.event_id=e.id AND a.client_id=c.id
        AND a.version::text=l.grant_version AND a.deleted_at IS NULL AND a.expires_at>now() AND a.status IN ('PENDING_APPROVAL','VIEWED'))))`,[message.id,message.event_id,message.client_id]);
    if(!allowed.rowCount)return 'CANCELLED';
  }
  if (message.trigger_key === 'PLANNING_INVITATION') {
    const [prefix,planningId,tokenHash]=String(message.idempotency_key||'').split(':');
    if(prefix!=='planning-invitation'||!planningId||!tokenHash)return 'CANCELLED';
    const allowed=await client.query(`SELECT 1 FROM event_planning p JOIN events e ON e.id=p.event_id
      JOIN clients c ON c.id=p.client_id AND c.id=e.client_id
      WHERE p.id=$1 AND p.token_hash=$2 AND p.invitation_communication_id=$3
      AND p.revoked_at IS NULL AND p.expires_at>now() AND e.deleted_at IS NULL AND c.deleted_at IS NULL
      AND e.status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS')`,[planningId,tokenHash,message.id]);
    if(!allowed.rowCount)return 'CANCELLED';
  }
  if (message.trigger_key === 'APPROVAL_REQUESTED') {
    const allowed=await client.query(`SELECT 1 FROM creative_approvals a JOIN events e ON e.id=a.event_id
      JOIN clients c ON c.id=a.client_id AND c.id=e.client_id
      WHERE a.communication_id=$1 AND a.deleted_at IS NULL AND a.status IN ('PENDING_APPROVAL','VIEWED')
      AND a.expires_at>now() AND e.deleted_at IS NULL AND c.deleted_at IS NULL
      AND e.status NOT IN ('CANCELLED','COMPLETED')`,[message.id]);
    if(!allowed.rowCount)return 'CANCELLED';
  }
  if (message.trigger_key === 'GALLERY_DELIVERY' && message.idempotency_key?.startsWith('gallery-delivery:')) {
    const keyId = message.idempotency_key.split(':')[1];
    const grant = (await client.query(`SELECT k.*,a.status AS album_status,a.expires_at AS album_expires_at,
      p.status AS person_status FROM gallery_access_keys k JOIN gallery_albums a ON a.id=k.album_id
      LEFT JOIN gallery_people p ON p.id=k.person_id WHERE k.id=$1`, [keyId])).rows[0];
    if (!grantUsable(grant)) return 'CANCELLED';
  }
  if (message.trigger_key === 'GALLERY_DELIVERY' && message.idempotency_key?.startsWith('event-gallery-delivery:')) {
    const allowed = await client.query(`SELECT 1 FROM gallery_deliveries WHERE id=$1 AND status='ACTIVE'
      AND (expires_at IS NULL OR expires_at>now())`, [message.idempotency_key.split(':')[1]]);
    if (!allowed.rowCount) return 'CANCELLED';
  }
  if (message.campaign_recipient_id) {
    const r = (await client.query(`SELECT r.*,c.status AS campaign_status,
      EXISTS(SELECT 1 FROM campaign_suppressions s WHERE s.email=lower(r.email)) AS suppressed
      FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.id=$1`,
    [message.campaign_recipient_id])).rows[0];
    if (!r || r.unsubscribed_at || r.suppressed || ['CANCELLED','ARCHIVED'].includes(r.campaign_status)) return 'CANCELLED';
    if (r.campaign_status === 'PAUSED') throw new AppError('Campaign is paused.',409,'CAMPAIGN_PAUSED',{retryable:false});
    if (r.campaign_status !== 'SENDING') return 'CANCELLED';
    const table = r.lead_id ? 'leads' : r.client_id ? 'clients' : null;
    if (table) {
      const contact = (await client.query(`SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL`, [r.lead_id || r.client_id])).rows[0];
      if (!contact || !eligibleAudience([contact]).count) return 'CANCELLED';
    }
  }
  if (message.trigger_key === 'OVERDUE_BALANCE_REMINDER') {
    const allowed = await client.query(`SELECT 1 FROM invoices WHERE id=$1 AND deleted_at IS NULL
      AND due_date<current_date AND balance_due>0 AND status NOT IN ('DRAFT','VOID','PAID','REFUNDED')`, [message.invoice_id]);
    if (!allowed.rowCount) return 'CANCELLED';
  }
  if (message.trigger_key === 'EVENT_24H_REMINDER') {
    const allowed = await client.query(`SELECT 1 FROM events WHERE id=$1 AND deleted_at IS NULL
      AND status IN ('CONFIRMED','PREPARING','READY','IN_PROGRESS')
      AND ((event_date+COALESCE(start_time,'12:00'::time)) AT TIME ZONE
        COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))
        BETWEEN now() AND now()+interval '24 hours'`, [message.event_id]);
    if (!allowed.rowCount) return 'CANCELLED';
  }
  return 'SEND';
}

export function scheduledRetry(error, attempts) {
  if (error.details?.outcomeUnknown || error.code === 'DELIVERY_OUTCOME_UNKNOWN' ||
      error.details?.retryable === false || attempts >= 3) return null;
  const seconds = Math.max(60 * 2 ** Math.max(0, attempts - 1), Number(error.details?.retryAfter || 0));
  return new Date(Date.now() + seconds * 1000);
}
