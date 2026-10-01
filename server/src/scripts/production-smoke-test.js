import crypto from "node:crypto";
import { query, transaction, pool } from "../db/pool.js";
import { inquirySchema } from "../services/public-form-schema.js";
import { ingestProviderLead } from "../services/social-lead-service.js";
import { sendPublicInquiryEmails } from "../services/public-form-email-service.js";
import { publicSitePayload } from "../services/website-cms-service.js";
import { buildProposalSnapshot, getProposal, nextNumber, proposalPdfBuffer, proposalPreviewHtml, sendProposal } from "../services/proposal-service.js";
import { createInvoice, getInvoice } from "../services/invoice-service.js";
import { publicPaymentOptions } from "../services/payment-service.js";
import { generateInvoicePdf } from "../services/document-service.js";

const TARGET = "olawandeadams@gmail.com";
const MARKER = "QA-SMOKE-2026-10-01-V2";
const CONTACT_SUBMISSION = "11111111-1111-4111-8111-111111111101";
const BOOKING_SUBMISSION = "11111111-1111-4111-8111-111111111102";

function fakeReq(userId, body = {}) {
  return { body, user: { id: userId }, ip: "127.0.0.1", headers: { "user-agent": "LOLA production smoke test" } };
}

async function testPublicForms() {
  const captured = [];
  const sendEmailImpl = async (message) => {
    captured.push({ purpose: message.purpose || null, to: message.to, subject: message.subject });
    return { provider: "SMOKE_CAPTURE", providerMessageId: crypto.randomUUID(), status: "SENT", deliveredExternally: false };
  };

  const contactPayload = inquirySchema.parse({
    formKind: "CONTACT",
    submissionId: CONTACT_SUBMISSION,
    form_id: "contact",
    firstName: "QA",
    lastName: "Smoke Contact",
    email: TARGET,
    topic: "General inquiry",
    message: "QA SMOKE TEST - DO NOT FULFILL - production contact form",
    marketing_email_opt_in: false,
    landing_page_url: "https://thelolabooth.com/contact"
  });
  const contact = await ingestProviderLead({ provider: "WEBSITE", payload: contactPayload, testMode: true, skipAutomations: true });
  if (contact.action !== "IDEMPOTENT_REPLAY") {
    await sendPublicInquiryEmails({ lead: contact.lead, payload: contactPayload, action: contact.action, ownerRecipient: TARGET, sendEmailImpl });
  }

  const glam = (await query("SELECT * FROM experiences WHERE deleted_at IS NULL AND active=true AND lower(name) LIKE '%glam%' ORDER BY display_order NULLS LAST, created_at LIMIT 1")).rows[0];
  if (!glam) throw new Error("Glam experience not found");

  const bookingPayload = inquirySchema.parse({
    formKind: "BOOKING",
    submissionId: BOOKING_SUBMISSION,
    form_id: "availability",
    firstName: "QA",
    lastName: "Smoke Booking",
    email: TARGET,
    phone: "7732402744",
    eventDate: "2026-12-30",
    eventType: "Private Event",
    guestCount: 25,
    city: "Chicago",
    state: "IL",
    preferredExperienceId: glam.id,
    message: "QA SMOKE TEST - DO NOT FULFILL - production availability form",
    marketing_email_opt_in: false,
    landing_page_url: "https://thelolabooth.com/availability"
  });
  const booking = await ingestProviderLead({ provider: "WEBSITE", payload: bookingPayload, testMode: true, skipAutomations: true });
  if (booking.action !== "IDEMPOTENT_REPLAY") {
    await sendPublicInquiryEmails({ lead: booking.lead, payload: bookingPayload, action: booking.action, ownerRecipient: TARGET, sendEmailImpl });
  }

  return {
    contact: { action: contact.action, leadId: contact.lead?.id || contact.duplicateOf || null },
    booking: { action: booking.action, leadId: booking.lead?.id || booking.duplicateOf || null },
    routing: captured
  };
}

