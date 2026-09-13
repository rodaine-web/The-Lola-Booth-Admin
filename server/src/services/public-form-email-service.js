import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
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
  const ownerTo = notificationRecipient();
  const name = submissionName(lead, payload);
  const label = formLabel(payload);

  const deliveries = [
    sendEmailImpl({
      to: ownerTo,
      subject: `New LOLA ${label} - ${name}`,
      body: ownerNotificationBody({ lead, payload, action })
    }).catch((error) => {
      logger.warn({ code: error.code, details: error.details }, "Public form owner notification failed");
      return null;
    })
  ];

  if (lead?.email || payload?.email) {
    deliveries.push(sendEmailImpl({
      to: lead.email || payload.email,
      subject: "We received your LOLA inquiry",
      body: customerConfirmationBody({ lead, payload })
    }).catch((error) => {
      logger.warn({ code: error.code, details: error.details }, "Public form customer confirmation failed");
      return null;
    }));
  }

  await Promise.all(deliveries);
}
