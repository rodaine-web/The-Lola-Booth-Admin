import test from "node:test";
import assert from "node:assert/strict";
import {
  smsSegments,
  usMobile,
  defaultNotificationSettings,
  validateNotificationSettings,
  estimateMessage,
  nextDeliveryState,
} from "../shared/gallery-notification-policy.js";
test("GSM and UCS segments account for extension characters and UTF16 emoji", () => {
  assert.equal(smsSegments("a".repeat(160)).segments, 1);
  assert.equal(smsSegments("a".repeat(161)).segments, 2);
  assert.equal(smsSegments("^".repeat(80)).segments, 1);
  assert.equal(smsSegments("^".repeat(81)).segments, 2);
  assert.equal(smsSegments("漢".repeat(70)).segments, 1);
  assert.equal(smsSegments("漢".repeat(71)).segments, 2);
  assert.equal(smsSegments("😀".repeat(35)).segments, 1);
  assert.equal(smsSegments("😀".repeat(36)).segments, 2);
  assert.equal(smsSegments("é €").encoding, "GSM-7");
  assert.equal(smsSegments("Curly ’").encoding, "UCS-2");
});
test("US normalization excludes unsupported and malformed destinations", () => {
  assert.equal(usMobile("(312) 555-0123"), "+13125550123");
  assert.equal(usMobile("13125550123"), "+13125550123");
  assert.equal(usMobile("+442071234567"), null);
  assert.equal(usMobile("+11111111111"), null);
});
test("rates are explicit, segmented and cannot default to an invented rate", () => {
  const link =
    "https://staginggallery.thelolabooth.com/photos/phone-access#code=" +
    "x".repeat(43);
  assert.equal(
    estimateMessage(
      defaultNotificationSettings.template,
      link,
      defaultNotificationSettings,
    ).costMicros,
    null,
  );
  const s = {
    ...defaultNotificationSettings,
    baseMicros: 8000,
    carrierMicros: 3000,
    feeMicros: 1000,
    pricingEvidence: "Synthetic pricing fixture, not commercial rates",
  };
  const e = estimateMessage(s.template, link, s);
  assert.equal(e.costMicros, e.segments * 12000);
  assert.ok(e.segments > 1);
});
test("templates enforce one secure link, STOP HELP and identification; costs and limits reject unsafe values", () => {
  assert.throws(() =>
    validateNotificationSettings({
      ...defaultNotificationSettings,
      maxSegments: -1,
    }),
  );
  assert.throws(() =>
    validateNotificationSettings({
      ...defaultNotificationSettings,
      baseMicros: 0.1,
    }),
  );
  assert.throws(() =>
    validateNotificationSettings({
      ...defaultNotificationSettings,
      template: "Click https://evil.example {{secure_photo_link}}",
    }),
  );
  assert.throws(() =>
    validateNotificationSettings({
      ...defaultNotificationSettings,
      template: "The Lola Booth {{secure_photo_link}} {{name}} STOP HELP",
    }),
  );
  assert.throws(() =>
    validateNotificationSettings({
      ...defaultNotificationSettings,
      enabled: "true",
    }),
  );
  assert.equal(
    validateNotificationSettings(defaultNotificationSettings).enabled,
    false,
  );
});
test("callbacks cannot downgrade terminal states or roll sent back to queued", () => {
  assert.equal(nextDeliveryState("SENT", "queued"), "SENT");
  assert.equal(nextDeliveryState("SENT", "delivered"), "DELIVERED");
  assert.equal(nextDeliveryState("DELIVERED", "failed"), "DELIVERED");
  assert.equal(nextDeliveryState("SUBMITTING", "failed"), "FAILED");
  assert.equal(nextDeliveryState("FAILED", "queued"), "FAILED");
});

test("official Messaging Service adapter cannot contact Twilio in staging, even with live flags", async () => {
  const { submitApprovedGallerySms } =
    await import("../server/src/services/gallery-twilio-adapter.js");
  let constructed = 0;
  const result = await submitApprovedGallerySms(
    { to: "+13125550123", body: "Synthetic approved message" },
    {
      APP_ENV: "staging",
      GALLERY_SMS_LIVE_ENABLED: "true",
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
    },
    {
      clientFactory: () => {
        constructed++;
        throw Error("Must not construct live client");
      },
    },
  );
  assert.equal(result.simulated, true);
  assert.equal(constructed, 0);
  await assert.rejects(
    submitApprovedGallerySms(
      { to: "+13125550123", body: "Synthetic approved message" },
      { APP_ENV: "production" },
    ),
    { code: "GALLERY_SMS_LIVE_NOT_APPROVED" },
  );
});
test("future release adapter submits exact reviewed body through Messaging Services without SDK retries", async () => {
  const { submitApprovedGallerySms } =
    await import("../server/src/services/gallery-twilio-adapter.js");
  let submitted;
  const config = {
    APP_ENV: "production",
    GALLERY_SMS_LIVE_ENABLED: "true",
    TWILIO_SENDER_REGISTRATION_REVIEWED: "true",
    TWILIO_SENDER_REGISTRATION_EVIDENCE: "Synthetic registration fixture only",
    TWILIO_MESSAGING_SERVICE_SID: "MG" + "b".repeat(32),
  };
  const result = await submitApprovedGallerySms(
    { to: "+13125550123", body: "The Lola Booth synthetic approved body" },
    config,
    {
      clientFactory: () => ({
        messages: {
          create: async (input) => {
            submitted = input;
            return { sid: "SM" + "c".repeat(32), status: "queued" };
          },
        },
      }),
    },
  );
  assert.equal(result.simulated, false);
  assert.equal(submitted.body, "The Lola Booth synthetic approved body");
  assert.equal(
    submitted.messagingServiceSid,
    config.TWILIO_MESSAGING_SERVICE_SID,
  );
  assert.equal(submitted.shortenUrls, false);
});
