import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { query, transaction } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { sendEmail } from "./email-service.js";
import { triggerAutomations } from "./automation-service.js";
import { createNotification, recordOfflineReceipt } from "./notification-service.js";
import { getEventOperations, userCanAccessEvent, updateChecklistItem, transitionOperationalStatus, updateEquipmentLifecycle, addEventNote, createIncident, acknowledgeAssignment } from "./event-operations-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(__dirname, "../../../public/brand/LOLA_Primary_Dark_Transparent.png");
const monogramPath = path.resolve(__dirname, "../../../public/brand/LOLA_LB_Monogram_Black.png");
const publicBaseUrl = process.env.PUBLIC_APP_URL || "http://localhost:5174";

const offlineActionTypes = {
  CHECKLIST_UPDATE: ({ eventId, itemId, payload, user }) => updateChecklistItem(eventId, itemId, payload, user),
  STATUS_CHANGE: ({ eventId, payload, user }) => transitionOperationalStatus(eventId, payload.status, user, payload),
  EQUIPMENT_LIFECYCLE: ({ eventId, assignmentId, action, payload, user }) => updateEquipmentLifecycle(eventId, assignmentId, action, payload, user),
  EVENT_NOTE: ({ eventId, payload, user }) => addEventNote(eventId, payload, user),
  INCIDENT: ({ eventId, payload, user }) => createIncident(eventId, payload, user),
  ASSIGNMENT_ACK: ({ eventId, assignmentId, payload, user }) => acknowledgeAssignment(eventId, assignmentId, user, payload)
};

export async function replayOfflineAction(user, body) {
  const { idempotencyKey, actionType, endpoint, eventId, assignmentId, itemId, action, payload = {} } = body;
  if (!idempotencyKey) throw new AppError("Offline action requires an idempotency key.", 400, "IDEMPOTENCY_REQUIRED");
  if (!offlineActionTypes[actionType]) throw new AppError("This action cannot be replayed offline.", 400, "OFFLINE_ACTION_NOT_ALLOWED");
  const existing = await recordOfflineReceipt({ user, idempotencyKey, actionType, endpoint, entityType: "event", entityId: eventId, requestPayload: body, status: "SYNCED" });
  if (existing.replay) return { replay: true, receipt: existing.receipt, result: existing.receipt.response_payload };
  try {
    const result = await offlineActionTypes[actionType]({ eventId, assignmentId, itemId, action, payload, user });
    await query("UPDATE offline_action_receipts SET response_payload=$1, status='SYNCED' WHERE id=$2", [result, existing.receipt.id]);
    return { replay: false, receipt: existing.receipt, result };
  } catch (err) {
    const status = err.statusCode === 409 ? "CONFLICT" : "FAILED";
    await query("UPDATE offline_action_receipts SET status=$1, response_payload=$2 WHERE id=$3", [status, { error: err.message, code: err.code }, existing.receipt.id]);
    if (status === "CONFLICT") {
      await createNotification({
        userId: user.id,
        category: "SYSTEM",
        severity: "WARNING",
        title: "Offline sync conflict",
        body: err.message,
        entityType: "event",
        entityId: eventId,
        actionUrl: `/my-events/${eventId}`
      });
    }
    throw err;
  }
}

