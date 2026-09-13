import crypto from "node:crypto";
import { query, transaction } from "../db/pool.js";
import { notFound } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { writeAudit } from "./audit-service.js";
import { generateInvoicePdf, storeDocument } from "./document-service.js";
import { sendEmail } from "./email-service.js";
import { getProposal, nextNumber } from "./proposal-service.js";

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

export async function getInvoice(idOrToken, { publicView = false } = {}) {
  const where = publicView ? "i.secure_token=$1" : "i.id=$1";
  const invoice = await query(
    `SELECT i.*, c.name AS client_name, c.email AS client_email, e.event_name, e.event_date, e.venue_name
     FROM invoices i
     LEFT JOIN clients c ON c.id=i.client_id
     LEFT JOIN events e ON e.id=i.event_id
     WHERE ${where} AND i.deleted_at IS NULL`,
    [idOrToken]
  );
  if (!invoice.rows[0]) throw notFound("Invoice");
  const items = await query("SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id", [invoice.rows[0].id]);
  const payments = await query("SELECT * FROM payments WHERE invoice_id=$1 AND deleted_at IS NULL ORDER BY payment_date DESC, created_at DESC", [invoice.rows[0].id]);
  return { ...invoice.rows[0], items: items.rows, payments: payments.rows };
}

export async function createInvoice(req) {
  const invoice = await transaction(async (client) => {
    const settings = await client.query("SELECT * FROM business_settings LIMIT 1");
    let source = {};
    let items = req.body.items || [];
    if (req.body.proposal_id) {
      source = await getProposal(req.body.proposal_id);
      items = (source.line_items_snapshot || []).map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        taxable: true,
        tax_rate: source.pricing_snapshot?.tax_rate || 0,
        discount: 0
      }));
    }
    if (req.body.depositOnly && source.pricing_snapshot) {
      items = [{ description: `Deposit for ${source.proposal_number}`, quantity: 1, unit_price: source.pricing_snapshot.deposit_amount, taxable: false, tax_rate: 0, discount: 0 }];
    }
    const totals = calculateInvoiceTotals(items);
    const invoiceNumber = await nextNumber(client, "next_invoice_number", "invoice_prefix", "LOLA-INV");
    const dueDate = req.body.due_date || new Date(Date.now() + Number(settings.rows[0]?.invoice_default_due_days || 7) * 86400000).toISOString().slice(0, 10);
    const invoice = await client.query(
      `INSERT INTO invoices (invoice_number, proposal_id, client_id, event_id, status, subtotal, discount, tax, total, amount_paid, balance_due, amount_outstanding, due_date, notes, terms, secure_token, pricing_snapshot)
       VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,0,$8,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [invoiceNumber, req.body.proposal_id || null, req.body.client_id || source.client_id, req.body.event_id || source.event_id, totals.subtotal, totals.discount, totals.tax, totals.total, dueDate, req.body.notes || settings.rows[0]?.invoice_default_notes, req.body.terms || settings.rows[0]?.invoice_default_payment_terms, crypto.randomBytes(24).toString("hex"), JSON.stringify(totals)]
    );
    for (const item of totals.items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, label, description, quantity, unit_price, taxable, tax_rate, discount, total, line_total)
         VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [invoice.rows[0].id, item.description, item.quantity, item.unit_price, item.taxable, item.tax_rate, item.discount, item.line_total]
      );
    }
    return invoice.rows[0];
  });
  await recordActivity({ actorUserId: req.user.id, entityType: "invoice", entityId: invoice.id, action: "invoice_created", summary: `Invoice ${invoice.invoice_number} created` });
  await writeAudit({ req, action: "invoice_created", entity: "invoice", entityId: invoice.id, after: invoice });
  return invoice;
}

export function calculateInvoiceTotals(items) {
  const normalized = items.map((item) => {
    const quantity = money(item.quantity || 1);
    const unit = money(item.unit_price);
    const discount = money(item.discount);
    const preTax = Math.max(0, quantity * unit - discount);
    const tax = item.taxable === false ? 0 : preTax * (money(item.tax_rate) / 100);
    return { ...item, quantity, unit_price: unit, discount, tax: money(tax), line_total: money(preTax + tax) };
  });
  return {
    items: normalized,
    subtotal: money(normalized.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)),
    discount: money(normalized.reduce((sum, item) => sum + item.discount, 0)),
    tax: money(normalized.reduce((sum, item) => sum + item.tax, 0)),
    total: money(normalized.reduce((sum, item) => sum + item.line_total, 0))
  };
}

export async function generateAndStoreInvoice(invoice) {
  const buffer = await generateInvoicePdf(invoice);
  return storeDocument({ buffer, filename: `${invoice.invoice_number}.pdf`, mimeType: "application/pdf" });
}

export async function sendInvoice(req, invoice) {
  const doc = await generateAndStoreInvoice(invoice);
  const subject = req.body.subject || `Invoice ${invoice.invoice_number} from LOLA Booths`;
  const amountDue = invoice.amount_outstanding || invoice.balance_due;
  const body = req.body.body || `THE LOLA BOOTH\nGood people. Better photos.\n\nHi ${firstName(invoice.client_name)},\n\nYour LOLA Booths invoice for ${invoice.event_name || "your event"} is ready.\n\nAmount Due:\n$${amountDue}\n\nDue Date:\n${invoice.due_date || ""}\n\nView or pay securely:\n${req.protocol}://${req.get("host")}/invoice/${invoice.secure_token}\n\nA branded PDF copy is attached for your records.\n\nQuestions? Reply to this email.\n\nYour event. Their favorite memory.\n\nLOLA Booths`;
  const email = await sendEmail({ to: req.body.recipient || invoice.client_email, subject, body, attachments: [doc] });
  await query("UPDATE invoices SET status='SENT', sent_at=now(), updated_at=now() WHERE id=$1", [invoice.id]);
  await query(
    `INSERT INTO email_messages (provider, provider_message_id, to_email, subject, status, body_preview, sent_at)
     VALUES ($1,$2,$3,$4,'SENT',$5,now())`,
    [email.provider, email.providerMessageId, req.body.recipient || invoice.client_email, subject, body.slice(0, 500)]
  );
  return { email, document: doc };
}

function firstName(name = "there") {
  return name.split(" ")[0] || "there";
}
