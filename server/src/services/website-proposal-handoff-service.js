import { query, transaction } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { stagingJobsPaused, stagingAutomationScope } from '../config/staging-safety.js';
import { publicBookingCatalog, validateBookingSelections } from './public-booking-service.js';
import { createProposal, createProposalVersion, getProposal, publicProposalUrl } from './proposal-service.js';
import { createCommunicationDraft, sendCommunication, brandedEmailHtml, renderCommunicationTemplateByKey } from './automation-service.js';

export const WEBSITE_PROPOSAL_JOB = 'BOOKING_SEND_WEBSITE_PROPOSAL';
export const websiteProposalEnabled = () => process.env.BOOKING_WEBSITE_PROPOSAL_ENABLED === 'true';

// Automatic quotes are limited to explicitly approved fixed-price service areas.
// Custom pricing/travel and changed catalogues require a human commercial review.
export function automaticWebsiteQuoteDecision(booking, input, config = process.env) {
  if (!booking?.selections?.length) return 'Choose experiences and packages';
  if (!input?.eventDate || !input.eventStartTime || !input.eventEndTime || !input.venueAddress) return 'Complete event date, times and venue address';
  const cities = String(config.BOOKING_AUTO_QUOTE_CITIES || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!cities.includes(String(input.city || '').trim().toLowerCase())) return 'Review venue and travel pricing';
  if (booking.selections.some(x => x.pricingMode !== 'FIXED' || !Number.isFinite(x.startingPrice) || x.startingPrice <= 0)) return 'Review custom package pricing';
  if (booking.addons.some(x => x.pricingType === 'CUSTOM' || !Number.isFinite(x.unitPrice) || x.unitPrice < 0 || /custom|travel/i.test(x.name))) return 'Review custom add-on or travel pricing';
  if (input.eventEndTime <= input.eventStartTime) return 'Review overnight event hours';
  return null;
}

export async function queueWebsiteProposal(leadId) {
  if (!websiteProposalEnabled()) return;
  return transaction(async client => {
    const lead = (await client.query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [leadId])).rows[0];
    if (!lead || lead.lead_source !== 'WEBSITE' || lead.source_subtype !== 'BOOKING') return;
    if ((await client.query('SELECT 1 FROM automation_jobs WHERE job_type=$1 AND related_entity_id=$2', [WEBSITE_PROPOSAL_JOB, leadId])).rowCount) return;
    await client.query(`INSERT INTO automation_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_for)
      VALUES($1,'lead',$2,$3,now())`, [WEBSITE_PROPOSAL_JOB, leadId, { fingerprint: lead.source_details?.bookingInquiry?.submissionFingerprint }]);
  });
}

