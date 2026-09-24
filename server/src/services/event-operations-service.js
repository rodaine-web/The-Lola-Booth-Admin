import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { query, transaction } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { cancelJobsForEntity, triggerAutomations } from "./automation-service.js";
import { createNotification } from "./notification-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(__dirname, "../../../public/brand/LOLA_Primary_Dark_Transparent.png");
const brand = { ivory: "#FAF7F1", gold: "#B89B6B", charcoal: "#1A1A1A", muted: "#6f665c" };

const transitionTimestamps = {
  EN_ROUTE: "en_route_at",
  ON_SITE: "arrived_at",
  SETTING_UP: "setup_started_at",
  READY: "setup_completed_at",
  LIVE: "event_started_at",
  BREAKDOWN: "event_ended_at",
  COMPLETED: "event_completed_at"
};

function isManager(user) {
  const roles = user?.roles || [];
  return roles.includes("OWNER") || roles.includes("ADMIN") || roles.includes("EVENT_MANAGER");
}

function isAttendant(user) {
  return user?.roles?.includes("ATTENDANT") && !isManager(user);
}

export async function userCanAccessEvent(user, eventId) {
  if (!isAttendant(user)) return true;
  const result = await query(
    `SELECT 1 FROM staff_assignments sa
     JOIN staff_profiles sp ON sp.id=sa.staff_profile_id
     WHERE sa.event_id=$1 AND sp.user_id=$2 AND sa.released_at IS NULL LIMIT 1`,
    [eventId, user.id]
  );
  return Boolean(result.rows[0]);
}

async function assertEventAccess(user, eventId) {
  if (!(await userCanAccessEvent(user, eventId))) throw new AppError("You do not have access to this event.", 403, "FORBIDDEN");
}

export async function getEventOperations(eventId, user = null) {
  await assertEventAccess(user, eventId);
  const event = await eventHeader(eventId);
  if (!event) throw notFound("Event");
  const [staff, equipment, contacts, checklists, creative, incidents, notes, galleries, activity] = await Promise.all([
    staffRows(eventId),
    equipmentRows(eventId),
    query("SELECT * FROM event_contacts WHERE event_id=$1 AND deleted_at IS NULL ORDER BY is_primary DESC, role, created_at", [eventId]),
    checklistRows(eventId),
    creativeRow(eventId),
    query("SELECT * FROM event_incidents WHERE event_id=$1 AND deleted_at IS NULL ORDER BY severity DESC, occurred_at DESC", [eventId]),
    query("SELECT * FROM event_notes WHERE event_id=$1 AND deleted_at IS NULL ORDER BY pinned DESC, created_at DESC", [eventId]),
    query("SELECT * FROM galleries WHERE event_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC", [eventId]),
    query("SELECT * FROM activities WHERE entity_type='event' AND entity_id=$1 ORDER BY created_at DESC LIMIT 40", [eventId])
  ]);
  const readiness = await readinessScore(event, { staff: staff.rows, equipment: equipment.rows, checklists: checklists.rows, creative: creative.rows[0], incidents: incidents.rows, contacts: contacts.rows });
  const payload = {
    event,
    readiness,
    timeline: operationalTimeline(event),
    staff: staff.rows,
    equipment: equipment.rows,
    contacts: contacts.rows,
    checklists: groupChecklistRows(checklists.rows),
    creative: creative.rows[0] || null,
    incidents: incidents.rows,
    notes: isAttendant(user) ? notes.rows.filter((note) => note.visible_to_attendant) : notes.rows,
    galleries: galleries.rows,
    activity: activity.rows,
    completion: completionSummary(event, readiness, equipment.rows, incidents.rows),
    metrics: operationalMetrics(event)
  };
  return isAttendant(user) ? redactForAttendant(payload) : payload;
}

async function eventHeader(eventId) {
  const result = await query(
    `SELECT e.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, c.company AS client_company,
      p.name AS package_name, x.name AS experience_name, b.payment_status, b.deposit_required, b.amount_paid, b.balance_due
     FROM events e
     LEFT JOIN clients c ON c.id=e.client_id
     LEFT JOIN packages p ON p.id=e.package_id
     LEFT JOIN experiences x ON x.id=e.experience_id
     LEFT JOIN bookings b ON b.event_id=e.id AND b.deleted_at IS NULL
     WHERE e.id=$1 AND e.deleted_at IS NULL`,
    [eventId]
  );
  return result.rows[0];
}

function staffRows(eventId) {
  return query(
    `SELECT sa.*, sp.name, sp.email, sp.phone, sp.user_id
     FROM staff_assignments sa
     JOIN staff_profiles sp ON sp.id=sa.staff_profile_id
     WHERE sa.event_id=$1 AND sa.released_at IS NULL
     ORDER BY sa.lead_attendant DESC, sa.call_time NULLS LAST, sa.created_at`,
    [eventId]
  );
}