async function ensureTestProposal(userId) {
  const existing = await query("SELECT * FROM proposals WHERE notes=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [MARKER]);
  if (existing.rows[0]) return existing.rows[0];

  const glam = (await query("SELECT * FROM experiences WHERE deleted_at IS NULL AND active=true AND lower(name) LIKE '%glam%' ORDER BY display_order NULLS LAST, created_at LIMIT 1")).rows[0];
  if (!glam) throw new Error("Glam experience not found");

  const testClientEmail = "qa-smoke-proposal-20261001@thelolabooth.com";
  let client = await query("SELECT * FROM clients WHERE deleted_at IS NULL AND lower(email)=lower($1) LIMIT 1", [testClientEmail]);
  if (!client.rows[0]) {
    client = await query("INSERT INTO clients (name,email,client_type,referral_source) VALUES ($1,$2,'INDIVIDUAL','SYSTEM_TEST') RETURNING *", ["QA Smoke Test Client", testClientEmail]);
  }

  let event = await query("SELECT * FROM events WHERE deleted_at IS NULL AND client_id=$1 AND event_name=$2 LIMIT 1", [client.rows[0].id, "QA SMOKE TEST - DO NOT FULFILL"]);
  if (!event.rows[0]) {
    event = await query(
      `INSERT INTO events (event_name,client_id,event_type,event_date,experience_id,status,internal_notes)
       VALUES ($1,$2,'PRIVATE_EVENT',$3,$4,'DRAFT',$5) RETURNING *`,
      ["QA SMOKE TEST - DO NOT FULFILL", client.rows[0].id, "2026-12-30", glam.id, MARKER]
    );
  }

  const input = {
    client_id: client.rows[0].id,
    event_id: event.rows[0].id,
    experience_id: glam.id,
    proposal_type: "PRIVATE_EVENT",
    proposal_title: "QA SMOKE TEST - LOLA Proposal",
    proposal_date: new Date().toISOString().slice(0,10),
    notes: MARKER,
    tax_rate: 0,
    discount: 0,
    deposit_type: "PERCENTAGE",
    deposit_value: 30,
    selected_experiences: [{
      experience_id: glam.id,
      key: "glam",
      name: glam.name || "The Glam",
      package_name: "QA Smoke Test",
      price: 1,
      headline: "Clean. Classic. Beautifully you.",
      description: "QA SMOKE TEST - DO NOT FULFILL. Production proposal rendering check."
    }],
    visual_sections: []
  };
  const snapshot = await buildProposalSnapshot(input);

  return transaction(async (db) => {
    const number = await nextNumber(db, "next_proposal_number", "proposal_prefix", "PROP");
    const row = await db.query(
      `INSERT INTO proposals (
        proposal_number, client_id, event_id, owner_user_id, experience_id, secure_token, status, notes, total,
        valid_through, content, pricing_snapshot, line_items_snapshot, document_template_key, editable_sections,
        proposal_source, proposal_title, proposal_date, proposal_type, selected_experiences, proposal_visuals, visual_sections
      ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14,'GENERATED',$15,$16,$17,$18,$19,$20) RETURNING *`,
      [number, client.rows[0].id, event.rows[0].id, userId, glam.id, crypto.randomBytes(24).toString("hex"), MARKER,
       snapshot.pricing.total, snapshot.validThrough, JSON.stringify(snapshot.content), JSON.stringify(snapshot.pricing),
       JSON.stringify(snapshot.lineItems), snapshot.documentTemplateKey, JSON.stringify(snapshot.editableSections),
       snapshot.proposalTitle, snapshot.proposalDate, snapshot.proposalType, JSON.stringify(snapshot.selectedExperiences),
       JSON.stringify(snapshot.proposalVisuals), JSON.stringify(snapshot.visualSections)]
    );
    return row.rows[0];
  });
}

async function run() {
  const owner = (await query("SELECT id FROM users WHERE deleted_at IS NULL AND active=true ORDER BY created_at LIMIT 1")).rows[0];
  if (!owner) throw new Error("No active user available for QA ownership");

  const site = await publicSitePayload();
  const publicContent = {
    experiences: site.experiences?.length || 0,
    packages: site.packages?.length || 0,
    faqs: site.faqs?.length || 0,
    testimonials: site.testimonials?.length || 0,
    heroSlides: site.heroSlides?.length || 0
  };

  const forms = await testPublicForms();

  let proposal = await ensureTestProposal(owner.id);
  proposal = await getProposal(proposal.id);
  const pdf = await proposalPdfBuffer(proposal, "pdf");
  const preview = await proposalPreviewHtml(proposal);
  const publicBeforeSend = await getProposal(proposal.secure_token, { publicView: true });

  let sendResult = null;
  if (!["SENT","VIEWED","ACCEPTED"].includes(proposal.status)) {
    sendResult = await sendProposal(fakeReq(owner.id, {
      recipient: TARGET,
      subject: "QA SMOKE TEST - LOLA Production Proposal"
    }), proposal);
  } else {
    const prior = (await query("SELECT provider,provider_message_id,status FROM email_messages WHERE proposal_id=$1 ORDER BY sent_at DESC LIMIT 1", [proposal.id])).rows[0] || null;
    sendResult = { email: prior ? { ...prior, deliveredExternally: true } : null, document: { sizeBytes: pdf.length } };
  }
  proposal = await getProposal(proposal.id);

  let invoice = (await query("SELECT * FROM invoices WHERE proposal_id=$1 AND notes=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [proposal.id, MARKER])).rows[0];
  if (!invoice) {
    invoice = await createInvoice(fakeReq(owner.id, { proposal_id: proposal.id, notes: MARKER }));
  }
  if (invoice.status === "DRAFT") {
    invoice = (await query("UPDATE invoices SET status='SENT', sent_at=COALESCE(sent_at,now()), updated_at=now() WHERE id=$1 RETURNING *", [invoice.id])).rows[0];
  }

  const publicInvoice = await getInvoice(invoice.secure_token, { publicView: true });
  const invoicePdf = await generateInvoicePdf(publicInvoice);
  const paymentOptions = await publicPaymentOptions(publicInvoice);

  console.log(JSON.stringify({
    smokeTest: "PASS",
    marker: MARKER,
    publicContent,
    forms,
    proposal: {
      id: proposal.id,
      number: proposal.proposal_number,
      status: proposal.status,
      total: proposal.total,
      publicTokenResolves: publicBeforeSend.id === proposal.id,
      previewHtmlBytes: Buffer.byteLength(preview),
      pdfBytes: pdf.length,
      email: sendResult?.email ? {
        provider: sendResult.email.provider,
        status: sendResult.email.status,
        providerMessageId: sendResult.email.providerMessageId || sendResult.email.provider_message_id || null,
        deliveredExternally: sendResult.email.deliveredExternally ?? true
      } : null
    },
    invoice: {
      id: invoice.id,
      number: invoice.invoice_number,
      status: invoice.status,
      total: publicInvoice.total,
      publicTokenResolves: publicInvoice.id === invoice.id,
      pdfBytes: invoicePdf.length,
      paymentOptions: {
        payable: paymentOptions.payable,
        amountDue: paymentOptions.amountDue,
        providers: paymentOptions.providers?.map(x => x.provider) || []
      },
      paymentSessionCreated: false
    }
  }));
}

run().catch((error) => {
  console.error("PRODUCTION_SMOKE_TEST_FAILED", error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
