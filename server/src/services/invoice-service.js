import { normalizeInvoice } from "../../../shared/invoice-balance.js";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { query, transaction } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { writeAudit } from "./audit-service.js";
import { brandedEmailHtml, recordTemplateFallback, renderCommunicationTemplateByKey } from "./automation-service.js";
import { generateInvoicePdf, storeDocument } from "./document-service.js";
import { sendEmail } from "./email-service.js";
import { getProposal, nextNumber } from "./proposal-service.js";

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

export async function getInvoice(idOrToken, { publicView = false } = {}) {
  const where = publicView ? "i.secure_token=$1" : "i.id=$1";
  const invoice = await query(
    `SELECT i.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, e.event_name, e.event_type, e.event_date, e.venue_name, e.venue_address, e.city, e.state, e.guest_count, p.proposal_title, pkg.name AS package_name
     FROM invoices i
     LEFT JOIN clients c ON c.id=i.client_id
     LEFT JOIN events e ON e.id=i.event_id
     LEFT JOIN proposals p ON p.id=i.proposal_id
     LEFT JOIN packages pkg ON pkg.id=p.package_id
     WHERE ${where} AND i.deleted_at IS NULL`,
    [idOrToken]
  );
  if (!invoice.rows[0]) throw notFound("Invoice");
  const items = await query("SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id", [invoice.rows[0].id]);
  const payments = await query("SELECT * FROM payments WHERE invoice_id=$1 AND deleted_at IS NULL ORDER BY payment_date DESC, created_at DESC", [invoice.rows[0].id]);
  return normalizeInvoice({ ...invoice.rows[0], public_url: publicInvoiceUrl(invoice.rows[0]), items: items.rows, payments: payments.rows });
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
    const documentTemplateKey = req.body.document_template_key || (req.body.corporate_billing ? "corporate_invoice" : "standard_invoice");
    const corporateBilling = {
      company: req.body.company || req.body.corporate_billing?.company || null,
      billing_contact: req.body.billing_contact || req.body.corporate_billing?.billing_contact || null,
      billing_address: req.body.billing_address || req.body.corporate_billing?.billing_address || null,
      po_number: req.body.po_number || req.body.corporate_billing?.po_number || null,
      accounts_payable_email: req.body.accounts_payable_email || req.body.corporate_billing?.accounts_payable_email || null,
      project_name: req.body.project_name || req.body.corporate_billing?.project_name || null,
      tax_exemption: req.body.tax_exemption || req.body.corporate_billing?.tax_exemption || null,
      payment_terms: req.body.payment_terms || req.body.corporate_billing?.payment_terms || null
    };
    const invoice = await client.query(
      `INSERT INTO invoices (invoice_number, proposal_id, client_id, event_id, status, subtotal, discount, tax, total, amount_paid, balance_due, amount_outstanding, due_date, notes, terms, secure_token, pricing_snapshot, document_template_key, corporate_billing)
       VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,0,$8,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [invoiceNumber, req.body.proposal_id || null, req.body.client_id || source.client_id, req.body.event_id || source.event_id, totals.subtotal, totals.discount, totals.tax, totals.total, dueDate, req.body.notes || settings.rows[0]?.invoice_default_notes, req.body.terms || settings.rows[0]?.invoice_default_payment_terms, crypto.randomBytes(24).toString("hex"), JSON.stringify(totals), documentTemplateKey, JSON.stringify(corporateBilling)]
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

export async function updateDraftInvoice(req) {
  const result = await transaction(async client => {
    const locked = await client.query("SELECT * FROM invoices WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [req.params.id]);
    const before = locked.rows[0];
    if (!before) throw notFound("Invoice");
    if (before.status !== "DRAFT" || Number(before.amount_paid) > 0) throw new AppError("Only unpaid draft invoices can be edited.", 409, "INVOICE_NOT_EDITABLE");
    const currentItems = await client.query("SELECT * FROM invoice_items WHERE invoice_id=$1", [before.id]);
    const totals = calculateInvoiceTotals(req.body.items ?? currentItems.rows);
    const values = [req.body.client_id === undefined ? before.client_id : req.body.client_id, req.body.event_id === undefined ? before.event_id : req.body.event_id, req.body.due_date === undefined ? before.due_date : req.body.due_date, req.body.notes === undefined ? before.notes : req.body.notes, req.body.terms === undefined ? before.terms : req.body.terms];
    const updated = await client.query(`UPDATE invoices SET client_id=$1,event_id=$2,due_date=$3,notes=$4,terms=$5,subtotal=$6,discount=$7,tax=$8,total=$9,balance_due=$9,amount_outstanding=$9,pricing_snapshot=$10,updated_at=now() WHERE id=$11 RETURNING *`, [...values,totals.subtotal,totals.discount,totals.tax,totals.total,JSON.stringify(totals),before.id]);
    await client.query("DELETE FROM invoice_items WHERE invoice_id=$1", [before.id]);
    for (const item of totals.items) await client.query(`INSERT INTO invoice_items(invoice_id,label,description,quantity,unit_price,taxable,tax_rate,discount,total,line_total) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$8)`,[before.id,item.description,item.quantity,item.unit_price,item.taxable ?? true,item.tax_rate || 0,item.discount,item.line_total]);
    return {before,after:updated.rows[0]};
  });
  await writeAudit({req,action:"invoice_updated",entity:"invoice",entityId:req.params.id,...result});
  return getInvoice(req.params.id);
}

export function calculateInvoiceTotals(items) {
  const normalized = items.map((item) => {
    const quantity = money(item.quantity || 1);
    const unit = money(item.unit_price);
    const discount = money(item.discount);
    const preTax = Math.max(0, quantity * unit - discount);
    const tax = item.taxable === false ? 0 : preTax * (money(item.tax_rate) / 100);
    return { ...item, quantity, unit_price: unit, taxable: item.taxable !== false, tax_rate: money(item.tax_rate), discount, tax: money(tax), line_total: money(preTax + tax) };
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
  return storeDocument({ buffer, filename: `LOLA-Invoice-${String(invoice.invoice_number || "document").replace(/[^a-z0-9._-]+/gi, "-")}.pdf`, mimeType: "application/pdf" });
}

export async function sendInvoice(req, invoice) {
  const doc = await generateAndStoreInvoice(invoice);
  const amountDue = invoice.amount_outstanding ?? invoice.balance_due;
  const invoiceUrl = publicInvoiceUrl(invoice);
  const mergeData = invoiceMergeData(invoice, invoiceUrl, amountDue);
  let rendered = null;
  try {
    rendered = await renderCommunicationTemplateByKey("INVOICE_DELIVERY", mergeData) || await renderCommunicationTemplateByKey("deposit_invoice_sent", mergeData);
  } catch (error) {
    await recordTemplateFallback({ templateKey: "INVOICE_DELIVERY", reason: error.message, relatedEntityType: "invoice", relatedEntityId: invoice.id, metadata: { code: error.code } });
  }
  if (!rendered) await recordTemplateFallback({ templateKey: "INVOICE_DELIVERY", reason: "Active template was not found or could not render.", relatedEntityType: "invoice", relatedEntityId: invoice.id });
  const template = rendered?.template || null;
  const subject = req.body.subject || rendered?.subject || `Invoice ${invoice.invoice_number} from LOLA Booths`;
  const body = req.body.body || rendered?.body || `THE LOLA BOOTH\nGood people. Better photos.\n\nHi ${firstName(invoice.client_name)},\n\nYour LOLA Booths invoice for ${invoice.event_name || "your event"} is ready.\n\nAmount Due:\n$${amountDue}\n\nDue Date:\n${invoice.due_date || ""}\n\nView or pay securely:\n${invoiceUrl}\n\nA branded PDF copy is attached for your records.\n\nQuestions? Reply to this email.\n\nYour event. Their favorite memory.\n\nLOLA Booths`;
  const html = brandedEmailHtml(body, {
    firstName: firstName(invoice.client_name),
    kicker: "Your invoice is ready",
    ctaLabel: "View Your Invoice",
    ctaUrl: invoiceUrl,
    event: {
      date: invoice.event_date,
      venue: invoice.venue_name,
      type: invoice.event_type,
      packageName: invoice.package_name || invoice.proposal_title
    }
  });
  const email = await sendEmail({ to: req.body.recipient || invoice.client_email, subject, body, html, attachments: [doc] });
  await query("UPDATE invoices SET status='SENT', sent_at=now(), updated_at=now() WHERE id=$1", [invoice.id]);
  const communication = await query(
    `INSERT INTO communications (
       client_id, event_id, invoice_id, type, channel, direction, template_id, template_key, template_version,
       recipient, subject, rendered_subject, message_summary, rendered_body, rendered_html, merge_data, send_mode, status,
       sent_at, provider, provider_message_id, user_id, created_by, sent_by
     ) VALUES ($1,$2,$3,'EMAIL','EMAIL','OUTBOUND',$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,'SEND_NOW','SENT_TO_PROVIDER',now(),$13,$14,$15,$15,$15)
     RETURNING *`,
    [
      invoice.client_id || null,
      invoice.event_id || null,
      invoice.id,
      template?.id || null,
      template?.key || template?.template_key || null,
      template?.version || null,
      req.body.recipient || invoice.client_email,
      subject,
      body.slice(0, 500),
      body,
      html,
      mergeData,
      email.provider,
      email.providerMessageId,
      req.user?.id || null
    ]
  );
  await query(
    `INSERT INTO email_messages (communication_id, provider, provider_message_id, to_email, subject, status, body_preview, sent_at)
     VALUES ($1,$2,$3,$4,$5,'SENT_TO_PROVIDER',$6,now())`,
    [communication.rows[0].id, email.provider, email.providerMessageId, req.body.recipient || invoice.client_email, subject, body.slice(0, 500)]
  );
  return { email, document: doc };
}

function firstName(name = "there") {
  return name.split(" ")[0] || "there";
}

function invoiceMergeData(invoice, invoiceUrl, amountDue) {
  const formattedAmount = `$${Number(amountDue || 0).toFixed(2)}`;
  return {
    client_name: invoice.client_name,
    invoice_number: invoice.invoice_number,
    invoice_url: invoiceUrl,
    amount_due: formattedAmount,
    due_date: invoice.due_date,
    client: {
      first_name: firstName(invoice.client_name),
      name: invoice.client_name,
      email: invoice.client_email
    },
    event: {
      id: invoice.event_id,
      name: invoice.event_name,
      date: invoice.event_date,
      venue: invoice.venue_name
    },
    invoice: {
      id: invoice.id,
      number: invoice.invoice_number,
      url: invoiceUrl,
      public_url: invoiceUrl,
      amount_due: formattedAmount,
      balance_due: formattedAmount,
      amount_paid: `$${Number(invoice.amount_paid || 0).toFixed(2)}`,
      total: `$${Number(invoice.total || 0).toFixed(2)}`,
      due_date: invoice.due_date
    }
  };
}

export function publicInvoiceUrl(invoice) {
  return `${env.publicBaseUrl.replace(/\/$/, "")}/invoice/${invoice.secure_token}`;
}