function equipmentRows(eventId) {
  return query(
    `SELECT ea.*, eq.id AS equipment_record_id, eq.name, eq.category, eq.status AS master_status, eq.equipment_id, eq.asset_uid, eq.qr_token, eq.accessories
     FROM equipment_assignments ea
     JOIN equipment eq ON eq.id=ea.equipment_id
     WHERE ea.event_id=$1 AND ea.released_at IS NULL
     ORDER BY eq.category, eq.name`,
    [eventId]
  );
}

function checklistRows(eventId) {
  return query(
    `SELECT ec.id AS checklist_id, ec.name AS checklist_name, ci.*
     FROM event_checklists ec
     LEFT JOIN checklist_items ci ON ci.checklist_id=ec.id
     WHERE ec.event_id=$1
     ORDER BY ec.created_at, ci.display_order, ci.title, ci.id`,
    [eventId]
  );
}

function creativeRow(eventId) {
  return query("SELECT * FROM event_creative_requirements WHERE event_id=$1", [eventId]);
}

function groupChecklistRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.checklist_id)) groups.set(row.checklist_id, { id: row.checklist_id, name: row.checklist_name, items: [] });
    if (row.id) groups.get(row.checklist_id).items.push(row);
  }
  return [...groups.values()];
}

async function readinessScore(event, data) {
  const items = [];
  const add = (category, label, complete, { required = true, notRequired = false, severity = "WARNING" } = {}) => {
    if (notRequired) items.push({ category, label, status: "NOT_REQUIRED", required: false, severity: "INFO" });
    else items.push({ category, label, status: complete ? "COMPLETE" : "INCOMPLETE", required, severity: complete ? "INFO" : proximitySeverity(event.event_date, severity) });
  };
  add("BOOKING", "Booking confirmed", ["CONFIRMED", "PREPARING", "READY", "IN_PROGRESS", "COMPLETED"].includes(event.status) || Boolean(event.payment_status), { severity: "CRITICAL" });
  add("BOOKING", "Required deposit paid", ["PARTIAL", "PAID", "REFUNDED"].includes(event.payment_status), { severity: "CRITICAL" });
  add("CLIENT", "Primary contact confirmed", data.contacts.some((contact) => contact.role === "DAY_OF_CONTACT" || contact.is_primary) || Boolean(event.client_phone), { severity: "WARNING" });
  add("CLIENT", "Phone available", Boolean(event.client_phone || data.contacts.some((contact) => contact.phone)), { severity: "CRITICAL" });
  add("CLIENT", "Final guest estimate", Boolean(event.guest_count), { severity: "INFO" });
  add("VENUE", "Venue address", Boolean(event.venue_address), { severity: "CRITICAL" });
  add("VENUE", "Access instructions", Boolean(event.access_instructions || event.load_in_instructions || event.parking_loading_instructions), { severity: "WARNING" });
  add("VENUE", "Power requirements", Boolean(event.power_requirements), { severity: "WARNING" });
  add("STAFF", "Lead attendant assigned", data.staff.some((staff) => staff.lead_attendant || staff.assignment_role === "LEAD_ATTENDANT"), { severity: "CRITICAL" });
  add("STAFF", "Required staff assigned", data.staff.length >= 1, { severity: "CRITICAL" });
  add("STAFF", "Staff acknowledged", data.staff.length > 0 && data.staff.every((staff) => staff.acknowledgement_status === "ACKNOWLEDGED"), { severity: "WARNING" });
  add("EQUIPMENT", "Primary booth assigned", data.equipment.some((item) => /booth|360|vogue|audio/i.test(`${item.category} ${item.name}`)), { severity: "CRITICAL" });
  add("EQUIPMENT", "Printer assigned", data.equipment.some((item) => /printer/i.test(`${item.category} ${item.name}`)), { notRequired: /digital|audio/i.test(event.experience_name || ""), severity: "WARNING" });
  add("EQUIPMENT", "Equipment checked out", data.equipment.length > 0 && data.equipment.every((item) => ["CHECKED_OUT", "IN_TRANSIT", "ON_SITE", "RETURNED"].includes(item.lifecycle_status)), { severity: "CRITICAL" });
  add("CREATIVE", "Overlay/template approved", ["APPROVED", "READY"].includes(data.creative?.approval_status), { severity: "WARNING" });
  add("CREATIVE", "Backdrop confirmed", Boolean(data.creative?.backdrop_selection || event.backdrop), { severity: "WARNING" });
  add("FINANCE", "Balance status reviewed", Boolean(event.payment_status), { severity: "INFO" });
  add("OPERATIONS", "Setup time confirmed", Boolean(event.setup_time), { severity: "CRITICAL" });
  add("OPERATIONS", "Breakdown time confirmed", Boolean(event.breakdown_time), { severity: "WARNING" });
  add("OPERATIONS", "Internal instructions complete", Boolean(event.setup_instructions || event.internal_notes), { severity: "WARNING" });
  for (const item of data.checklists.filter((row) => row.required)) {
    add(item.category || "CHECKLIST", item.title || item.label, ["COMPLETED", "NOT_REQUIRED"].includes(item.status), { severity: item.timing_phase === "SETUP" ? "CRITICAL" : "WARNING" });
  }
  const required = items.filter((item) => item.required !== false);
  const complete = required.filter((item) => item.status === "COMPLETE").length;
  const incomplete = required.length - complete;
  return {
    status: incomplete === 0 ? "READY" : `${complete} OF ${required.length} COMPLETE`,
    complete,
    total: required.length,
    incomplete,
    score: required.length ? Math.round((complete / required.length) * 100) : 100,
    critical: items.filter((item) => item.status === "INCOMPLETE" && item.severity === "CRITICAL").length,
    items
  };
}

