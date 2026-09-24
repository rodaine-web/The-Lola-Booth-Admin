import { query } from "../db/pool.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { brandedEmailHtml, recordTemplateFallback, renderCommunicationTemplateByKey } from "./automation-service.js";
import { sendEmail } from "./email-service.js";

function compact(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function senderAddress(value = "") {
  const match = String(value).match(/<([^>]+)>/);
  return match ? match[1] : String(value).trim();
}

function notificationRecipient() {
  return env.formNotificationEmail || senderAddress(env.emailFrom);
}

function formLabel(payload = {}) {
  const source = String(payload.form_id || payload.formId || payload.sourcePage || payload.landing_page_url || "").toLowerCase();
  if (source.includes("contact")) return "Contact Message";
  if (source.includes("newsletter")) return "Newsletter Signup";
  if (source.includes("referral")) return "Referral";
  return "Website Inquiry";
}

function submissionName(lead = {}, payload = {}) {
  return [lead.first_name || payload.firstName, lead.last_name || payload.lastName].filter(Boolean).join(" ").trim() || compact(payload.name) || "New lead";
}

function linesFrom(entries) {
  return entries
    .map(([label, value]) => [label, compact(value)])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function ownerNotificationBody({ lead = {}, payload = {}, action }) {
  return linesFrom([
    ["Form type", formLabel(payload)],
    ["Submission time", new Date().toISOString()],
    ["Name", submissionName(lead, payload)],
    ["Email", lead.email || payload.email],
    ["Phone", lead.phone || payload.phone],
    ["Event date", lead.event_date || payload.eventDate],
    ["Event type", lead.event_type || payload.eventType],
    ["Guest count", lead.guest_count || payload.guestCount],
    ["Preferred package", lead.preferred_package_id || payload.preferredPackageId],
    ["Preferred experience", lead.preferred_experience_id || payload.preferredExperienceId],
    ["Message", lead.message || payload.message],
    ["Source page", payload.landing_page_url || payload.sourcePage],
    ["Referrer", payload.referrer_url],
    ["UTM source", payload.utm_source],
    ["UTM medium", payload.utm_medium],
    ["UTM campaign", payload.utm_campaign],
    ["UTM content", payload.utm_content],
    ["UTM term", payload.utm_term],
    ["Result", action]
  ]);
}

function customerConfirmationBody({ lead = {}, payload = {} }) {
  const details = linesFrom([
    ["Event date", lead.event_date || payload.eventDate],
    ["Event type", lead.event_type || payload.eventType],
    ["Guest count", lead.guest_count || payload.guestCount],
    ["Message", lead.message || payload.message]
  ]);
  return [
    "THE LOLA BOOTH",
    "Good people. Better photos.",
    "",
    `Hi ${lead.first_name || payload.firstName || "there"},`,
    "",
    "Thank you for reaching out to The LOLA Booth. We received your inquiry and the LOLA team will review the details you shared.",
    details ? `\nYour details:\n${details}` : "",
    "",
    "If anything changes, you can reply to this email with updated details.",
    "",
    "LOLA Booths"
  ].filter(Boolean).join("\n");
}

export async function sendPublicInquiryEmails({ lead, payload, action, sendEmailImpl = sendEmail }) {
  // Persist email work before responding; the worker owns delivery and retry visibility.
  const deliver = sendEmailImpl === sendEmail ? async message => {
    const result = await query(
      `INSERT INTO communications (lead_id,type,channel,direction,recipient,subject,rendered_subject,message_summary,rendered_body,rendered_html,status,send_mode,scheduled_at,trigger_key)
       VALUES ($1,'EMAIL','EMAIL','OUTBOUND',$2,$3,$3,$4,$5,$6,'SCHEDULED','SCHEDULED',now(),'PUBLIC_FORM') RETURNING id`,
      [lead?.id || null,message.to,message.subject,message.body.slice(0,500),message.body,message.html || brandedEmailHtml(message.body)]);
    return result.rows[0];
  } : sendEmailImpl;
  const ownerTo = notificationRecipient();
  const name = submissionName(lead, payload);
  const label = formLabel(payload);
  const mergeData = publicInquiryMergeData({ lead, payload, action, label, name });
  const ownerFallback = { fallbackSubject: `New LOLA ${label} - ${name}`, fallbackBody: ownerNotificationBody({ lead, payload, action }), relatedEntityId: lead?.id || null };
  const ownerRendered = sendEmailImpl === sendEmail
    ? await renderPublicInquiryTemplate("public_inquiry_owner_notification", mergeData, ownerFallback)
    : { subject: ownerFallback.fallbackSubject, body: ownerFallback.fallbackBody, html: brandedEmailHtml(ownerFallback.fallbackBody) };

  const deliveries = [
    deliver({
      to: ownerTo,
      subject: ownerRendered.subject,
      body: ownerRendered.body,
      html: ownerRendered.html
    }).catch((error) => {
      logger.warn({ code: error.code, details: error.details }, "Public form owner notification failed");
      return null;
    })
  ];

  if (lead?.email || payload?.email) {
    const customerFallback = { fallbackSubject: "We received your LOLA inquiry", fallbackBody: customerConfirmationBody({ lead, payload }), relatedEntityId: lead?.id || null };
    const customerTemplateKey = label === "Contact Message" ? "CONTACT_CONFIRMATION" : "BOOKING_INQUIRY_CONFIRMATION";
    const legacyCustomerTemplateKey = "public_inquiry_customer_confirmation";
    const customerRendered = sendEmailImpl === sendEmail
      ? await renderPublicInquiryTemplate(customerTemplateKey, mergeData, customerFallback, {
        firstName: lead.first_name || payload.firstName || "there",
        kicker: label === "Contact Message" ? "Thank you for reaching out!" : "Your booking inquiry has been received!",
        ctaLabel: label === "Contact Message" ? "Let's Make It Happen" : "View Your Inquiry",
        ctaUrl: env.publicBaseUrl,
        event: {
          date: lead.event_date || payload.eventDate,
          venue: lead.venue_name || payload.venueName || [payload.city, payload.state].filter(Boolean).join(", "),
          type: lead.event_type || payload.eventType,
          packageName: lead.guest_count || payload.guestCount ? `Approximately ${lead.guest_count || payload.guestCount}` : ""
        }
      })
      : { subject: customerFallback.fallbackSubject, body: customerFallback.fallbackBody, html: brandedEmailHtml(customerFallback.fallbackBody) };
    if (!customerRendered && legacyCustomerTemplateKey) await renderPublicInquiryTemplate("public_inquiry_customer_confirmation", mergeData, customerFallback);
    deliveries.push(deliver({
      to: lead.email || payload.email,
      subject: customerRendered.subject,
      body: customerRendered.body,
      html: customerRendered.html
    }).catch((error) => {
      logger.warn({ code: error.code, details: error.details }, "Public form customer confirmation failed");
      return null;
    }));
  }

  await Promise.all(deliveries);
}

async function renderPublicInquiryTemplate(templateKey, mergeData, { fallbackSubject, fallbackBody, relatedEntityId }, htmlOptions = {}) {
  try {
    const rendered = await renderCommunicationTemplateByKey(templateKey, mergeData);
    if (rendered) return { ...rendered, html: brandedEmailHtml(rendered.body, htmlOptions) };
    await recordTemplateFallback({ templateKey, reason: "Active template was not found.", relatedEntityType: "lead", relatedEntityId });
  } catch (error) {
    await recordTemplateFallback({ templateKey, reason: error.message, relatedEntityType: "lead", relatedEntityId, metadata: { code: error.code } });
  }
  return { subject: fallbackSubject, body: fallbackBody, html: htmlOptions.firstName ? brandedEmailHtml(fallbackBody, htmlOptions) : null };
}

function publicInquiryMergeData({ lead = {}, payload = {}, action, label, name }) {
  return {
    client: {
      first_name: lead.first_name || payload.firstName || "there",
      last_name: lead.last_name || payload.lastName || "",
      name,
      email: lead.email || payload.email || "",
      phone: lead.phone || payload.phone || ""
    },
    event: {
      date: lead.event_date || payload.eventDate || "TBD",
      type: lead.event_type || payload.eventType || "Event",
      guest_count: String(lead.guest_count || payload.guestCount || "")
    },
    request: {
      type: label,
      notes: lead.message || payload.message || "",
      submitted_at: new Date().toISOString(),
      source_page: payload.landing_page_url || payload.sourcePage || "",
      status: action || ""
    }
  };
}
