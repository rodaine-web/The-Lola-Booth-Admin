import { query, transaction } from "../db/pool.js";
import { sendCommunication } from "./automation-service.js";
import { formOwnerNotificationsEnabled } from "../config/staging-safety.js";
import { recoverPublicInquiryAcknowledgments } from "./public-form-email-service.js";

// This is intentionally separate from general automation processing. No customer,
// marketing, reminder, or historical messages are eligible for this lane.
export async function processFormOwnerNotifications({
  sendCommunicationImpl = sendCommunication,
} = {}) {
  if (!formOwnerNotificationsEnabled()) return { processed: [] };
  const since = process.env.FORM_OWNER_NOTIFICATIONS_SINCE;
  await recoverPublicInquiryAcknowledgments({ since });
  const claimed = await transaction(async (client) => {
    await client.query(
      "UPDATE communications SET status='FAILED',failed_at=now(),failure_code='DELIVERY_OUTCOME_UNKNOWN',failure_message='Worker stopped during owner notification. Review provider history before retrying.',updated_at=now() WHERE status='PROCESSING' AND trigger_key='PUBLIC_FORM' AND idempotency_key LIKE 'public-form:%:owner' AND created_at >= $1 AND updated_at < now()-interval '5 minutes'",
      [since],
    );
    const rows = (
      await client.query(
        "SELECT id FROM communications WHERE status='SCHEDULED' AND trigger_key='PUBLIC_FORM' AND idempotency_key LIKE 'public-form:%:owner' AND recipient='info@thelolabooth.com' AND created_at >= $1 AND scheduled_at<=now() AND deleted_at IS NULL ORDER BY scheduled_at LIMIT 10 FOR UPDATE SKIP LOCKED",
        [since],
      )
    ).rows;
    if (rows.length)
      await client.query(
        "UPDATE communications SET status='PROCESSING',queued_at=COALESCE(queued_at,now()),updated_at=now() WHERE id=ANY($1::uuid[])",
        [rows.map((r) => r.id)],
      );
    return rows;
  });
  const processed = [];
  for (const row of claimed) {
    try {
      const result = await sendCommunicationImpl(
        row.id,
        {},
        { workerClaim: true },
      );
      processed.push({ id: row.id, status: result.communication.status });
    } catch (error) {
      await query(
        "UPDATE communications SET status='FAILED',failed_at=now(),failure_code=$2,failure_message='Owner notification could not be sent. Review this communication before retrying.',updated_at=now() WHERE id=$1",
        [row.id, error.code || "DELIVERY_OUTCOME_UNKNOWN"],
      );
      processed.push({ id: row.id, status: "FAILED" });
    }
  }
  return { processed };
}