function proximitySeverity(eventDate, base) {
  const days = (new Date(`${eventDate instanceof Date ? eventDate.toISOString().slice(0,10) : String(eventDate).slice(0,10)}T12:00:00`).getTime() - Date.now()) / 86400000;
  if (days <= 1 && base !== "INFO") return "CRITICAL";
  if (days <= 14 && base === "INFO") return "WARNING";
  return base;
}

function operationalTimeline(event) {
  return [
    ["Call Time", event.call_time],
    ["Setup Start", event.setup_time],
    ["Setup Complete By", event.start_time],
    ["Event Start", event.start_time],
    ["Event End", event.end_time],
    ["Breakdown", event.breakdown_time],
    ["En Route", event.en_route_at],
    ["Arrived", event.arrived_at],
    ["Setup Started", event.setup_started_at],
    ["Setup Complete", event.setup_completed_at],
    ["Live", event.event_started_at],
    ["Event Ended", event.event_ended_at],
    ["Completed", event.event_completed_at]
  ].filter(([, value]) => value).map(([label, value]) => ({ label, value }));
}

function operationalMetrics(event) {
  const minutes = (start, end) => start && end ? Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000)) : null;
  return {
    scheduled_duration_minutes: timeDiff(event.start_time, event.end_time),
    setup_duration_minutes: minutes(event.setup_started_at, event.setup_completed_at),
    actual_event_duration_minutes: minutes(event.event_started_at, event.event_ended_at),
    breakdown_duration_minutes: minutes(event.event_ended_at, event.breakdown_completed_at)
  };
}

function timeDiff(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}

function completionSummary(event, readiness, equipment, incidents) {
  return {
    incomplete_checklist_count: readiness.incomplete,
    equipment_not_returned_count: equipment.filter((item) => item.lifecycle_status !== "RETURNED").length,
    open_incident_count: incidents.filter((incident) => !["RESOLVED", "CLOSED"].includes(incident.status)).length,
    completed_at: event.event_completed_at,
    override_reason: event.completion_override_reason
  };
}

function redactForAttendant(payload) {
  const { payment_status, deposit_required, amount_paid, balance_due, ...event } = payload.event;
  return {
    ...payload,
    event,
    staff: payload.staff.map(({ email, ...staff }) => staff),
    contacts: payload.contacts.map((contact) => ({ role: contact.role, name: contact.name, phone: contact.phone, email: contact.email, notes: contact.notes, is_primary: contact.is_primary }))
  };
}

export async function instantiateChecklist(eventId, templateId, user) {
  const result = await transaction(async (client) => {
    const event = (await client.query("SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL", [eventId])).rows[0];
    if (!event) throw notFound("Event");
    let template = templateId ? (await client.query("SELECT * FROM checklist_templates WHERE id=$1 AND deleted_at IS NULL", [templateId])).rows[0] : null;
    if (!template) {
      template = (await client.query("SELECT * FROM checklist_templates WHERE active=true AND deleted_at IS NULL ORDER BY CASE WHEN event_type=$1 THEN 0 WHEN event_type IS NULL THEN 1 ELSE 2 END, created_at LIMIT 1", [event.event_type])).rows[0];
    }
    if (!template) throw new AppError("No checklist template is available.", 404, "CHECKLIST_TEMPLATE_NOT_FOUND");
    const existing = await client.query("SELECT id FROM event_checklists WHERE event_id=$1 AND template_id=$2 LIMIT 1", [eventId, template.id]);
    if (existing.rows[0]) return existing.rows[0];
    const items = await client.query("SELECT * FROM checklist_template_items WHERE template_id=$1 ORDER BY display_order", [template.id]);
    const checklist = await client.query("INSERT INTO event_checklists (event_id, name, template_id, snapshot) VALUES ($1,$2,$3,$4) RETURNING *", [eventId, template.name, template.id, { template, items: items.rows }]);
    for (const item of items.rows) {
      await client.query(
        `INSERT INTO checklist_items (checklist_id, title, description, category, required, default_assignee_role, timing_phase, display_order, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING')`,
        [checklist.rows[0].id, item.label, item.description, item.category, item.required, item.default_assignee_role, item.timing_phase, item.display_order]
      );
    }
    return checklist.rows[0];
  });
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "checklist_instantiated", summary: `Checklist ${result.name} applied` });
  return getEventOperations(eventId, user);
}

