import crypto from 'node:crypto';
import { query, transaction } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { publicBookingCatalog, validateBookingSelections } from './public-booking-service.js';

export function leadRequestFingerprint(lead) {
  return crypto.createHash('sha256').update(JSON.stringify([
    lead.event_date, lead.event_start_time, lead.event_end_time, lead.venue_name, lead.venue_address,
    lead.city, lead.state, lead.zip, lead.email, lead.guest_count, lead.event_type,
    lead.preferred_package_id, lead.preferred_experience_id, lead.source_details?.bookingInquiry || null
  ])).digest('hex');
}
export function hasCurrentAvailability(lead, fingerprint = lead?.availability_fingerprint) {
  return Boolean(lead?.availability_confirmed_at && lead.availability_confirmed_by && fingerprint &&
    fingerprint === lead.availability_fingerprint && fingerprint === leadRequestFingerprint(lead) &&
    !lead.deleted_at && !['LOST','WON','ARCHIVED'].includes(lead.status));
}
export async function leadBookingRequest(lead) {
  if (lead.source_details?.bookingInquiry) return lead.source_details.bookingInquiry;
  if (!lead.preferred_package_id) return {selections: [], addons: []};
  const pkg = (await query('SELECT experience_id FROM packages WHERE id=$1 AND deleted_at IS NULL',[lead.preferred_package_id])).rows[0];
  return validateBookingSelections({selections: [{experienceId: lead.preferred_experience_id || pkg?.experience_id, packageId: lead.preferred_package_id}], addons: []}, await publicBookingCatalog());
}
export function leadEventInput(lead) {
  return {...lead.source_details, eventDate: lead.event_date, eventStartTime: lead.event_start_time,
    eventEndTime: lead.event_end_time, venueAddress: lead.venue_address, city: lead.city};
}
export async function availabilityCalendar(lead) {
  if (!lead.event_date) return {events: [], revision: 'no-date'};
  // Same events/bookings/holds used by the booking calendar. Adjacent days expose overnight commitments.
  const events = (await query(`SELECT e.id,e.event_name,e.event_date,e.start_time,e.end_time,e.setup_time,e.breakdown_time,e.venue_name,e.venue_address,e.city,e.state,e.status,e.updated_at,
    EXISTS(SELECT 1 FROM booking_holds h WHERE h.event_id=e.id AND h.status='ACTIVE' AND h.expires_at>clock_timestamp()) AS active_hold,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'paymentStatus',b.payment_status,'updated_at',b.updated_at) ORDER BY b.id) FROM bookings b WHERE b.event_id=e.id),'[]') AS bookings
    FROM events e WHERE e.deleted_at IS NULL AND e.status<>'CANCELLED'
    AND e.event_date BETWEEN $1::date-1 AND $1::date+1 AND e.id IS DISTINCT FROM $2::uuid
    ORDER BY e.event_date,e.start_time,e.id`, [lead.event_date, lead.converted_event_id || null])).rows;
  return {events, revision: crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex')};
}
export async function previewLeadAvailability(id) {
  const lead=(await query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];
  if (!lead) throw new AppError('Lead not found.',404,'NOT_FOUND');
  let booking, review;
  try { booking=await leadBookingRequest(lead); } catch (error) { booking={selections:[],addons:[]}; review=error.message; }
  const custom=booking.selections.some(x=>x.pricingMode==='CUSTOM' || /custom/i.test(x.packageName || ''));
  const calendar=await availabilityCalendar(lead);
  const existingClient=!lead.converted_client_id && lead.email ? (await query("SELECT id,name FROM clients WHERE lower(email)=lower($1) AND deleted_at IS NULL ORDER BY created_at LIMIT 1",[lead.email])).rows[0] : null;
  const confirmer=lead.availability_confirmed_by ? (await query('SELECT name FROM users WHERE id=$1',[lead.availability_confirmed_by])).rows[0]?.name : null;
  return {fingerprint:leadRequestFingerprint(lead),calendar,custom,review,existingClient,confirmed:hasCurrentAvailability(lead),confirmedAt:lead.availability_confirmed_at,confirmedBy:confirmer,
    automationEnabled:process.env.BOOKING_WEBSITE_PROPOSAL_ENABLED==='true'};
}
export async function confirmLeadAvailability(id, {fingerprint,calendarRevision,confirmed,clientId}, user) {
  if (typeof confirmed !== 'boolean') throw new AppError('Choose whether availability is confirmed.',422,'VALIDATION_ERROR');
  return transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(7811051)');
    const lead=(await client.query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
    if (!lead) throw new AppError('Lead not found.',404,'NOT_FOUND');
    if (['LOST','WON','ARCHIVED'].includes(lead.status)) throw new AppError('This lead is closed.',409,'LEAD_CLOSED');
    if (!confirmed) {
      await client.query('UPDATE leads SET availability_confirmed_at=NULL,availability_confirmed_by=NULL,availability_fingerprint=NULL,updated_at=now() WHERE id=$1',[id]);
      return {confirmed:false};
    }
    if (!lead.event_date || !lead.event_start_time || !lead.event_end_time) throw new AppError('Event date, start time and end time are required before confirming availability.',422,'EVENT_DETAILS_REQUIRED');
    const current=leadRequestFingerprint(lead), calendar=await availabilityCalendar(lead);
    if (fingerprint!==current || calendarRevision!==calendar.revision) throw new AppError('The request or booking calendar changed. Refresh and review availability again.',409,'AVAILABILITY_CHANGED');
    if (!lead.converted_client_id && lead.email) {
      const existing=(await client.query("SELECT id FROM clients WHERE lower(email)=lower($1) AND deleted_at IS NULL FOR SHARE",[lead.email])).rows[0];
      if (existing && existing.id !== clientId) throw new AppError('Verify the matching existing client before approving this returning-client request.',409,'RETURNING_CLIENT_REVIEW');
      if (existing) {
        await client.query('UPDATE leads SET converted_client_id=$2 WHERE id=$1',[id,existing.id]);
        // This particular failure rolled back before a proposal/message existed. Never retry uncertain delivery.
        await client.query(`UPDATE automation_jobs SET status='PENDING',attempt_count=0,scheduled_for=now(),last_error=NULL,updated_at=now()
          WHERE related_entity_id=$1 AND job_type='BOOKING_SEND_WEBSITE_PROPOSAL' AND status='FAILED'
          AND last_error LIKE '%idx_clients_email_active%'
          AND NOT EXISTS(SELECT 1 FROM proposals WHERE lead_id=$1 AND deleted_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM communications WHERE lead_id=$1 AND trigger_key='BOOKING_SEND_WEBSITE_PROPOSAL')`,[id]);
      }
    }
    if (!hasCurrentAvailability(lead)) await client.query('UPDATE leads SET availability_confirmed_at=now(),availability_confirmed_by=$2,availability_fingerprint=$3,updated_at=now() WHERE id=$1',[id,user.id,current]);
    // Queue insertion is in the same transaction as approval, and serialized on the lead.
    const {queueWebsiteProposal}=await import('./website-proposal-handoff-service.js');
    await queueWebsiteProposal(id);
    return previewLeadAvailability(id);
  });
}
