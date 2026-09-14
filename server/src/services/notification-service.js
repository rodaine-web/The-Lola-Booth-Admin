import { query, transaction } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { recordTemplateFallback, renderCommunicationTemplateByKey } from "./automation-service.js";
import { sendEmail } from "./email-service.js";

const categories = ["LEADS", "SALES", "PAYMENTS", "EVENTS", "STAFF", "EQUIPMENT", "INCIDENTS", "SYSTEM"];
const severities = ["INFO", "WARNING", "HIGH", "CRITICAL"];

function isManagerRole(role) {
  return ["OWNER", "ADMIN", "EVENT_MANAGER"].includes(role);
}

function canSeeRoleTarget(user, roleTarget) {
  if (!roleTarget) return false;
  if (user?.permissions?.includes("*")) return true;
  const roles = user?.roles || [];
  if (roleTarget === "OWNER_ADMIN") return roles.includes("OWNER") || roles.includes("ADMIN");
  if (roleTarget === "MANAGERS") return roles.some(isManagerRole);
  return roles.includes(roleTarget);
}

function preferenceAllows(preferences, category, severity, channel) {
  if (severity === "CRITICAL" && preferences?.critical_mandatory !== false) return true;
  if (channel === "IN_APP" && preferences?.in_app_enabled === false) return false;
  if (channel === "EMAIL" && preferences?.email_enabled === false) return false;
  if (channel === "SMS" && preferences?.sms_enabled !== true) return false;
  const categoryPrefs = preferences?.categories || {};
  return categoryPrefs[category] !== false;
}

async function usersForTarget(target = {}) {
  if (target.userIds?.length) {
    const result = await query("SELECT id, email, name FROM users WHERE id=ANY($1::uuid[]) AND active=true AND deleted_at IS NULL", [target.userIds]);
    return result.rows;
  }
  if (target.eventTeamEventId) {
    const result = await query(
      `SELECT DISTINCT u.id, u.email, u.name
       FROM staff_assignments sa
       JOIN staff_profiles sp ON sp.id=sa.staff_profile_id
       JOIN users u ON u.id=sp.user_id
       WHERE sa.event_id=$1 AND sa.released_at IS NULL AND u.active=true AND u.deleted_at IS NULL`,
      [target.eventTeamEventId]
    );
    return result.rows;
  }
  if (target.roleTarget) {
    const roles = target.roleTarget === "OWNER_ADMIN" ? ["OWNER", "ADMIN"] : target.roleTarget === "MANAGERS" ? ["OWNER", "ADMIN", "EVENT_MANAGER"] : [target.roleTarget];
    const result = await query(
      `SELECT DISTINCT u.id, u.email, u.name
       FROM users u
       JOIN user_roles ur ON ur.user_id=u.id
       JOIN roles r ON r.id=ur.role_id
       WHERE r.name=ANY($1::text[]) AND u.active=true AND u.deleted_at IS NULL`,
      [roles]
    );
    return result.rows;
  }
  return [];
}

