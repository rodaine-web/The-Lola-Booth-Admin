import { query } from "../db/pool.js";

export async function getPaymentReminderQueue() {
  const depositDue = await query(
    `SELECT i.id, i.invoice_number, c.email, c.name, i.amount_outstanding, i.due_date, 'DEPOSIT_DUE' AS reminder_type
     FROM invoices i
     JOIN clients c ON c.id=i.client_id
     WHERE i.deleted_at IS NULL AND i.status IN ('SENT','VIEWED','PARTIALLY_PAID') AND i.amount_outstanding > 0
     ORDER BY i.due_date NULLS LAST LIMIT 50`
  );
  return depositDue.rows;
}

export async function previewPaymentReminders() {
  return { reminders: await getPaymentReminderQueue(), activeWorker: false };
}
