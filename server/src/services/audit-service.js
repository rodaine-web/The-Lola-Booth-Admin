import { query } from "../db/pool.js";

export async function writeAudit({ req, action, entity, entityId, before = null, after = null }) {
  await query(
    `INSERT INTO audit_logs (
      user_id, actor_user_id, action, entity, entity_type, entity_id,
      before_value, before_json, after_value, after_json, ip_address, user_agent
    ) VALUES ($1,$1,$2,$3,$3,$4,$5,$5,$6,$6,$7,$8)`,
    [req.user?.id || null, action, entity, entityId, before, after, req.ip, req.headers?.["user-agent"] || null]
  );
}