export async function createNotification({ userId = null, roleTarget = null, target = {}, category = "SYSTEM", severity = "INFO", title, body = "", entityType = null, entityId = null, actionUrl = null, metadata = {}, email = null, expiresAt = null }) {
  if (!categories.includes(category)) throw new AppError("Unsupported notification category.", 400, "INVALID_NOTIFICATION_CATEGORY");
  if (!severities.includes(severity)) throw new AppError("Unsupported notification severity.", 400, "INVALID_NOTIFICATION_SEVERITY");
  const resolvedUsers = userId ? [{ id: userId }] : await usersForTarget({ ...target, roleTarget: roleTarget || target.roleTarget });
  const roleOnly = !userId && !resolvedUsers.length && (roleTarget || target.roleTarget);
  const recipients = roleOnly ? [{ id: null }] : resolvedUsers;
  const created = [];
  await transaction(async (client) => {
    for (const recipient of recipients) {
      const result = await client.query(
        `INSERT INTO notifications (user_id, role_target, category, severity, title, body, entity_type, entity_id, action_url, expires_at, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [recipient.id, roleOnly ? (roleTarget || target.roleTarget) : null, category, severity, title, body, entityType, entityId, actionUrl, expiresAt, metadata]
      );
      created.push(result.rows[0]);
    }
  });
  if (email?.enabled && resolvedUsers.length) {
    await sendNotificationEmail({ users: resolvedUsers, category, severity, title, body, email });
  }
  return created;
}

async function sendNotificationEmail({ users, category, severity, title, body, email }) {
  for (const user of users.filter((item) => item.email)) {
    const prefs = await getNotificationPreferences(user.id);
    if (!preferenceAllows(prefs, category, severity, "EMAIL")) continue;
    let rendered = null;
    try {
      rendered = await renderCommunicationTemplateByKey(email.templateKey || "notification_email_default", {
        user: { name: user.name, email: user.email },
        request: { type: email.subject || title, notes: email.body || body || title, status: severity }
      });
    } catch (error) {
      await recordTemplateFallback({ templateKey: email.templateKey || "notification_email_default", reason: error.message, relatedEntityType: "notification", metadata: { code: error.code, category, severity } });
    }
    await sendEmail({
      to: user.email,
      subject: rendered?.subject || email.subject || title,
      body: rendered?.body || email.body || body || title,
      html: rendered?.html || null
    }).catch(() => null);
  }
}

export async function listNotifications(user, filters = {}) {
  const params = [user.id];
  const where = [
    "(n.user_id=$1 OR (n.user_id IS NULL AND n.role_target IS NOT NULL))",
    "n.dismissed_at IS NULL",
    "(n.expires_at IS NULL OR n.expires_at > now())"
  ];
  if (filters.unread === "true" || filters.unread === true) where.push("n.read_at IS NULL");
  if (filters.category) {
    params.push(filters.category);
    where.push(`n.category=$${params.length}`);
  }
  const result = await query(
    `SELECT n.* FROM notifications n
     WHERE ${where.join(" AND ")}
     ORDER BY n.created_at DESC LIMIT 100`,
    params
  );
  return {
    data: result.rows.filter((row) => row.user_id === user.id || canSeeRoleTarget(user, row.role_target)),
    unread: await unreadNotificationCount(user)
  };
}

export async function unreadNotificationCount(user) {
  const result = await query(
    `SELECT * FROM notifications
     WHERE read_at IS NULL AND dismissed_at IS NULL AND (expires_at IS NULL OR expires_at > now())
       AND (user_id=$1 OR user_id IS NULL)
     ORDER BY created_at DESC LIMIT 200`,
    [user.id]
  );
  return result.rows.filter((row) => row.user_id === user.id || canSeeRoleTarget(user, row.role_target)).length;
}

export async function markNotificationRead(id, user) {
  const existing = await query("SELECT * FROM notifications WHERE id=$1 AND dismissed_at IS NULL", [id]);
  const notification = existing.rows[0];
  if (!notification || (notification.user_id !== user.id && !canSeeRoleTarget(user, notification.role_target))) throw notFound("Notification");
  const result = await query("UPDATE notifications SET read_at=COALESCE(read_at, now()) WHERE id=$1 RETURNING *", [id]);
  return result.rows[0];
}

export async function markAllNotificationsRead(user) {
  const listed = await listNotifications(user, { unread: true });
  const ids = listed.data.map((item) => item.id);
  if (!ids.length) return { updated: 0 };
  await query("UPDATE notifications SET read_at=COALESCE(read_at, now()) WHERE id=ANY($1::uuid[])", [ids]);
  return { updated: ids.length };
}

export async function dismissNotification(id, user) {
  const notification = await markNotificationRead(id, user);
  const result = await query("UPDATE notifications SET dismissed_at=now() WHERE id=$1 RETURNING *", [notification.id]);
  return result.rows[0];
}

export async function getNotificationPreferences(userId) {
  const result = await query(
    `INSERT INTO notification_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id=EXCLUDED.user_id
     RETURNING *`,
    [userId]
  );
  return result.rows[0];
}

export async function updateNotificationPreferences(userId, body) {
  const result = await query(
    `INSERT INTO notification_preferences (user_id, in_app_enabled, email_enabled, sms_enabled, categories)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id) DO UPDATE SET in_app_enabled=EXCLUDED.in_app_enabled, email_enabled=EXCLUDED.email_enabled, sms_enabled=EXCLUDED.sms_enabled, categories=EXCLUDED.categories, updated_at=now()
     RETURNING *`,
    [userId, body.in_app_enabled !== false, body.email_enabled !== false, body.sms_enabled === true, body.categories || {}]
  );
  return result.rows[0];
}

export async function recordOfflineReceipt({ user, idempotencyKey, actionType, endpoint, entityType = null, entityId = null, requestPayload = {}, responsePayload = {}, status = "SYNCED" }) {
  const existing = await query("SELECT * FROM offline_action_receipts WHERE idempotency_key=$1", [idempotencyKey]);
  if (existing.rows[0]?.status === "SYNCED") return { replay: true, receipt: existing.rows[0] };
  if (existing.rows[0]) {
    const refreshed = await query(
      "UPDATE offline_action_receipts SET action_type=$1, endpoint=$2, entity_type=$3, entity_id=$4, request_payload=$5, status=$6 WHERE id=$7 RETURNING *",
      [actionType, endpoint, entityType, entityId, requestPayload, status, existing.rows[0].id]
    );
    return { replay: false, receipt: refreshed.rows[0] };
  }
  const result = await query(
    `INSERT INTO offline_action_receipts (user_id, idempotency_key, action_type, endpoint, entity_type, entity_id, request_payload, response_payload, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [user?.id || null, idempotencyKey, actionType, endpoint, entityType, entityId, requestPayload, responsePayload, status]
  );
  return { replay: false, receipt: result.rows[0] };
}