export async function equipmentScanLookup(tokenOrUid, user, eventId = null) {
  const result = await query(
    `SELECT eq.*, ea.id AS assignment_id, ea.event_id, ea.lifecycle_status, ea.condition_before, ea.condition_after,
      e.event_name, e.event_date, e.operational_status
     FROM equipment eq
     LEFT JOIN equipment_assignments ea ON ea.equipment_id=eq.id AND ea.released_at IS NULL
     LEFT JOIN events e ON e.id=ea.event_id AND e.deleted_at IS NULL
     WHERE eq.deleted_at IS NULL AND (eq.qr_token=$1 OR eq.asset_uid=$1 OR eq.equipment_id=$1)
     ORDER BY e.event_date NULLS LAST LIMIT 1`,
    [tokenOrUid]
  );
  const equipment = result.rows[0];
  if (!equipment) throw notFound("Equipment");
  if (eventId && equipment.event_id && equipment.event_id !== eventId && !isManager(user)) {
    throw new AppError("This equipment is not assigned to this event.", 409, "WRONG_EVENT_EQUIPMENT");
  }
  if (eventId && !(await userCanAccessEvent(user, eventId))) throw new AppError("You do not have access to this event.", 403, "FORBIDDEN");
  return {
    equipment,
    warning: eventId && equipment.event_id !== eventId ? "This equipment is not assigned to this event." : null,
    permittedActions: permittedScanActions(user, equipment, eventId)
  };
}

function isManager(user) {
  return user?.permissions?.includes("*") || user?.roles?.some((role) => ["OWNER", "ADMIN", "EVENT_MANAGER"].includes(role));
}

function permittedScanActions(user, equipment, eventId) {
  const canAct = Boolean(eventId && equipment.assignment_id && (user?.permissions?.includes("*") || user?.permissions?.includes("equipment.checkout") || user?.permissions?.includes("equipment.return") || user?.permissions?.includes("read:attendant")));
  return canAct ? ["checkout", "onsite", "return"] : [];
}

export async function generateEquipmentLabelsPdf({ equipmentIds = [], baseUrl = publicBaseUrl } = {}) {
  const params = [];
  const where = ["deleted_at IS NULL"];
  if (equipmentIds.length) {
    params.push(equipmentIds);
    where.push(`id=ANY($${params.length}::uuid[])`);
  }
  const rows = await query(`SELECT * FROM equipment WHERE ${where.join(" AND ")} ORDER BY category, name LIMIT 200`, params);
  const doc = new PDFDocument({ size: "LETTER", margin: 36 });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  for (const [index, item] of rows.rows.entries()) {
    await drawLabel(doc, item, index, baseUrl);
  }
  doc.end();
  return done;
}

async function drawLabel(doc, item, index, baseUrl) {
  const col = index % 2;
  const row = Math.floor(index / 2) % 5;
  if (index > 0 && index % 10 === 0) doc.addPage();
  const x = 36 + col * 270;
  const y = 36 + row * 144;
  const url = `${baseUrl}/scan/equipment/${item.qr_token}`;
  const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 180 });
  const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");
  doc.rect(x, y, 252, 124).stroke("#E8DDD0");
  if (fs.existsSync(monogramPath)) doc.image(monogramPath, x + 14, y + 14, { width: 34 });
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#1A1A1A").text(item.name, x + 56, y + 14, { width: 118 });
  doc.font("Helvetica").fontSize(8).fillColor("#6f665c").text(`${item.asset_uid || item.equipment_id}\n${item.category}`, x + 56, y + 34, { width: 118 });
  doc.image(qrBuffer, x + 184, y + 16, { width: 70 });
  doc.font("Helvetica").fontSize(6).fillColor("#6f665c").text(url, x + 14, y + 96, { width: 224, ellipsis: true });
}

