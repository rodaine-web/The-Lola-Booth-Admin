import crypto from "node:crypto";
import { query, transaction } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { writeAudit } from "./audit-service.js";
import { generateProposalDocx, generateProposalPdf, proposalHtml, storeDocument } from "./document-service.js";
import { sendEmail } from "./email-service.js";

const money = (value) => Number(value || 0);

export async function nextNumber(client, column, prefixColumn, fallbackPrefix) {
  const settings = await client.query(`SELECT id, ${column}, ${prefixColumn} FROM business_settings LIMIT 1 FOR UPDATE`);
  const row = settings.rows[0];
  const table = column === "next_invoice_number" ? "invoices" : "proposals";
  const numberField = column === "next_invoice_number" ? "invoice_number" : "proposal_number";
  const prefix = row[prefixColumn] || fallbackPrefix;
  let next = row[column] || 1001;
  while (true) {
    const candidate = `${prefix}-${next}`;
    const existing = await client.query(`SELECT 1 FROM ${table} WHERE ${numberField}=$1 LIMIT 1`, [candidate]);
    if (!existing.rows[0]) {
      await client.query(`UPDATE business_settings SET ${column}=$1 WHERE id=$2`, [next + 1, row.id]);
      return candidate;
    }
    next += 1;
  }
}

export async function buildProposalSnapshot(input) {
  const [settings, client, event, pkg, exp] = await Promise.all([
    query("SELECT * FROM business_settings LIMIT 1"),
    input.client_id ? query("SELECT * FROM clients WHERE id=$1", [input.client_id]) : { rows: [] },
    input.event_id ? query("SELECT * FROM events WHERE id=$1", [input.event_id]) : { rows: [] },
    input.package_id ? query("SELECT p.*, COALESCE(json_agg(pi.label ORDER BY pi.display_order) FILTER (WHERE pi.id IS NOT NULL),'[]') AS items FROM packages p LEFT JOIN package_items pi ON pi.package_id=p.id WHERE p.id=$1 GROUP BY p.id", [input.package_id]) : { rows: [] },
    input.experience_id ? query("SELECT * FROM experiences WHERE id=$1", [input.experience_id]) : { rows: [] }
  ]);
  const s = settings.rows[0] || {};
  const customer = client.rows[0] || {};
  const ev = event.rows[0] || {};
  const pack = pkg.rows[0] || {};
  const experience = exp.rows[0] || {};
  const addonIds = (input.addons || []).map((item) => item.addon_id).filter(Boolean);
  const addons = addonIds.length ? await query("SELECT * FROM addons WHERE id = ANY($1::uuid[])", [addonIds]) : { rows: [] };
  const addonRows = input.addons || [];
  const packageAmount = money(input.package_amount ?? pack.starting_price);
  const experienceAmount = money(input.experience_surcharge ?? 0);
  const addonItems = addonRows.map((selected) => {
    const addon = addons.rows.find((item) => item.id === selected.addon_id) || {};
    const qty = money(selected.quantity || 1);
    const unit = money(selected.unit_price ?? addon.price);
    return { type: "ADDON", addon_id: selected.addon_id, description: selected.description || addon.name, quantity: qty, unit_price: unit, line_total: qty * unit, pricing_type: addon.pricing_type || selected.pricing_type };
  });
  const lines = [
    { type: "PACKAGE", package_id: input.package_id, description: pack.name || "Package", quantity: 1, unit_price: packageAmount, line_total: packageAmount },
    ...(experienceAmount ? [{ type: "EXPERIENCE", experience_id: input.experience_id, description: `${experience.name || "Experience"} surcharge`, quantity: 1, unit_price: experienceAmount, line_total: experienceAmount }] : []),
    ...addonItems,
    ...(money(input.travel) ? [{ type: "TRAVEL", description: "Travel", quantity: 1, unit_price: money(input.travel), line_total: money(input.travel) }] : []),
    ...(money(input.other_fees) ? [{ type: "OTHER", description: "Other fees", quantity: 1, unit_price: money(input.other_fees), line_total: money(input.other_fees) }] : [])
  ];
  const subtotal = lines.reduce((sum, item) => sum + item.line_total, 0);
  const discount = money(input.discount);
  const taxable = Math.max(0, subtotal - discount);
  const taxRate = money(input.tax_rate ?? s.sales_tax_percent);
  const tax = taxable * (taxRate / 100);
  const total = taxable + tax;
  const depositType = input.deposit_type || "PERCENTAGE";
  const depositValue = money(input.deposit_value ?? s.default_deposit_percent ?? 30);
  const depositAmount = depositType === "FIXED" ? depositValue : total * (depositValue / 100);

  return {
    client: customer,
    event: ev,
    package: pack,
    experience,
    content: {
      introduction: input.introduction || s.proposal_default_intro,
      experienceName: input.experience_name || experience.name,
      experienceDescription: input.experience_description || experience.proposal_description || experience.description,
      packageName: input.package_name || pack.name,
      packageDescription: input.package_description || pack.proposal_description || pack.description,
      packageMostPopular: Boolean(pack.most_popular),
      nextSteps: input.next_steps || s.proposal_default_next_steps,
      terms: input.terms || s.proposal_default_terms,
      notes: input.notes || "",
      closing: "Let's make it official.\n\nGood people. Better photos.\n\nTHE LOLA BOOTH"
    },
    lineItems: lines,
    pricing: {
      subtotal: round(subtotal),
      discount: round(discount),
      tax_rate: round(taxRate),
      tax: round(tax),
      total: round(total),
      deposit_type: depositType,
      deposit_value: round(depositValue),
      deposit_amount: round(depositAmount),
      balance: round(total - depositAmount),
      balance_due_date: input.balance_due_date || null
    },
    validThrough: input.valid_through || new Date(Date.now() + Number(s.proposal_default_validity_days || 14) * 86400000).toISOString().slice(0, 10)
  };
}