export async function updateChecklistItem(eventId, itemId, body, user) {
  await assertEventAccess(user, eventId);
  const status = body.status;
  const allowed = ["PENDING", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED", "BLOCKED"];
  if (!allowed.includes(status)) throw new AppError("Unsupported checklist status.", 400, "INVALID_CHECKLIST_STATUS");
  const result = await query(
    `UPDATE checklist_items ci
     SET status=$1, notes=$2, blocked_reason=$3,
       completed_by=CASE WHEN $1='COMPLETED' THEN $4 ELSE completed_by END,
       completed_at=CASE WHEN $1='COMPLETED' THEN now() ELSE completed_at END
     FROM event_checklists ec
     WHERE ci.checklist_id=ec.id AND ec.event_id=$5 AND ci.id=$6
     RETURNING ci.*`,
    [status, body.notes || null, body.blocked_reason || null, user?.id || null, eventId, itemId]
  );
  if (!result.rows[0]) throw notFound("Checklist item");
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "checklist_item_updated", summary: `${result.rows[0].title} marked ${status}` });
  return result.rows[0];
}

export async function transitionOperationalStatus(eventId, status, user, body = {}) {
  await assertEventAccess(user, eventId);
  const allowed = ["PREPARING", "READY", "EN_ROUTE", "ON_SITE", "SETTING_UP", "LIVE", "BREAKDOWN", "COMPLETED", "ISSUE_REPORTED"];
  if (!allowed.includes(status)) throw new AppError("Unsupported operational status.", 400, "INVALID_OPERATIONAL_STATUS");
  const timestampColumn = transitionTimestamps[status];
  const assignments = timestampColumn ? `, ${timestampColumn}=COALESCE(${timestampColumn}, now())` : "";
  const updated = await query(
    `UPDATE events SET operational_status=$1, operational_status_changed_at=now(), completion_override_reason=COALESCE($2, completion_override_reason)${assignments}, updated_at=now()
     WHERE id=$3 AND deleted_at IS NULL RETURNING *`,
    [status, body.override_reason || null, eventId]
  );
  if (!updated.rows[0]) throw notFound("Event");
  if (status === "COMPLETED") await triggerAutomations({ triggerKey: "EVENT_COMPLETED", entityType: "event", entityId: eventId, payload: body });
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "operational_status_changed", summary: `Operational status changed to ${status}` });
  return updated.rows[0];
}

export async function acknowledgeAssignment(eventId, assignmentId, user, { status, reason }) {
  await assertEventAccess(user, eventId);
  const next = status === "DECLINED" ? "DECLINED" : "ACKNOWLEDGED";
  const result = await query(
    `UPDATE staff_assignments SET acknowledgement_status=$1,
      acknowledged_at=CASE WHEN $1='ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
      declined_at=CASE WHEN $1='DECLINED' THEN now() ELSE declined_at END,
      decline_reason=$2
     WHERE id=$3 AND event_id=$4 AND released_at IS NULL RETURNING *`,
    [next, reason || null, assignmentId, eventId]
  );
  if (!result.rows[0]) throw notFound("Staff assignment");
  if (next === "DECLINED") {
    await query("INSERT INTO tasks (title, description, due_date, event_id, status, priority) VALUES ('Staff declined assignment', $1, current_date, $2, 'OPEN', 'HIGH')", [reason || "No reason provided.", eventId]);
    await createNotification({ target: { roleTarget: "EVENT_MANAGER" }, category: "STAFF", severity: "HIGH", title: "Staff declined assignment", body: reason || "No reason provided.", entityType: "event", entityId: eventId, actionUrl: `/events/events/${eventId}` });
  }
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: next === "DECLINED" ? "staff_assignment_declined" : "staff_assignment_acknowledged", summary: `Staff assignment ${next.toLowerCase()}` });
  return result.rows[0];
}

