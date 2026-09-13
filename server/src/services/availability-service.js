import { query } from "../db/pool.js";

export async function checkAvailability({ eventDate, setupTime, startTime, endTime, breakdownTime, experienceId, eventId = null }) {
  const conflicts = [];
  const windowStart = setupTime || startTime;
  const windowEnd = breakdownTime || endTime;

  const eventConflicts = await query(
    `SELECT e.id, e.event_name, e.venue_name, e.start_time, e.end_time, e.setup_time, e.breakdown_time
     FROM events e
     WHERE e.event_date = $1
       AND e.deleted_at IS NULL
       AND ($2::uuid IS NULL OR e.id <> $2::uuid)
       AND tstzrange(($1::date + COALESCE(e.setup_time, e.start_time))::timestamptz, ($1::date + COALESCE(e.breakdown_time, e.end_time))::timestamptz, '[)')
         && tstzrange(($1::date + $3::time)::timestamptz, ($1::date + $4::time)::timestamptz, '[)')`,
    [eventDate, eventId, windowStart, windowEnd]
  );

  if (eventConflicts.rows.length) {
    conflicts.push({
      type: "EVENT_OVERLAP",
      severity: "warning",
      message: "Another event overlaps this setup-to-breakdown window.",
      records: eventConflicts.rows
    });
  }

  const equipmentConflicts = await query(
    `SELECT eq.id, eq.name, e.event_name
     FROM equipment_assignments ea
     JOIN equipment eq ON eq.id = ea.equipment_id
     JOIN events e ON e.id = ea.event_id
     WHERE e.event_date = $1
       AND ea.released_at IS NULL
       AND ($2::uuid IS NULL OR e.id <> $2::uuid)
       AND tstzrange(($1::date + COALESCE(e.setup_time, e.start_time))::timestamptz, ($1::date + COALESCE(e.breakdown_time, e.end_time))::timestamptz, '[)')
         && tstzrange(($1::date + $3::time)::timestamptz, ($1::date + $4::time)::timestamptz, '[)')`,
    [eventDate, eventId, windowStart, windowEnd]
  );

  if (equipmentConflicts.rows.length) {
    conflicts.push({
      type: "EQUIPMENT_CONFLICT",
      severity: "critical",
      message: "Assigned equipment is unavailable during setup, event, or breakdown.",
      records: equipmentConflicts.rows
    });
  }

  const staffing = await query("SELECT staff_required FROM experiences WHERE id = $1", [experienceId]);
  const requiredStaff = Number(staffing.rows[0]?.staff_required || 1);

  return {
    available: !conflicts.some((conflict) => conflict.severity === "critical"),
    requiredStaff,
    window: { eventDate, unavailableFrom: windowStart, unavailableUntil: windowEnd },
    conflicts
  };
}
