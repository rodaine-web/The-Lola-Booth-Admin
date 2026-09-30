import test from "node:test";
import assert from "node:assert/strict";
import { inquirySchema } from "../server/src/services/public-form-schema.js";
import { normalizeWebsiteLead } from "../server/src/services/social-lead-service.js";
import { sendPublicInquiryEmails } from "../server/src/services/public-form-email-service.js";
const contact = {
  formKind: "CONTACT",
  firstName: "QA",
  lastName: "Contact",
  email: "qa@example.invalid",
  topic: "Partnership opportunity",
  company: "QA Studio",
  message: "A venue partnership question.",
};
test("contact accepts a message without booking details and drops injected event fields", () => {
  const parsed = inquirySchema.parse({
    ...contact,
    eventDate: "2027-01-10",
    eventType: "Wedding",
    guestCount: 20,
    marketing_email_opt_in: true,
  });
  assert.equal(parsed.eventDate, undefined);
  assert.equal(parsed.eventType, undefined);
  assert.equal(parsed.marketing_email_opt_in, false);
  const lead = normalizeWebsiteLead(parsed);
  assert.equal(lead.source_subtype, "CONTACT");
  assert.equal(lead.event_date, null);
  assert.equal(lead.company, "QA Studio");
  assert.match(lead.message, /Partnership opportunity/);
});
test("contact requires a topic and message; booking still requires event logistics", () => {
  assert.equal(
    inquirySchema.safeParse({ ...contact, message: "" }).success,
    false,
  );
  assert.equal(
    inquirySchema.safeParse({ ...contact, topic: undefined }).success,
    false,
  );
  const result = inquirySchema.safeParse({ ...contact, formKind: "BOOKING" });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((i) => i.path[0] === "eventDate"));
});
test("each distinct submission is notified while retries retain the same identity", () => {
  const a = {
    ...contact,
    submissionId: "00000000-0000-4000-8000-000000000001",
  };
  const b = {
    ...contact,
    submissionId: "00000000-0000-4000-8000-000000000002",
  };
  assert.equal(
    normalizeWebsiteLead(a).external_lead_id,
    normalizeWebsiteLead(a).external_lead_id,
  );
  assert.notEqual(
    normalizeWebsiteLead(a).external_lead_id,
    normalizeWebsiteLead(b).external_lead_id,
  );
});
for (const kind of ["CONTACT", "BOOKING"])
  test(`${kind} routes exactly one owner notification and a distinct acknowledgment`, async () => {
    const messages = [];
    const payload =
      kind === "CONTACT"
        ? contact
        : {
            ...contact,
            formKind: kind,
            form_id: "booking",
            eventDate: "2027-01-10",
            eventType: "Wedding",
          };
    await sendPublicInquiryEmails({
      lead: {
        id: "qa",
        first_name: "QA",
        last_name: "Contact",
        email: contact.email,
      },
      payload,
      action: "CREATED_LEAD",
      ownerRecipient: "info@thelolabooth.com",
      sendEmailImpl: async (message) => messages.push(message),
    });
    assert.equal(
      messages.filter((m) => m.to === "info@thelolabooth.com").length,
      1,
    );
    assert.equal(messages.length, 2);
    assert.match(
      messages[0].subject,
      kind === "CONTACT" ? /Contact Message/ : /Booking Request/,
    );
    if (kind === "CONTACT") {
      assert.doesNotMatch(messages[0].body, /Event date|TBD/);
      assert.doesNotMatch(messages[1].html, /Event details|Event date|TBD/);
      assert.match(messages[1].subject, /message/);
    }
  });
test("retry replay does not notify owner or customer again", async () => {
  let sent = 0;
  await sendPublicInquiryEmails({
    lead: { id: "qa" },
    payload: contact,
    action: "IDEMPOTENT_REPLAY",
    sendEmailImpl: async () => sent++,
  });
  assert.equal(sent, 0);
});


test("approved legacy Contact payload remains compatible without booking semantics", () => {
  const contact = inquirySchema.parse({firstName:"Legacy",lastName:"QA",email:"qa@example.com",form_id:"contact",eventDate:"2027-10-10",eventType:"Other",city:"Chicago",state:"IL"});
  assert.equal(contact.formKind,"CONTACT");
  assert.equal(contact.topic,"General inquiry");
  assert.equal(contact.eventDate,undefined);
  assert.equal(contact.eventType,undefined);
});