export async function updateEquipmentLifecycle(eventId, assignmentId, action, body, user) {
  await assertEventAccess(user, eventId);
  const map = {
    checkout: { status: "CHECKED_OUT", at: "checked_out_at", by: "checked_out_by", condition: "condition_before", notes: "checkout_notes" },
    onsite: { status: "ON_SITE" },
    return: { status: needsMaintenance(body.condition_after) ? "MAINTENANCE" : "RETURNED", at: "returned_at", by: "returned_by", condition: "condition_after", notes: "return_notes" }
  };
  const config = map[action];
  if (!config) throw new AppError("Unsupported equipment action.", 400, "INVALID_EQUIPMENT_ACTION");
  const result = await query(
    `WITH typed_input AS (SELECT $1::text, $2::uuid, $3::text, $4::text, $5::text, $6::uuid, $7::uuid)
     UPDATE equipment_assignments SET lifecycle_status=$1,
      ${config.at ? `${config.at}=now(), ${config.by}=$2,` : ""}
      ${config.condition ? `${config.condition}=$3, ${config.notes}=$4, missing_accessories=$5,` : ""}
      released_at=released_at
     WHERE id=$6 AND event_id=$7 AND released_at IS NULL RETURNING *`,
    [config.status, user?.id || null, body.condition_before || body.condition_after || "GOOD", body.notes || null, body.missing_accessories || null, assignmentId, eventId]
  );
  if (!result.rows[0]) throw notFound("Equipment assignment");
  if (config.status === "MAINTENANCE") {
    await query("UPDATE equipment SET status='MAINTENANCE' WHERE id=$1", [result.rows[0].equipment_id]);
    await query("INSERT INTO tasks (title, description, due_date, event_id, status, priority) VALUES ('Equipment maintenance needed', $1, current_date + interval '1 day', $2, 'OPEN', 'HIGH')", [body.notes || body.missing_accessories || "Condition requires service.", eventId]);
    await createNotification({ target: { roleTarget: "MANAGERS" }, category: "EQUIPMENT", severity: "HIGH", title: "Equipment needs attention", body: body.notes || body.missing_accessories || "Condition requires service.", entityType: "event", entityId: eventId, actionUrl: `/events/events/${eventId}` });
  }
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: `equipment_${action}`, summary: `Equipment ${action}` });
  return result.rows[0];
}

function needsMaintenance(condition) {
  return ["DAMAGED", "MISSING_ACCESSORY", "NEEDS_ATTENTION"].includes(condition);
}

export async function createIncident(eventId, body, user) {
  await assertEventAccess(user, eventId);
  const result = await query(
    `INSERT INTO event_incidents (event_id, type, quick_issue, severity, description, immediate_action, reported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [eventId, body.type || "OTHER", body.quick_issue || null, body.severity || "LOW", body.description, body.immediate_action || null, user?.id || null]
  );
  if (["HIGH", "CRITICAL"].includes(result.rows[0].severity)) {
    await query("INSERT INTO tasks (title, description, due_date, event_id, status, priority) VALUES ('Review event incident', $1, current_date, $2, 'OPEN', $3)", [body.description, eventId, result.rows[0].severity === "CRITICAL" ? "URGENT" : "HIGH"]);
    await transitionOperationalStatus(eventId, "ISSUE_REPORTED", user, {});
    await createNotification({ target: { roleTarget: "MANAGERS" }, category: "INCIDENTS", severity: result.rows[0].severity, title: `${result.rows[0].severity} incident reported`, body: body.description, entityType: "event", entityId: eventId, actionUrl: `/events/events/${eventId}` });
  }
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "incident_created", summary: `${result.rows[0].severity} ${result.rows[0].type} incident reported` });
  return result.rows[0];
}

export async function updateIncident(eventId, incidentId, body, user) {
  await assertEventAccess(user, eventId);
  const result = await query(
    `UPDATE event_incidents SET status=COALESCE($1,status), resolution_notes=COALESCE($2,resolution_notes),
      resolved_at=CASE WHEN $1 IN ('RESOLVED','CLOSED') THEN now() ELSE resolved_at END, updated_at=now()
     WHERE id=$3 AND event_id=$4 AND deleted_at IS NULL RETURNING *`,
    [body.status || null, body.resolution_notes || null, incidentId, eventId]
  );
  if (!result.rows[0]) throw notFound("Incident");
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "incident_updated", summary: `Incident marked ${result.rows[0].status}` });
  return result.rows[0];
}

export async function upsertCreative(eventId, body, user) {
  await assertEventAccess(user, eventId);
  const result = await query(
    `INSERT INTO event_creative_requirements (event_id, overlay_template, print_design, welcome_screen, hashtag, backdrop_selection, brand_colors, special_design_instructions, approval_status, client_approval_note, client_approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $9 IN ('APPROVED','READY') THEN now() ELSE NULL END)
     ON CONFLICT (event_id) DO UPDATE SET overlay_template=EXCLUDED.overlay_template, print_design=EXCLUDED.print_design, welcome_screen=EXCLUDED.welcome_screen,
       hashtag=EXCLUDED.hashtag, backdrop_selection=EXCLUDED.backdrop_selection, brand_colors=EXCLUDED.brand_colors,
       special_design_instructions=EXCLUDED.special_design_instructions, approval_status=EXCLUDED.approval_status,
       client_approval_note=EXCLUDED.client_approval_note,
       client_approved_at=CASE WHEN EXCLUDED.approval_status IN ('APPROVED','READY') THEN COALESCE(event_creative_requirements.client_approved_at, now()) ELSE event_creative_requirements.client_approved_at END,
       updated_at=now()
     RETURNING *`,
    [eventId, body.overlay_template || null, body.print_design || null, body.welcome_screen || null, body.hashtag || null, body.backdrop_selection || null, body.brand_colors || null, body.special_design_instructions || null, body.approval_status || "NOT_STARTED", body.client_approval_note || null]
  );
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "creative_updated", summary: `Creative status ${result.rows[0].approval_status}` });
  return result.rows[0];
}

export async function addEventNote(eventId, body, user) {
  await assertEventAccess(user, eventId);
  const result = await query(
    `INSERT INTO event_notes (event_id, category, body, pinned, visible_to_attendant, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [eventId, body.category || "GENERAL", body.body, Boolean(body.pinned), body.visible_to_attendant !== false, user?.id || null]
  );
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "event_note_added", summary: `${result.rows[0].category} note added` });
  return result.rows[0];
}