export async function sendStaffBrief(eventId, body, user) {
  const ops = await getEventOperations(eventId, user);
  const selected = body.assignment_ids?.length ? ops.staff.filter((staff) => body.assignment_ids.includes(staff.id)) : ops.staff;
  const sent = [];
  for (const staff of selected.filter((item) => item.email)) {
    const email = await sendEmail({
      to: staff.email,
      subject: `Your LOLA Event Brief - ${ops.event.event_name}`,
      body: staffBriefBody(ops, staff)
    }).catch((err) => ({ status: "FAILED", error: err.message }));
    const row = await query(
      `INSERT INTO staff_brief_deliveries (event_id, staff_assignment_id, staff_profile_id, recipient_email, status, provider, provider_message_id, sent_at, failed_at, error, brief_snapshot, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='SENT' THEN now() ELSE NULL END,CASE WHEN $5='FAILED' THEN now() ELSE NULL END,$8,$9,$10) RETURNING *`,
      [eventId, staff.id, staff.staff_profile_id, staff.email, email.status === "FAILED" ? "FAILED" : "SENT", email.provider || null, email.providerMessageId || null, email.error || null, { event: ops.event, staff, equipment: ops.equipment }, user.id]
    );
    await createNotification({ userId: staff.user_id, category: "STAFF", severity: "INFO", title: "Your LOLA event brief is ready", body: ops.event.event_name, entityType: "event", entityId: eventId, actionUrl: `/my-events/${eventId}` });
    sent.push(row.rows[0]);
  }
  await recordActivity({ actorUserId: user.id, entityType: "event", entityId: eventId, action: "staff_brief_sent", summary: `Staff brief sent to ${sent.length} recipient(s)` });
  return { sent };
}

function staffBriefBody(ops, staff) {
  const contact = ops.contacts.find((item) => item.role === "DAY_OF_CONTACT" || item.is_primary) || {};
  return [
    `Hi ${staff.name?.split(" ")[0] || "there"},`,
    "",
    `Your LOLA event brief is ready for ${ops.event.event_name}.`,
    "",
    `Date: ${ops.event.event_date}`,
    `Call Time: ${staff.call_time || ops.event.setup_time || "TBD"}`,
    `Role: ${staff.assignment_role}`,
    `Venue: ${ops.event.venue_name || "TBD"}`,
    `Address: ${[ops.event.venue_address, ops.event.city, ops.event.state].filter(Boolean).join(", ") || "TBD"}`,
    `Day-of Contact: ${contact.name || "TBD"} ${contact.phone || ""}`,
    `Experience: ${ops.event.experience_name || "TBD"}`,
    `Equipment: ${ops.equipment.map((item) => item.name).join(", ") || "TBD"}`,
    "",
    `Setup Instructions: ${ops.event.setup_instructions || ops.event.internal_notes || "None recorded."}`,
    "",
    `Open Event: ${publicBaseUrl}/my-events/${ops.event.id}`,
    "",
    "Good people. Better photos.",
    "LOLA Booths"
  ].join("\n");
}

