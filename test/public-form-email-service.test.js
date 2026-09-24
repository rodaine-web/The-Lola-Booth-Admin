import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { sendPublicInquiryEmails } from "../server/src/services/public-form-email-service.js";

const envSource = fs.readFileSync(new URL("../server/src/config/env.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../server/src/routes/public.js", import.meta.url), "utf8");

test("public inquiry route sends form emails after successful persistence", () => {
  assert.match(publicRoutes, /sendPublicInquiryEmails/);
  assert.match(publicRoutes, /res\.status\(201\)\.json/);
  assert.match(publicRoutes, /await sendPublicInquiryEmails/);
});

test("FORM_NOTIFICATION_EMAIL is a server-side provider-specific setting", () => {
  assert.match(envSource, /FORM_NOTIFICATION_EMAIL/);
  assert.match(envSource, /formNotificationEmail/);
});

test("public form email helper sends owner and customer emails without throwing", async () => {
  const sent = [];
  const sendEmailImpl = async (message) => {
    sent.push(message);
    return { provider: "development", status: "SENT", deliveredExternally: false };
  };

  await sendPublicInquiryEmails({
    lead: { first_name: "LOLA", last_name: "E2E Test", email: "qa@example.com", phone: "555-0100", event_type: "Wedding", event_date: "2026-12-12" },
    payload: { form_id: "availability", landing_page_url: "https://thelolabooth.com/availability.html", utm_campaign: "qa" },
    action: "CREATED_LEAD",
    sendEmailImpl
  });

  assert.equal(sent.length, 2);
  assert.match(sent[0].subject, /New LOLA Website Inquiry - LOLA E2E Test/);
  assert.match(sent[0].body, /Form type: Website Inquiry/);
  assert.match(sent[0].body, /UTM campaign: qa/);
  assert.equal(sent[1].to, "qa@example.com");
  assert.equal(sent[1].subject, "We received your LOLA inquiry");
});