export async function upsertEventContact(eventId, body, user) {
  await assertEventAccess(user, eventId);
  const result = await query(
    `INSERT INTO event_contacts (event_id, role, name, phone, email, notes, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [eventId, body.role || "DAY_OF_CONTACT", body.name, body.phone || null, body.email || null, body.notes || null, Boolean(body.is_primary)]
  );
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "event_contact_added", summary: `${result.rows[0].role} contact added` });
  return result.rows[0];
}

export async function completeEvent(eventId, body, user) {
  const operations = await getEventOperations(eventId, user);
  const problems = {
    incompleteChecklist: operations.completion.incomplete_checklist_count,
    equipmentNotReturned: operations.completion.equipment_not_returned_count,
    openIncidents: operations.completion.open_incident_count
  };
  const hasProblems = Object.values(problems).some((count) => count > 0);
  if (hasProblems && !body.override_reason) throw new AppError("Completion requires an override reason while operational items remain open.", 409, "COMPLETION_OVERRIDE_REQUIRED", { problems });
  const updated = await transitionOperationalStatus(eventId, "COMPLETED", user, { override_reason: body.override_reason || null });
  await query("UPDATE events SET status=CASE WHEN status <> 'CANCELLED' THEN 'COMPLETED' ELSE status END, completion_notes=$1 WHERE id=$2", [body.completion_notes || null, eventId]);
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "event_completed", summary: "Event completed operationally" });
  return { event: updated, problems };
}

export async function updateGallery(eventId, body, user) {
  await assertEventAccess(user, eventId);
  const result = await query(
    `UPDATE events SET gallery_status=$1, gallery_url=COALESCE($2,gallery_url), gallery_ready_at=CASE WHEN $1='READY' THEN now() ELSE gallery_ready_at END, updated_at=now()
     WHERE id=$3 AND deleted_at IS NULL RETURNING *`,
    [body.status || body.gallery_status, body.gallery_url || null, eventId]
  );
  if (!result.rows[0]) throw notFound("Event");
  if ((body.status || body.gallery_status) === "READY") {
    await triggerAutomations({ triggerKey: "GALLERY_READY", entityType: "event", entityId: eventId, payload: { gallery_url: body.gallery_url } });
    await createNotification({ target: { roleTarget: "MANAGERS" }, category: "EVENTS", severity: "INFO", title: "Gallery ready", body: "Gallery is ready to send to the client.", entityType: "event", entityId: eventId, actionUrl: `/events/events/${eventId}` });
  }
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "gallery_status_changed", summary: `Gallery marked ${body.status || body.gallery_status}` });
  return result.rows[0];
}

export async function rescheduleEvent(eventId, body, user) {
  if (!isManager(user)) throw new AppError("Only managers can reschedule events.", 403, "FORBIDDEN");
  const before = await eventHeader(eventId);
  if (!before) throw notFound("Event");
  const warnings = await rescheduleWarnings(eventId, body);
  if (!body.confirm) return { current: before, proposed: body, warnings };
  if (warnings.staff_conflicts + warnings.equipment_conflicts > 0 && !body.override_reason) throw new AppError("Reschedule conflicts require an override reason.", 409, "RESCHEDULE_OVERRIDE_REQUIRED", { warnings });
  const updated = await query(
    `UPDATE events SET event_date=$1, start_time=$2, end_time=$3, setup_time=$4, breakdown_time=$5, updated_at=now()
     WHERE id=$6 RETURNING *`,
    [body.event_date, body.start_time, body.end_time, body.setup_time || null, body.breakdown_time || null, eventId]
  );
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "event_rescheduled", summary: `Event rescheduled to ${body.event_date}` });
  await createNotification({ target: { eventTeamEventId: eventId }, category: "EVENTS", severity: "HIGH", title: "Assigned event rescheduled", body: `${before.event_name} moved to ${body.event_date}. Please review your call time.`, entityType: "event", entityId: eventId, actionUrl: `/my-events/${eventId}` });
  await query("UPDATE staff_assignments SET acknowledgement_status='ASSIGNED', acknowledged_at=NULL WHERE event_id=$1 AND released_at IS NULL", [eventId]);
  return { before, event: updated.rows[0], warnings };
}

async function rescheduleWarnings(eventId, body) {
  const staff = await query(
    `SELECT count(*)::int AS count FROM staff_assignments sa
     JOIN staff_assignments other ON other.staff_profile_id=sa.staff_profile_id AND other.event_id<>sa.event_id AND other.released_at IS NULL
     JOIN events e ON e.id=other.event_id
     WHERE sa.event_id=$1 AND sa.released_at IS NULL AND e.deleted_at IS NULL AND e.event_date=$2::date
       AND tstzrange(($2::date + $3::time), ($2::date + $4::time), '[)') && tstzrange((e.event_date + e.start_time), (e.event_date + e.end_time), '[)')`,
    [eventId, body.event_date, body.start_time, body.end_time]
  );
  const equipment = await query(
    `SELECT count(*)::int AS count FROM equipment_assignments ea
     JOIN equipment_assignments other ON other.equipment_id=ea.equipment_id AND other.event_id<>ea.event_id AND other.released_at IS NULL
     JOIN events e ON e.id=other.event_id
     WHERE ea.event_id=$1 AND ea.released_at IS NULL AND e.deleted_at IS NULL AND e.event_date=$2::date
       AND tstzrange(($2::date + $3::time), ($2::date + $4::time), '[)') && tstzrange((e.event_date + e.start_time), (e.event_date + e.end_time), '[)')`,
    [eventId, body.event_date, body.start_time, body.end_time]
  );
  return { staff_conflicts: staff.rows[0].count, equipment_conflicts: equipment.rows[0].count };
}

export async function cancelEventOperations(eventId, user) {
  if (!isManager(user)) throw new AppError("Only managers can cancel event operations.", 403, "FORBIDDEN");
  const updated = await query("UPDATE events SET status='CANCELLED', operational_status='COMPLETED', updated_at=now() WHERE id=$1 RETURNING *", [eventId]);
  await cancelJobsForEntity({ entityType: "event", entityId: eventId, reason: "Event cancelled" });
  await query("UPDATE staff_assignments SET acknowledgement_status='DECLINED', decline_reason='Event cancelled' WHERE event_id=$1 AND acknowledgement_status='ASSIGNED'", [eventId]);
  await createNotification({ target: { eventTeamEventId: eventId }, category: "EVENTS", severity: "HIGH", title: "Assigned event cancelled", body: "This assigned event was cancelled.", entityType: "event", entityId: eventId, actionUrl: `/my-events/${eventId}` });
  await recordActivity({ actorUserId: user?.id, entityType: "event", entityId: eventId, action: "event_operations_cancelled", summary: "Future operational jobs cancelled" });
  return updated.rows[0];
}

export async function attendantHome(user) {
  const events = await query(
    `SELECT e.id, e.event_name, e.event_type, e.event_date, e.start_time, e.setup_time, e.venue_name, e.city, e.operational_status, x.name AS experience_name,
      sa.call_time, sa.acknowledgement_status,
      COALESCE(eq.equipment_summary,'No equipment assigned') AS equipment_summary
     FROM staff_assignments sa
     JOIN staff_profiles sp ON sp.id=sa.staff_profile_id
     JOIN events e ON e.id=sa.event_id
     LEFT JOIN experiences x ON x.id=e.experience_id
     LEFT JOIN (SELECT ea.event_id, string_agg(eq.name, ', ' ORDER BY eq.name) AS equipment_summary FROM equipment_assignments ea JOIN equipment eq ON eq.id=ea.equipment_id WHERE ea.released_at IS NULL GROUP BY ea.event_id) eq ON eq.event_id=e.id
     WHERE sp.user_id=$1 AND sa.released_at IS NULL AND e.deleted_at IS NULL AND e.event_date >= current_date - interval '1 day'
     ORDER BY e.event_date, COALESCE(sa.call_time, e.setup_time, e.start_time) LIMIT 20`,
    [user.id]
  );
  const tasks = await query("SELECT * FROM tasks WHERE assigned_user_id=$1 AND status <> 'DONE' AND deleted_at IS NULL ORDER BY due_date NULLS LAST LIMIT 10", [user.id]);
  return {
    nextEvent: events.rows[0] || null,
    todaysEvents: events.rows.filter((event) => String(event.event_date).slice(0, 10) === new Date().toISOString().slice(0, 10)),
    thisWeek: events.rows,
    tasks: tasks.rows,
    needsAttention: events.rows.filter((event) => event.acknowledgement_status !== "ACKNOWLEDGED")
  };
}

export async function listChecklistTemplates() {
  const [templates, items] = await Promise.all([
    query("SELECT ct.*, x.name AS experience_name, p.name AS package_name FROM checklist_templates ct LEFT JOIN experiences x ON x.id=ct.experience_id LEFT JOIN packages p ON p.id=ct.package_id WHERE ct.deleted_at IS NULL ORDER BY ct.active DESC, ct.name"),
    query("SELECT * FROM checklist_template_items ORDER BY display_order")
  ]);
  return { data: templates.rows.map((template) => ({ ...template, items: items.rows.filter((item) => item.template_id === template.id) })) };
}

export async function operationsAnalytics() {
  const [summary, incidents, equipment] = await Promise.all([
    query(
      `SELECT
        count(*) FILTER (WHERE status='COMPLETED')::int AS events_completed,
        COALESCE(avg(extract(epoch from (setup_completed_at - setup_started_at))/60),0)::numeric AS average_setup_duration,
        COALESCE(avg(extract(epoch from (breakdown_completed_at - event_ended_at))/60),0)::numeric AS average_breakdown_duration,
        count(*) FILTER (WHERE setup_completed_at IS NOT NULL AND start_time IS NOT NULL AND setup_completed_at::time > start_time)::int AS late_setup_count
       FROM events WHERE deleted_at IS NULL`
    ),
    query("SELECT type, severity, count(*)::int AS count FROM event_incidents WHERE deleted_at IS NULL GROUP BY type, severity ORDER BY count DESC"),
    query(
      `SELECT eq.name, count(ea.id)::int AS uses, count(*) FILTER (WHERE ea.lifecycle_status IN ('ISSUE','MAINTENANCE') OR ea.condition_after IN ('DAMAGED','MISSING_ACCESSORY','NEEDS_ATTENTION'))::int AS issue_count
       FROM equipment eq
       LEFT JOIN equipment_assignments ea ON ea.equipment_id=eq.id
       WHERE eq.deleted_at IS NULL
       GROUP BY eq.name ORDER BY uses DESC, issue_count DESC LIMIT 10`
    )
  ]);
  return {
    operationsSummary: {
      ...summary.rows[0],
      average_setup_duration: Number(summary.rows[0]?.average_setup_duration || 0),
      average_breakdown_duration: Number(summary.rows[0]?.average_breakdown_duration || 0)
    },
    incidentsByType: incidents.rows,
    equipmentUsage: equipment.rows
  };
}

export async function createChecklistTemplate(body) {
  const result = await transaction(async (client) => {
    const template = await client.query(
      "INSERT INTO checklist_templates (name, experience_id, package_id, event_type, active) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [body.name, body.experience_id || null, body.package_id || null, body.event_type || null, body.active !== false]
    );
    for (const [index, item] of (body.items || []).entries()) {
      await client.query(
        `INSERT INTO checklist_template_items (template_id, label, description, category, required, default_assignee_role, timing_phase, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [template.rows[0].id, item.label, item.description || null, item.category || "OPERATIONS", item.required !== false, item.default_assignee_role || null, item.timing_phase || "BEFORE_EVENT", item.display_order ?? index]
      );
    }
    return template.rows[0];
  });
  return result;
}

