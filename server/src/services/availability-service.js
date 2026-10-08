import {z} from 'zod';
import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const inputSchema=z.object({eventDate:z.string().date(),startTime:time,endTime:time,setupTime:time.nullable().optional(),breakdownTime:time.nullable().optional(),experienceId:z.string().uuid().nullable().optional(),eventId:z.string().uuid().nullable().optional(),equipmentIds:z.array(z.string().uuid()).max(40).optional()});
const requestedWindow=`WITH settings AS (SELECT COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago') AS zone,
 COALESCE((SELECT default_equipment_turnaround_buffer_minutes FROM business_settings LIMIT 1),30) AS buffer),
 requested AS (SELECT tstzrange((($1::date+$3::time) AT TIME ZONE zone)-make_interval(mins=>buffer),
 (($1::date+$4::time+CASE WHEN $4::time<=$3::time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE zone)+make_interval(mins=>buffer),'[)') AS window FROM settings)`;
export async function checkAvailability(raw){
 const parsed=inputSchema.safeParse(raw);
 if(!parsed.success)throw new AppError('Choose a valid event date and start/end times.',422,'AVAILABILITY_WINDOW_INVALID');
 const {eventDate,startTime,endTime,setupTime,breakdownTime,experienceId,eventId=null,equipmentIds=[]}=parsed.data;
 const windowStart=setupTime||startTime,windowEnd=breakdownTime||endTime;
 const params=[eventDate,eventId,windowStart,windowEnd];
 const eventConflicts=await query(`${requestedWindow} SELECT e.id,e.event_name,e.venue_name,e.start_time,e.end_time,e.setup_time,e.breakdown_time
  FROM events e CROSS JOIN requested r WHERE e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED')
   AND ($2::uuid IS NULL OR e.id<>$2) AND event_unavailable_range(e.id)&&r.window`,params);
 const equipmentConflicts=await query(`${requestedWindow}, reservations AS (
  SELECT a.event_id,a.equipment_id FROM equipment_assignments a WHERE a.released_at IS NULL
  UNION SELECT h.event_id,r.equipment_id FROM booking_holds h JOIN booking_hold_resources r ON r.hold_id=h.id
   WHERE h.status='ACTIVE' AND h.expires_at>clock_timestamp() AND r.equipment_id IS NOT NULL)
  SELECT DISTINCT eq.id,eq.name,e.event_name FROM reservations a JOIN equipment eq ON eq.id=a.equipment_id JOIN events e ON e.id=a.event_id CROSS JOIN requested r
   WHERE e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') AND ($2::uuid IS NULL OR e.id<>$2)
    AND event_unavailable_range(e.id)&&r.window`,params);
 const conflicts=[];
 if(eventConflicts.rows.length)conflicts.push({type:'EVENT_OVERLAP',severity:'warning',message:'Another event overlaps this setup-to-breakdown window.',records:eventConflicts.rows});
 if(equipmentConflicts.rows.length)conflicts.push({type:'EQUIPMENT_CONFLICT',severity:equipmentIds.some(id=>equipmentConflicts.rows.some(row=>row.id===id))?'critical':'warning',message:'These units have overlapping assignments or temporary holds.',records:equipmentConflicts.rows});
 if(equipmentIds.length){
  const usable=(await query("SELECT id FROM equipment WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL AND status NOT IN ('MAINTENANCE','RETIRED')",[equipmentIds])).rows;
  const unavailable=equipmentIds.filter(id=>!usable.some(row=>row.id===id));
  if(unavailable.length)conflicts.push({type:'EQUIPMENT_UNAVAILABLE',severity:'critical',message:'Selected equipment is unavailable or in maintenance.',records:unavailable.map(id=>({id}))});
 }
 const staffing=experienceId?await query('SELECT staff_required FROM experiences WHERE id=$1 AND deleted_at IS NULL',[experienceId]):{rows:[]};
 return {available:equipmentIds.length?!conflicts.some(row=>row.severity==='critical'):null,
  qualification:equipmentIds.length?'SELECTED_EQUIPMENT_ONLY':'RESOURCE_SELECTION_REQUIRED',requiredStaff:Number(staffing.rows[0]?.staff_required||1),
  window:{eventDate,unavailableFrom:windowStart,unavailableUntil:windowEnd},conflicts};
}
