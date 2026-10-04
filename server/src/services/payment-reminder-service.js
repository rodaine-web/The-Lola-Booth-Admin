import { query } from "../db/pool.js";

export async function getPaymentReminderQueue() {
  const depositDue = await query(
    `SELECT i.id, i.invoice_number, c.email, c.name, i.amount_outstanding, i.due_date, 'DEPOSIT_DUE' AS reminder_type
     FROM invoices i
     JOIN clients c ON c.id=i.client_id
     WHERE i.deleted_at IS NULL AND i.status IN ('SENT','VIEWED','PARTIALLY_PAID','PARTIAL') AND i.amount_outstanding > 0
     ORDER BY i.due_date NULLS LAST LIMIT 50`
  );
  return depositDue.rows;
}

export async function previewPaymentReminders() {
  const heartbeat=(await query(
    "SELECT last_heartbeat_at,status,last_processing_error,metadata FROM worker_heartbeats WHERE worker_name='automation-worker' LIMIT 1"
  )).rows[0];
  const ageSeconds=heartbeat?.last_heartbeat_at
    ? Math.round((Date.now()-new Date(heartbeat.last_heartbeat_at).getTime())/1000)
    : null;
  const activeWorker=Boolean(heartbeat && heartbeat.status!=="ERROR" && heartbeat.metadata?.jobsPaused!==true && ageSeconds!==null && ageSeconds<=180);
  return {
    reminders: await getPaymentReminderQueue(),
    activeWorker,
    worker: heartbeat ? {
      status: heartbeat.metadata?.jobsPaused ? "PAUSED" : activeWorker ? "HEALTHY" : ageSeconds>300 ? "DOWN" : "STALE",
      lastHeartbeatAt: heartbeat.last_heartbeat_at,
      ageSeconds,
      lastError: heartbeat.last_processing_error || null
    } : { status:"UNKNOWN", lastHeartbeatAt:null, ageSeconds:null, lastError:null }
  };
}
