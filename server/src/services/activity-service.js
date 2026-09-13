import { query } from "../db/pool.js";

export async function recordActivity({ actorUserId = null, entityType, entityId, action, summary, metadata = {} }) {
  await query(
    `INSERT INTO activities (actor_user_id, entity_type, entity_id, action, summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorUserId, entityType, entityId, action, summary, metadata]
  );
}

export async function logAutomationEvent({ triggerKey, entityType, entityId, payload = {} }) {
  await query(
    `INSERT INTO automation_events (trigger_key, entity_type, entity_id, payload, status)
     VALUES ($1, $2, $3, $4, 'LOGGED')`,
    [triggerKey, entityType, entityId, payload]
  );
}
