import { query, transaction } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { recordActivity } from './activity-service.js';
import { ensureEventPlanning } from './event-planning-service.js';

// Never perform provider requests while this reservation transaction is open.
export async function lockBookingReservations() {
  await query('SELECT pg_advisory_xact_lock(7811051)');
}

export async function expireBookingHolds() {
  return transaction(async () => {
    await lockBookingReservations();
    return (await query("UPDATE booking_holds SET status='EXPIRED',updated_at=now() WHERE status='ACTIVE' AND expires_at<=clock_timestamp() RETURNING id,event_id")).rows;
  });
}

export async function createBookingHold(eventId, { equipmentIds = [], backdropIds = [], minutes = 15, actorUserId = null } = {}) {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 30) throw new AppError('Hold duration must be 5–30 minutes.', 422, 'HOLD_DURATION_INVALID');
  if (!equipmentIds.length && !backdropIds.length) throw new AppError('Select physical resources before reserving a booking.', 422, 'HOLD_RESOURCES_REQUIRED');
  if(backdropIds.length>1)throw new AppError('Choose one backdrop for this booking.',422,'HOLD_BACKDROP_INVALID');
  return transaction(async () => {
    await lockBookingReservations();
    await expireBookingHolds();
    const event = (await query('SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [eventId])).rows[0];
    if (!event || !['DRAFT','TENTATIVE','INQUIRY','PENDING_CONTRACT','PENDING_DEPOSIT'].includes(event.status)) throw new AppError('This event cannot be held.', 409, 'HOLD_EVENT_INVALID');
    const existing = (await query("SELECT * FROM booking_holds WHERE event_id=$1 AND status='ACTIVE'", [eventId])).rows[0];
    if (existing) {
      const resources = (await query('SELECT equipment_id,backdrop_id FROM booking_hold_resources WHERE hold_id=$1', [existing.id])).rows;
      const same = (a,b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
      if (!same(equipmentIds,resources.map(r=>r.equipment_id).filter(Boolean)) || !same(backdropIds,resources.map(r=>r.backdrop_id).filter(Boolean))) throw new AppError('Release the existing hold before changing its resources.',409,'HOLD_RESOURCE_MISMATCH');
      return existing; // Replay must not extend capacity indefinitely.
    }
    const hold = (await query("INSERT INTO booking_holds(event_id,created_by,expires_at) VALUES($1,$2,clock_timestamp()+make_interval(mins=>$3)) RETURNING *", [eventId,actorUserId,minutes])).rows[0];
    for (const id of new Set(equipmentIds)) await query('INSERT INTO booking_hold_resources(hold_id,equipment_id) VALUES($1,$2)', [hold.id,id]);
    for (const id of new Set(backdropIds)) await query('INSERT INTO booking_hold_resources(hold_id,backdrop_id) VALUES($1,$2)', [hold.id,id]);
    await query('SELECT assert_event_reservations($1)', [eventId]);
    await recordActivity({entityType:'event',entityId:eventId,action:'booking_hold_created',summary:`Booking resources held for ${minutes} minutes`});
    return hold;
  });
}

export async function assertCheckoutHold(eventId){
  if(!eventId)return null;
  return transaction(async()=>{
    await lockBookingReservations();
    const event=(await query('SELECT status FROM events WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[eventId])).rows[0];
    if(!event||event.status==='CANCELLED')throw new AppError('This booking is unavailable.',409,'BOOKING_UNAVAILABLE');
    if(['CONFIRMED','PREPARING','READY','IN_PROGRESS','COMPLETED'].includes(event.status))return null;
    const hold=(await query("SELECT *,expires_at>clock_timestamp() AS unexpired FROM booking_holds WHERE event_id=$1 ORDER BY (status='ACTIVE') DESC,created_at DESC,id DESC LIMIT 1",[eventId])).rows[0];
    if(!hold)return null; // Preserve existing invoice-only/manual booking flows.
    if(hold.status!=='ACTIVE'||!hold.unexpired)throw new AppError('The booking hold expired. Ask LOLA to recheck availability before paying.',409,'BOOKING_HOLD_EXPIRED');
    await query('SELECT assert_event_reservations($1)',[eventId]);return hold;
  });
}

export async function releaseBookingHold(eventId) {
  return transaction(async () => {
    await lockBookingReservations();
    return (await query("UPDATE booking_holds SET status='RELEASED',updated_at=now() WHERE event_id=$1 AND status='ACTIVE' RETURNING id,event_id,status", [eventId])).rows[0] || null;
  });
}

// Only call after the caller has verified its booking/payment confirmation policy.
export async function confirmHeldBooking(eventId, holdId) {
  return transaction(async () => {
    await lockBookingReservations();
    const hold = (await query('SELECT *,expires_at>clock_timestamp() AS unexpired FROM booking_holds WHERE id=$1 AND event_id=$2 FOR UPDATE', [holdId,eventId])).rows[0];
    const event = (await query('SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [eventId])).rows[0];
    if (hold?.status==='CONFIRMED' && event?.status==='CONFIRMED') return event;
    if (!event || ['CANCELLED','COMPLETED'].includes(event.status) || hold?.status!=='ACTIVE' || !hold.unexpired) throw new AppError('The booking hold expired or is unavailable. Recheck availability before confirming.',409,'BOOKING_HOLD_EXPIRED');
    await query('SELECT assert_event_reservations($1)', [eventId]);
    const resources = (await query('SELECT * FROM booking_hold_resources WHERE hold_id=$1', [holdId])).rows;
    for (const resource of resources) {
      if (resource.equipment_id) await query(`INSERT INTO equipment_assignments(event_id,equipment_id,assigned_by)
        SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM equipment_assignments WHERE event_id=$1 AND equipment_id=$2 AND released_at IS NULL)`, [eventId,resource.equipment_id,hold.created_by]);
    }
    const updated = (await query("UPDATE events SET status='CONFIRMED',updated_at=now() WHERE id=$1 RETURNING *", [eventId])).rows[0];
    for (const resource of resources.filter(r=>r.backdrop_id)) {
      await ensureEventPlanning(eventId);
      const planning = (await query('SELECT backdrop_id FROM event_planning WHERE event_id=$1', [eventId])).rows[0];
      if (planning?.backdrop_id && planning.backdrop_id!==resource.backdrop_id) throw new AppError('The planning backdrop differs from the booking hold.',409,'HOLD_BACKDROP_MISMATCH');
      await query("UPDATE event_planning SET backdrop_id=$2,backdrop_path='COLLECTION',backdrop_review_status='NEEDS_REVIEW' WHERE event_id=$1", [eventId,resource.backdrop_id]);
    }
    await query("UPDATE booking_holds SET status='CONFIRMED',updated_at=now() WHERE id=$1", [holdId]);
    await recordActivity({entityType:'event',entityId:eventId,action:'booking_hold_confirmed',summary:'Held resources assigned and booking confirmed atomically'});
    return updated;
  });
}
