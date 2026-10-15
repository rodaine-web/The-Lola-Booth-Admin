import { hasCurrentAvailability, leadBookingRequest, leadEventInput } from './lead-availability-service.js';
import { isDeepStrictEqual } from 'node:util';
import { query, transaction } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { stagingJobsPaused, stagingAutomationScope } from '../config/staging-safety.js';
import { publicBookingCatalog, validateBookingSelections } from './public-booking-service.js';
import { createProposal, createProposalVersion } from './proposal-service.js';
import { createNotification } from './notification-service.js';

export const WEBSITE_PROPOSAL_JOB = 'BOOKING_SEND_WEBSITE_PROPOSAL';
export const websiteProposalEnabled = () => process.env.BOOKING_WEBSITE_PROPOSAL_ENABLED === 'true';

// Availability approval authorizes draft preparation only. Customer delivery always requires final Admin review.
export function automaticWebsiteQuoteDecision(booking, input, config = process.env) {
  if (!booking?.selections?.length) return 'Choose experiences and packages';
  if (!input?.eventDate || !input.eventStartTime || !input.eventEndTime || !input.venueAddress) return 'Complete event date, times and venue address';
  if (booking.selections.some(x => x.pricingMode !== 'FIXED' || !Number.isFinite(x.startingPrice) || x.startingPrice <= 0)) return 'Review custom package pricing';
  if ((booking.addons || []).some(x => x.pricingType === 'CUSTOM' || !Number.isFinite(x.unitPrice) || x.unitPrice < 0)) return 'Review custom add-on or travel pricing';
  if (input.eventEndTime <= input.eventStartTime) return 'Review overnight event hours';
  return null;
}

export async function queueWebsiteProposal(leadId) {
  if (!websiteProposalEnabled()) return;
  return transaction(async client => {
    const lead = (await client.query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [leadId])).rows[0];
    if (!hasCurrentAvailability(lead)) return;
    const booking = await leadBookingRequest(lead);
    const review = automaticWebsiteQuoteDecision(booking, leadEventInput(lead));
    if (review) {
      if (booking.selections.some(x=>x.pricingMode==='CUSTOM')) return;
      await client.query(`INSERT INTO tasks(lifecycle_key,title,description,lead_id,priority) VALUES($1,$2,$3,$4,'HIGH') ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING`, [`lead-quote-review:${lead.id}:${lead.availability_fingerprint}`, booking.selections.some(x=>x.pricingMode==='CUSTOM') ? 'Schedule discovery call' : 'Review proposal request', review, lead.id]);
      return;
    }
    if ((await client.query("SELECT 1 FROM automation_jobs WHERE job_type=$1 AND related_entity_id=$2 AND payload->>'approvalFingerprint'=$3", [WEBSITE_PROPOSAL_JOB, leadId, lead.availability_fingerprint])).rowCount) return;
    await client.query(`INSERT INTO automation_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_for)
      VALUES($1,'lead',$2,$3,now())`, [WEBSITE_PROPOSAL_JOB, leadId, { fingerprint: booking.submissionFingerprint || lead.availability_fingerprint, approvalFingerprint: lead.availability_fingerprint, booking }]);
  });
}

async function prepareWebsiteProposal(job) {
  return transaction(async client => {
    const lead = (await client.query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [job.related_entity_id])).rows[0];
    if (!lead || ['LOST', 'WON', 'ARCHIVED'].includes(lead.status)) return null;
    if (!hasCurrentAvailability(lead, job.payload.approvalFingerprint)) return null;
    const booking = job.payload.booking;
    const input = leadEventInput(lead);
    if (!booking) throw new AppError('The submitted request changed. Review it before sending.', 409, 'WEBSITE_QUOTE_CHANGED', { retryable: false });
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
      if (!isDeepStrictEqual(current, { selections: booking.selections, addons: booking.addons })) throw new AppError('Catalogue or prices changed since submission. Review the quote.', 409, 'WEBSITE_CATALOG_CHANGED', { retryable: false });
      let customer = lead.converted_client_id ? (await client.query('SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL', [lead.converted_client_id])).rows[0] : null;
      // Do not attach an unauthenticated request to another customer's existing record by email alone.
      if (!customer) customer = (await client.query('INSERT INTO clients(name,email,phone,referral_source,sales_qualified) VALUES($1,$2,$3,$4,false) RETURNING *', [[lead.first_name, lead.last_name].join(' '), lead.email, lead.phone, 'Website request'])).rows[0];
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
    if (!['DRAFT','READY'].includes(proposal.status)) return null;
    await client.query("UPDATE leads SET status='PROPOSAL_DRAFT',updated_at=now() WHERE id=$1 AND status IN ('NEW','CONTACTED','QUALIFIED','FOLLOW_UP')",[lead.id]);
    const taskKey=`proposal-ready-review:${proposal.id}`;
    await client.query(`INSERT INTO tasks(lifecycle_key,title,description,lead_id,proposal_id,priority)
      VALUES($1,'Review and send proposal',$2,$3,$4,'HIGH')
      ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO NOTHING`,
      [taskKey,'Availability is confirmed. Review the original request, answer client questions, and check travel and other charges before sending. No proposal email has been sent.',lead.id,proposal.id]);
    if (!(await client.query("SELECT 1 FROM notifications WHERE entity_type='proposal' AND entity_id=$1 AND metadata->>'reason'='AVAILABILITY_DRAFT_READY'",[proposal.id])).rowCount)
      await createNotification({roleTarget:'OWNER_ADMIN',category:'SALES',title:'Proposal ready for review',
        body:`${proposal.proposal_number}: availability confirmed. Review client questions, notes and charges, then explicitly send the proposal.`,
        entityType:'proposal',entityId:proposal.id,actionUrl:`/sales/proposals/${proposal.id}`,metadata:{reason:'AVAILABILITY_DRAFT_READY',lead_id:lead.id}});
    return { proposalId:proposal.id, leadId:lead.id };
  });
}

export async function processWebsiteProposalHandoffs({ limit = 10 } = {}) {
  if (!websiteProposalEnabled() || stagingJobsPaused()) return { processed: [] };
  const scope = stagingAutomationScope();
  const jobs = await transaction(async client => {
    const params = [WEBSITE_PROPOSAL_JOB, scope?.since || null, scope?.recipients || []];
    const guard = `job_type=$1 AND ($2::timestamptz IS NULL OR (created_at>=$2 AND EXISTS(SELECT 1 FROM leads l WHERE l.id=related_entity_id AND (cardinality($3::text[])=0 OR lower(l.email)=ANY($3::text[])))))`;
    await client.query(`UPDATE automation_jobs SET status='FAILED',last_error='Interrupted proposal preparation; review draft before retrying',updated_at=now() WHERE ${guard} AND status='PROCESSING' AND started_at<now()-interval '10 minutes'`, params);
    const rows = (await client.query(`SELECT * FROM automation_jobs WHERE ${guard} AND status='PENDING' AND scheduled_for<=now() ORDER BY scheduled_for LIMIT $4 FOR UPDATE SKIP LOCKED`, [...params, limit])).rows;
    for (const row of rows) await client.query("UPDATE automation_jobs SET status='PROCESSING',started_at=now(),attempt_count=attempt_count+1 WHERE id=$1", [row.id]);
    return rows;
  });
  const processed = [];
  for (const job of jobs) {
    try {
      const prepared = await prepareWebsiteProposal(job);
      const status=prepared?'COMPLETED':'CANCELLED';
      await query('UPDATE automation_jobs SET status=$2,completed_at=now(),last_error=NULL,updated_at=now() WHERE id=$1',[job.id,status]);
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