export async function createProposal(req) {
  const snapshot = await buildProposalSnapshot(req.body);
  const result = await transaction(async (client) => {
    const proposalNumber = await nextNumber(client, "next_proposal_number", "proposal_prefix", "PROP");
    const inserted = await client.query(
      `INSERT INTO proposals (proposal_number, lead_id, client_id, event_id, owner_user_id, package_id, experience_id, secure_token, status, notes, total, valid_through, content, pricing_snapshot, line_items_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [proposalNumber, req.body.lead_id || null, req.body.client_id || snapshot.client.id || null, req.body.event_id || null, req.user.id, req.body.package_id || null, req.body.experience_id || null, crypto.randomBytes(24).toString("hex"), req.body.status || "DRAFT", req.body.notes || null, snapshot.pricing.total, snapshot.validThrough, JSON.stringify(snapshot.content), JSON.stringify(snapshot.pricing), JSON.stringify(snapshot.lineItems)]
    );
    await createProposalVersion(client, inserted.rows[0], req.user.id);
    return inserted.rows[0];
  });
  await recordActivity({ actorUserId: req.user.id, entityType: "proposal", entityId: result.id, action: "proposal_created", summary: `Proposal ${result.proposal_number} created` });
  await writeAudit({ req, action: "proposal_created", entity: "proposal", entityId: result.id, after: result });
  return result;
}

export async function createProposalVersion(client, proposal, userId) {
  const next = await client.query("SELECT COALESCE(max(version_number),0)+1 AS version FROM proposal_versions WHERE proposal_id=$1", [proposal.id]);
  const result = await client.query(
    `INSERT INTO proposal_versions (proposal_id, version_number, snapshot, created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [proposal.id, next.rows[0].version, JSON.stringify(proposal), userId]
  );
  return result.rows[0];
}

export async function getProposal(idOrToken, { publicView = false } = {}) {
  const where = publicView ? "p.secure_token=$1" : "p.id=$1";
  const result = await query(
    `SELECT p.*, c.name AS client_name, c.email AS client_email, e.event_name, e.event_type, e.event_date, e.start_time, e.end_time, e.venue_name,
      pkg.name AS package_name, x.name AS experience_name
     FROM proposals p
     LEFT JOIN clients c ON c.id=p.client_id
     LEFT JOIN events e ON e.id=p.event_id
     LEFT JOIN packages pkg ON pkg.id=p.package_id
     LEFT JOIN experiences x ON x.id=p.experience_id
     WHERE ${where} AND p.deleted_at IS NULL`,
    [idOrToken]
  );
  if (!result.rows[0]) throw notFound("Proposal");
  return result.rows[0];
}

export async function generateAndStoreProposal(proposal, type) {
  const buffer = type === "docx" ? await generateProposalDocx(proposal) : await generateProposalPdf(proposal);
  return storeDocument({
    buffer,
    filename: `${proposal.proposal_number}.${type}`,
    mimeType: type === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf"
  });
}

export async function sendProposal(req, proposal) {
  const doc = await generateAndStoreProposal(proposal, "pdf");
  const subject = req.body.subject || `Your LOLA Booths Proposal - ${proposal.event_name || proposal.event_date || proposal.proposal_number}`;
  const body = req.body.body || `THE LOLA BOOTH\nGood people. Better photos.\n\nHi ${firstName(proposal.client_name)},\n\nIt was great hearing about your event. We've prepared your LOLA Booths proposal based on the details you shared with us.\n\nReview and accept your proposal:\n${req.protocol}://${req.get("host")}/proposal/${proposal.secure_token}\n\nWe've also attached a branded PDF copy for your records.\n\nQuestions? Just reply to this email.\n\nYour event. Their favorite memory.\n\nLOLA Booths`;
  const email = await sendEmail({ to: req.body.recipient || proposal.client_email, subject, body, attachments: [doc] });
  await transaction(async (client) => {
    await client.query("UPDATE proposals SET status='SENT', sent_at=now(), updated_at=now() WHERE id=$1", [proposal.id]);
    await client.query(
      `INSERT INTO proposal_deliveries (proposal_id, recipient_email, delivery_method, status, sent_at)
       VALUES ($1,$2,'EMAIL',$3,now())`,
      [proposal.id, req.body.recipient || proposal.client_email, email.status]
    );
    await client.query(
      `INSERT INTO email_messages (provider, provider_message_id, to_email, subject, status, body_preview, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [email.provider, email.providerMessageId, req.body.recipient || proposal.client_email, subject, email.deliveredExternally ? "SENT" : "SENT", body.slice(0, 500)]
    );
  });
  return { email, document: doc };
}

export function proposalPreviewHtml(proposal) {
  return proposalHtml(proposal);
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function firstName(name = "there") {
  return name.split(" ")[0] || "there";
}