export async function generateRunSheetPdf(eventId, user) {
  const ops = await getEventOperations(eventId, user);
  const chunks = [];
  const doc = new PDFDocument({ size: "LETTER", margin: 48 });
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  if (fs.existsSync(logoPath)) doc.image(logoPath, 48, 42, { width: 112 });
  doc.fillColor(brand.gold).font("Helvetica").fontSize(10).text("EVENT RUN SHEET", 400, 58, { align: "right" });
  doc.fillColor(brand.charcoal).font("Times-Roman").fontSize(28).text(ops.event.event_name, 48, 150, { width: 500 });
  doc.font("Helvetica").fontSize(11).fillColor(brand.muted).text(`${ops.event.event_date} · ${ops.event.start_time || ""}-${ops.event.end_time || ""}\n${ops.event.venue_name || ""}\n${[ops.event.venue_address, ops.event.city, ops.event.state].filter(Boolean).join(", ")}`, 48, 190);
  addRunSection(doc, "Timeline", ops.timeline.map((item) => `${item.label}: ${item.value}`));
  addRunSection(doc, "Contacts", ops.contacts.map((item) => `${item.role}: ${item.name} ${item.phone || ""} ${item.email || ""}`));
  addRunSection(doc, "Staff", ops.staff.map((item) => `${item.name} - ${item.assignment_role} - ${item.acknowledgement_status}`));
  addRunSection(doc, "Equipment", ops.equipment.map((item) => `${item.name} - ${item.lifecycle_status} - ${item.asset_uid || item.equipment_id || ""}`));
  addRunSection(doc, "Setup / Creative Notes", [ops.event.setup_instructions, ops.creative?.special_design_instructions, ...ops.notes.filter((note) => note.pinned).map((note) => note.body)].filter(Boolean));
  addRunSection(doc, "Checklist Summary", [`${ops.readiness.complete} of ${ops.readiness.total} required items complete`, `${ops.readiness.critical} critical item(s)`]);
  doc.fillColor(brand.gold).font("Helvetica-Bold").fontSize(10).text(`Generated ${new Date().toLocaleString()} · Good people. Better photos.`, 48, doc.page.height - 70);
  doc.end();
  return done;
}

function addRunSection(doc, title, rows) {
  if (doc.y > 650) doc.addPage();
  doc.moveDown().fillColor(brand.charcoal).font("Times-Roman").fontSize(17).text(title);
  doc.moveDown(0.35).font("Helvetica").fontSize(10).fillColor(brand.charcoal);
  if (!rows.length) doc.text("None recorded.");
  for (const row of rows) doc.text(`- ${row || ""}`, { width: 500 });
}