export async function createOrSendGalleryDelivery(eventId, body, user) {
  const event = (await query("SELECT e.*, c.email AS client_email, c.name AS client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id WHERE e.id=$1 AND e.deleted_at IS NULL", [eventId])).rows[0];
  if (!event) throw notFound("Event");
  const settings = (await query("SELECT delivery_default_expiration_days, google_review_url, facebook_review_url, other_review_url FROM business_settings LIMIT 1")).rows[0] || {};
  const expiresAt = body.expires_at || (settings.delivery_default_expiration_days ? new Date(Date.now() + Number(settings.delivery_default_expiration_days) * 86400000).toISOString() : null);
  const delivery = await transaction(async (client) => {
    const existing = (await client.query("SELECT * FROM gallery_deliveries WHERE event_id=$1 AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1", [eventId])).rows[0];
    const row = existing || (await client.query(
      `INSERT INTO gallery_deliveries (event_id, client_id, gallery_id, thank_you_message, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [eventId, event.client_id, body.gallery_id || null, body.thank_you_message || "Thank you for having LOLA be part of your event.", expiresAt, user.id]
    )).rows[0];
    if (body.gallery_url) {
      const item = await client.query("SELECT id FROM gallery_delivery_items WHERE delivery_id=$1 AND url=$2 LIMIT 1", [row.id, body.gallery_url]);
      if (!item.rows[0]) {
        await client.query(
          `INSERT INTO gallery_delivery_items (delivery_id, item_type, label, url, display_order)
           VALUES ($1,'EXTERNAL_GALLERY_LINK','View Gallery',$2,0)`,
          [row.id, body.gallery_url]
        );
      }
    }
    return row;
  });
  const deliveryUrl = `${publicBaseUrl}/delivery/${delivery.token}`;
  if (body.send !== false && event.client_email) {
    await sendEmail({
      to: event.client_email,
      subject: "Your LOLA photos are ready",
      body: `Hi ${event.client_name?.split(" ")[0] || "there"},\n\nYour photos from ${event.event_name} are ready.\n\nView your photos: ${deliveryUrl}\n\nThanks for having LOLA be part of your event.\n\nGood people. Better photos.\n\nLOLA Booths`
    });
    await query("UPDATE gallery_deliveries SET delivered_at=COALESCE(delivered_at, now()), updated_at=now() WHERE id=$1", [delivery.id]);
    await query("UPDATE events SET gallery_status='DELIVERED', updated_at=now() WHERE id=$1", [eventId]);
    await triggerAutomations({ triggerKey: "GALLERY_DELIVERED", entityType: "event", entityId: eventId, payload: { delivery_url: deliveryUrl } });
  }
  await createNotification({ target: { roleTarget: "MANAGERS" }, category: "EVENTS", severity: "INFO", title: "Gallery delivery ready", body: event.event_name, entityType: "event", entityId: eventId, actionUrl: `/events/events/${eventId}` });
  await recordActivity({ actorUserId: user.id, entityType: "event", entityId: eventId, action: "gallery_delivery_created", summary: "Gallery delivery link prepared" });
  return { delivery: { ...delivery, delivery_url: deliveryUrl } };
}

export async function publicDelivery(token) {
  const result = await query(
    `SELECT gd.*, e.event_name, e.event_date, e.gallery_status, c.name AS client_name,
      bs.business_email, bs.phone, bs.google_review_url, bs.facebook_review_url, bs.other_review_url
     FROM gallery_deliveries gd
     JOIN events e ON e.id=gd.event_id
     LEFT JOIN clients c ON c.id=gd.client_id
     LEFT JOIN business_settings bs ON true
     WHERE gd.token=$1 LIMIT 1`,
    [token]
  );
  const delivery = result.rows[0];
  if (!delivery || delivery.status !== "ACTIVE" || (delivery.expires_at && new Date(delivery.expires_at) < new Date())) {
    throw new AppError("Delivery link unavailable.", 404, "DELIVERY_UNAVAILABLE");
  }
  const items = await query("SELECT id, item_type, label, url, display_order FROM gallery_delivery_items WHERE delivery_id=$1 ORDER BY display_order, created_at", [delivery.id]);
  await query("UPDATE gallery_deliveries SET first_viewed_at=COALESCE(first_viewed_at, now()), last_viewed_at=now(), view_count=view_count+1, updated_at=now() WHERE id=$1", [delivery.id]);
  await query("UPDATE events SET gallery_status=CASE WHEN gallery_status='DELIVERED' THEN 'VIEWED' ELSE gallery_status END WHERE id=$1", [delivery.event_id]);
  await triggerAutomations({ triggerKey: "GALLERY_VIEWED", entityType: "event", entityId: delivery.event_id, payload: {} });
  return {
    delivery: {
      event_name: delivery.event_name,
      event_date: delivery.event_date,
      thank_you_message: delivery.thank_you_message,
      expires_at: delivery.expires_at,
      contact_email: delivery.business_email,
      contact_phone: delivery.phone,
      review_url: delivery.google_review_url || delivery.facebook_review_url || delivery.other_review_url
    },
    items: items.rows
  };
}

export async function revokeGalleryDelivery(eventId, user) {
  const result = await query("UPDATE gallery_deliveries SET status='REVOKED', updated_at=now() WHERE event_id=$1 AND status='ACTIVE' RETURNING *", [eventId]);
  await recordActivity({ actorUserId: user.id, entityType: "event", entityId: eventId, action: "delivery_token_revoked", summary: "Gallery delivery token revoked" });
  return { revoked: result.rowCount };
}