async function prepareWebsiteProposal(job) {
  return transaction(async client => {
    const lead = (await client.query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [job.related_entity_id])).rows[0];
    if (!lead || ['LOST', 'WON', 'ARCHIVED'].includes(lead.status)) return null;
    const booking = lead.source_details?.bookingInquiry;
    const input = lead.source_details;
    if (booking?.submissionFingerprint !== job.payload.fingerprint) throw new AppError('The submitted request changed. Review it before sending.', 409, 'WEBSITE_QUOTE_CHANGED', { retryable: false });
    const review = automaticWebsiteQuoteDecision(booking, input);
    if (review) throw new AppError(review, 409, 'WEBSITE_QUOTE_REVIEW', { retryable: false });
    let proposal = (await client.query('SELECT * FROM proposals WHERE lead_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [lead.id])).rows[0];
    // Never send an unrelated manually prepared draft, or replace an existing proposal.
    if (proposal && proposal.content?.website_submission_fingerprint !== job.payload.fingerprint) return null;
    if (!proposal) {
      const selectionInput = { selections: booking.selections.map(x => ({ experienceId: x.experienceId, packageId: x.packageId })), addons: booking.addons.map(x => ({ addonId: x.addonId, quantity: x.quantity })) };
      await client.query('SELECT id FROM experiences WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[booking.selections.map(x=>x.experienceId)]);
      await client.query('SELECT id FROM packages WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[booking.selections.map(x=>x.packageId)]);
      await client.query('SELECT id FROM addons WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[booking.addons.map(x=>x.addonId)]);
      const current = validateBookingSelections(selectionInput, await publicBookingCatalog());
      if (JSON.stringify(current) !== JSON.stringify({ selections: booking.selections, addons: booking.addons })) throw new AppError('Catalogue or prices changed since submission. Review the quote.', 409, 'WEBSITE_CATALOG_CHANGED', { retryable: false });
      let customer = lead.converted_client_id ? (await client.query('SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL', [lead.converted_client_id])).rows[0] : null;
      // Do not attach an unauthenticated request to another customer's existing record by email alone.
      if (!customer) customer = (await client.query('INSERT INTO clients(name,email,phone,referral_source) VALUES($1,$2,$3,$4) RETURNING *', [[lead.first_name, lead.last_name].join(' '), lead.email, lead.phone, 'Website request'])).rows[0];
      let event = lead.converted_event_id ? (await client.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [lead.converted_event_id])).rows[0] : null;
      if (event && (event.client_id !== customer.id || !['DRAFT','PENDING_DEPOSIT'].includes(event.status) || event.deleted_at)) throw new AppError('Review the existing event linkage.', 409, 'WEBSITE_EVENT_REVIEW', { retryable: false });
      if (!event) event = (await client.query(`INSERT INTO events(client_id,event_name,event_type,event_date,start_time,end_time,venue_name,venue_address,city,state,guest_count,status,experience_id,package_id,client_notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING_DEPOSIT',$12,$13,$14) RETURNING *`, [customer.id, input.eventName || `${customer.name} — ${lead.event_type}`, lead.event_type, lead.event_date, lead.event_start_time, lead.event_end_time, lead.venue_name, lead.venue_address, lead.city, lead.state, lead.guest_count, booking.selections[0].experienceId, booking.selections[0].packageId, input.message || input.notes || null])).rows[0];
      for (const [index, item] of booking.selections.entries()) {
        await client.query('INSERT INTO event_experiences(event_id,experience_id,display_order) VALUES($1,$2,$3) ON CONFLICT(event_id,experience_id) DO NOTHING', [event.id, item.experienceId, index]);
        await client.query('INSERT INTO event_packages(event_id,package_id,display_order) VALUES($1,$2,$3) ON CONFLICT(event_id,package_id) DO NOTHING', [event.id, item.packageId, index]);
      }
      await client.query('UPDATE leads SET converted_client_id=$2,converted_event_id=$3 WHERE id=$1', [lead.id, customer.id, event.id]);
      proposal = await createProposal({ user: {}, headers: {}, body: { lead_id: lead.id, client_id: customer.id, event_id: event.id, scenario_enabled: true,
        selected_experiences: booking.selections.map(x => ({ experience_id: x.experienceId, packages: [{ package_id: x.packageId, price: x.startingPrice }] })),
        addons: booking.addons.map(x => ({ addon_id: x.addonId, quantity: x.quantity, unit_price: x.unitPrice })), deposit_type: 'PERCENTAGE', deposit_value: 30 } });
      proposal = (await client.query('UPDATE proposals SET content=content||$2::jsonb WHERE id=$1 RETURNING *', [proposal.id, { website_submission_fingerprint: job.payload.fingerprint }])).rows[0];
      await createProposalVersion(client, proposal, null);
    }
    if (['ACCEPTED','CONVERTED','DECLINED','EXPIRED'].includes(proposal.status)) return null;
    const expanded = await getProposal(proposal.id);
    const key = `website-proposal:${lead.id}:${job.payload.fingerprint}`;
    let message = (await client.query('SELECT * FROM communications WHERE idempotency_key=$1', [key])).rows[0];
    if (!message) {
      const url = publicProposalUrl(expanded);
      if (!url) throw new AppError('Secure proposal access is unavailable.', 409, 'WEBSITE_PROPOSAL_ACCESS', { retryable: false });
      const merge = { client_name: customerName(expanded), first_name: lead.first_name, proposal_number: expanded.proposal_number, proposal_url: url, proposal: { ...expanded, url, public_url: url } };
      const rendered = await renderCommunicationTemplateByKey('PROPOSAL_DELIVERY', merge) || await renderCommunicationTemplateByKey('proposal_sent', merge);
      const body = rendered?.body || `Hi ${lead.first_name},\n\nYour LOLA proposal is ready. Review the services and pricing here:\n${url}\n\nYour date is not reserved by this proposal. Booking confirmation requires accepted terms, the required booking retainer fee payment, your signed agreement and availability checks.\n\nThe LOLA Booth`;
      message = await createCommunicationDraft({ lead_id: lead.id, client_id: expanded.client_id, event_id: expanded.event_id, proposal_id: expanded.id, recipient: lead.email,
        subject: rendered?.subject || `Your LOLA proposal ${expanded.proposal_number}`, body, html: brandedEmailHtml(body, { ctaLabel: 'View proposal', ctaUrl: url }), trigger_key: WEBSITE_PROPOSAL_JOB,
        template_id: rendered?.template?.id, merge_data: {...merge, website_quote_snapshot: {content:expanded.content, pricing_snapshot:expanded.pricing_snapshot, line_items_snapshot:expanded.line_items_snapshot}} });
      await client.query('UPDATE communications SET idempotency_key=$2 WHERE id=$1', [message.id, key]);
    }
    return { message, proposalId: proposal.id, leadId: lead.id };
  });
}
const customerName = p => p.client_name || 'there';

export async function processWebsiteProposalHandoffs({ limit = 10 } = {}) {
  if (!websiteProposalEnabled() || stagingJobsPaused()) return { processed: [] };
  const scope = stagingAutomationScope();
  const jobs = await transaction(async client => {
    const params = [WEBSITE_PROPOSAL_JOB, scope?.since || null, scope?.recipients || []];
    const guard = `job_type=$1 AND ($2::timestamptz IS NULL OR (created_at>=$2 AND EXISTS(SELECT 1 FROM leads l WHERE l.id=related_entity_id AND (cardinality($3::text[])=0 OR lower(l.email)=ANY($3::text[])))))`;
    await client.query(`UPDATE automation_jobs SET status='FAILED',last_error='Interrupted proposal delivery; review provider history before retrying',updated_at=now() WHERE ${guard} AND status='PROCESSING' AND started_at<now()-interval '10 minutes'`, params);
    const rows = (await client.query(`SELECT * FROM automation_jobs WHERE ${guard} AND status='PENDING' AND scheduled_for<=now() ORDER BY scheduled_for LIMIT $4 FOR UPDATE SKIP LOCKED`, [...params, limit])).rows;
    for (const row of rows) await client.query("UPDATE automation_jobs SET status='PROCESSING',started_at=now(),attempt_count=attempt_count+1 WHERE id=$1", [row.id]);
    return rows;
  });
  const processed = [];
  for (const job of jobs) {
    try {
      const prepared = await prepareWebsiteProposal(job);
      const sent = prepared ? await sendCommunication(prepared.message.id) : null;
      const status = !prepared || sent.communication.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
      if (status === 'COMPLETED' && !['SENT','SENT_TO_PROVIDER','DELIVERED'].includes(sent.communication.status)) throw new AppError('Review proposal delivery.',409,'WEBSITE_DELIVERY_UNCERTAIN',{retryable:false});
      await transaction(async client => {
        if (status === 'COMPLETED') {
          await client.query(`UPDATE proposals SET status=CASE WHEN status='DRAFT' THEN 'SENT' ELSE status END,sent_at=COALESCE(sent_at,now()),updated_at=now(),proposal_snapshot=COALESCE(proposal_snapshot,jsonb_build_object('content',content,'pricing_snapshot',pricing_snapshot,'line_items_snapshot',line_items_snapshot,'selected_experiences',selected_experiences)) WHERE id=$1`, [prepared.proposalId]);
          await client.query("UPDATE leads SET status='PROPOSAL_SENT',updated_at=now() WHERE id=$1 AND status IN ('NEW','CONTACTED','QUALIFIED','PROPOSAL_DRAFT','FOLLOW_UP')", [prepared.leadId]);
          if (!(await client.query('SELECT 1 FROM proposal_deliveries WHERE proposal_id=$1', [prepared.proposalId])).rowCount) await client.query("INSERT INTO proposal_deliveries(proposal_id,recipient_email,delivery_method,status,sent_at) VALUES($1,$2,'EMAIL',$3,now())", [prepared.proposalId, sent.communication.recipient, sent.communication.status]);
        }
        await client.query('UPDATE automation_jobs SET status=$2,completed_at=now(),last_error=NULL,updated_at=now() WHERE id=$1', [job.id, status]);
      });
      processed.push({ id: job.id, status });
    } catch (error) {
      const status = error.details?.retryable !== false && job.attempt_count + 1 < job.max_attempts ? 'PENDING' : 'FAILED';
      await query("UPDATE automation_jobs SET status=$2,scheduled_for=now()+interval '2 minutes',last_error=$3,updated_at=now() WHERE id=$1", [job.id, status, error.message]);
      if (status === 'FAILED') await query(`INSERT INTO tasks(lifecycle_key,title,description,lead_id,priority) VALUES($1,'Review website proposal',$2,$3,'HIGH') ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING`, [`website-proposal-review:${job.id}`, error.message, job.related_entity_id]);
      processed.push({ id: job.id, status });
    }
  }
  return { processed };
}
