import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { defaultNotificationSettings } from "../shared/gallery-notification-policy.js";
test(
  "Gallery publication, 400-recipient approval, safe dispatch and scoped identity lifecycle",
  { skip: !process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL, timeout: 180000 },
  async (t) => {
    const url = new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.match(url.pathname, /_qa$/);
    const schema = "gallery_notify_" + crypto.randomBytes(6).toString("hex"),
      bootstrap = new pg.Pool({ connectionString: url.toString() }),
      storage = await fs.mkdtemp(path.join(os.tmpdir(), "lola-notifications-"));
    let db;
    const originalFetch = globalThis.fetch;
    try {
      await bootstrap.query("CREATE SCHEMA " + schema);
      url.searchParams.set("options", "-c search_path=" + schema + ",public");
      Object.assign(process.env, {
        DATABASE_URL: url.toString(),
        APP_ENV: "test",
        NODE_ENV: "test",
        JWT_SECRET: "synthetic-gallery-notify-signing-secret",
        INTEGRATION_SECRET_KEY: "synthetic-gallery-notify-encryption-key",
        CLIENT_ORIGIN: "http://localhost:5173",
        GALLERY_ENABLED: "true",
        GALLERY_STORAGE_PROVIDER: "local",
        GALLERY_LOCAL_ROOT: storage,
        EMAIL_PROVIDER: "development",
        SMS_PROVIDER: "none",
        KEEPSAKES_ENABLED: "true",
      });
      db = await import("../server/src/db/pool.js");
      const { query, transaction } = db,
        one = async (s, p = []) => (await query(s, p)).rows[0];
      for (const f of (
        await fs.readdir(new URL("../server/migrations/", import.meta.url))
      )
        .filter((f) => /^\d{3}_.*\.sql$/.test(f))
        .sort())
        await transaction(() =>
          fs
            .readFile(
              new URL("../server/migrations/" + f, import.meta.url),
              "utf8",
            )
            .then(query),
        );
      const user = await one(
        "INSERT INTO users(name,email,password_hash) VALUES('Notification QA','notify-admin@example.invalid','no-login') RETURNING id",
      );
      user.roles = ["ADMIN"];
      user.permissions = ["*"];
      const gallery =
          await import("../server/src/services/private-gallery-service.js"),
        n =
          await import("../server/src/services/gallery-notification-service.js"),
        access =
          await import("../server/src/services/keepsakes-photo-access-service.js"),
        { encryptSecretJson, decryptSecretJson } =
          await import("../server/src/services/integration-secrets.js");
      const event = await one(
          "INSERT INTO events(event_name,event_type,event_date) VALUES('Synthetic notification event','Wedding','2035-11-18') RETURNING id",
        ),
        album = await gallery.createGalleryAlbum(
          event.id,
          "Synthetic notification event",
          user,
        );
      await query("UPDATE gallery_albums SET retention_days=30 WHERE id=$1", [
        album.id,
      ]);
      const bytes = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "#b58d6c" },
      })
        .jpeg()
        .toBuffer();
      const media = await gallery.uploadGalleryMedia(album.id, {
        filename: "synthetic.jpg",
        mime_type: "image/jpeg",
        base64: bytes.toString("base64"),
      });
      const key = await gallery.createGalleryKey(
        album.id,
        "ALBUM",
        null,
        null,
        user,
      );
      async function add(
        channel,
        value,
        {
          consent = true,
          ref = null,
          targetAlbum = album.id,
          targetMedia = media.id,
        } = {},
      ) {
        const fingerprint = n.notificationContactHash(channel, value),
          p = await one(
            "INSERT INTO gallery_people(album_id,display_name,external_ref) VALUES($1,$2,$3) RETURNING id",
            [targetAlbum, "Synthetic guest", ref || "fiesta:" + fingerprint],
          );
        await query(
          "INSERT INTO fiesta_gallery_shares(album_id,person_id,filename,channel,recipient_ciphertext,capture_ref,source_share_time) VALUES($1,$2,'synthetic.jpg',$3,$4,'synthetic','2035-11-18')",
          [targetAlbum, p.id, channel, encryptSecretJson({ recipient: value })],
        );
        await query(
          "INSERT INTO gallery_media_people(album_id,media_id,person_id) VALUES($1,$2,$3)",
          [targetAlbum, targetMedia, p.id],
        );
        if (consent)
          await n.authorizeNotification(
            targetAlbum,
            {
              personId: p.id,
              channel,
              evidence:
                "Synthetic guest explicitly requested transactional photo delivery during test capture.",
              authorized: true,
            },
            user,
          );
        return p;
      }
      for (let i = 0; i < 400; i++)
        await add("SMS", "+1312555" + String(1000 + i));
      await add("EMAIL", "guest@example.invalid");
      await add("SMS", "+13125551000", {
        ref: "fiesta-reviewed:synthetic-duplicate",
      });
      await add("SMS", "+442071234567");
      await add("SMS", "+13125559001", { consent: false });
      await add("SMS", "+13125559002");
      await query(
        "INSERT INTO gallery_notification_suppressions(contact_hash,channel,reason) VALUES($1,'SMS','SYNTHETIC_STOP')",
        [n.notificationContactHash("SMS", "+13125559002")],
      );
      const config = {
        ...defaultNotificationSettings,
        enabled: true,
        baseMicros: 8000,
        carrierMicros: 3000,
        feeMicros: 1000,
        pricingEvidence: "Synthetic test rates only; not commercial prices",
        galleryLimitMicros: 20000000,
      };
      await n.saveNotificationSettings(config, user);
      let networkCalls = 0;
      globalThis.fetch = async () => {
        networkCalls++;
        throw Error("No external network allowed in synthetic delivery tests");
      };
      await t.test(
        "prepare sends nothing; publication atomically queues email and reviews 400 deduplicated authorized SMS recipients",
        async () => {
          assert.equal(
            (await one("SELECT count(*)::int n FROM communications")).n,
            0,
          );
          await gallery.transitionGalleryAlbum(album.id, "PUBLISHED", user);
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_notification_deliveries WHERE channel='EMAIL'",
              )
            ).n,
            1,
          );
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_notification_deliveries WHERE channel='SMS'",
              )
            ).n,
            0,
          );
        },
      );
      await t.test(
        "queued Gallery email recipients and verification content cannot be retargeted in Communications",
        async () => {
          const automation =
            await import("../server/src/services/automation-service.js");
          const c = await one(
            "SELECT id FROM communications WHERE trigger_key='GALLERY_PUBLICATION'",
          );
          await assert.rejects(
            automation.updateCommunicationDraft(
              c.id,
              { recipient: "attacker@example.invalid" },
              user,
            ),
            { code: "GALLERY_NOTIFICATION_IMMUTABLE" },
          );
          await assert.rejects(automation.sendCommunication(c.id, user), {
            code: "GALLERY_NOTIFICATION_JOB_REQUIRED",
          });
        },
      );
      let review = await n.reviewGallerySms(album.id, user);
      assert.equal(review.eligible, 400);
      assert.equal(review.duplicates, 1);
      assert.equal(review.consentExcluded, 2);
      assert.ok(review.segments >= 400);
      assert.ok(review.estimatedMicros > 0);
      await t.test(
        "cancel keeps publication and email, sends zero SMS",
        async () => {
          await n.decideGallerySms(album.id, review.id, "CANCELED", user);
          assert.equal(
            (
              await one("SELECT status FROM gallery_albums WHERE id=$1", [
                album.id,
              ])
            ).status,
            "PUBLISHED",
          );
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_notification_deliveries WHERE channel='SMS'",
              )
            ).n,
            0,
          );
        },
      );
      await t.test(
        "budget and settings changes invalidate review; no reservation can exceed cap",
        async () => {
          await n.saveNotificationSettings(
            { ...config, monthlyBudgetMicros: 1 },
            user,
          );
          const over = await n.reviewGallerySms(album.id, user);
          assert.ok(over.reasons.includes("Monthly budget exceeded."));
          await assert.rejects(
            n.decideGallerySms(album.id, over.id, "APPROVED", user),
          );
          await n.saveNotificationSettings(config, user);
          await assert.rejects(
            n.decideGallerySms(album.id, over.id, "APPROVED", user),
          );
        },
      );
      review = await n.reviewGallerySms(album.id, user);
      const reviewed = decryptSecretJson(
        (
          await one(
            "SELECT recipients_ciphertext FROM gallery_notification_reviews WHERE id=$1",
            [review.id],
          )
        ).recipients_ciphertext,
      ).recipients;
      await t.test(
        "concurrent repeated confirmation submits only the specific reviewed recipient set once",
        async () => {
          const results = await Promise.all([
            n.decideGallerySms(album.id, review.id, "APPROVED", user),
            n.decideGallerySms(album.id, review.id, "APPROVED", user),
          ]);
          assert.ok(results.some((r) => r.duplicatePrevented));
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_notification_deliveries WHERE channel='SMS'",
              )
            ).n,
            400,
          );
          assert.equal(
            Number(
              (
                await one(
                  "SELECT reserved_micros FROM gallery_notification_budgets",
                )
              ).reserved_micros,
            ),
            review.estimatedMicros,
          );
        },
      );
      await t.test(
        "approved dispatch stays simulated; emails use existing development transport, no unrelated SMS",
        async () => {
          await n.processGalleryNotifications({ limit: 500 });
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_notification_deliveries WHERE channel='SMS' AND status='SIMULATED'",
              )
            ).n,
            400,
          );
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM communications WHERE channel='SMS'",
              )
            ).n,
            0,
          );
          assert.equal(networkCalls, 0);
          assert.equal(
            Number(
              (
                await one(
                  "SELECT reserved_micros FROM gallery_notification_budgets",
                )
              ).reserved_micros,
            ),
            0,
          );
        },
      );
      await t.test(
        "revisit and republish do not resend; incremental guests are reviewed separately",
        async () => {
          await gallery.transitionGalleryAlbum(album.id, "PUBLISHED", user);
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_notification_deliveries WHERE channel='EMAIL'",
              )
            ).n,
            1,
          );
          const empty = await n.reviewGallerySms(album.id, user);
          assert.equal(empty.eligible, 0);
          assert.equal(empty.alreadyNotified, 400);
          await add("SMS", "+13125559999");
          assert.equal((await n.reviewGallerySms(album.id, user)).eligible, 1);
        },
      );
      await t.test(
        "SMS access exposes no photographs before email verification; verification grants only token-scoped access",
        async () => {
          const code = reviewed[0].code;
          assert.equal(
            (await n.inspectPhoneAccess(code)).emailVerificationRequired,
            true,
          );
          await n.requestPhoneEmailVerification(
            code,
            "verified@example.invalid",
          );
          const email = await one(
            "SELECT * FROM communications WHERE trigger_key='GALLERY_EMAIL_VERIFICATION'",
          );
          const verifyCode = /#code=([\w-]+)/.exec(email.rendered_body)[1];
          const session = await n.verifyPhoneEmail(verifyCode);
          const view = await access.photoCollection(session.token);
          assert.equal(view.albums.length, 1);
          assert.equal(view.assets.length, 1);
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_trusted_phone_emails",
              )
            ).n,
            0,
          );
          await assert.rejects(n.verifyPhoneEmail(verifyCode));
          await assert.rejects(n.inspectPhoneAccess(code));
          await query(
            "UPDATE gallery_phone_access SET revoked_at=now() WHERE token_hash=$1",
            [crypto.createHash("sha256").update(code).digest("hex")],
          );
          assert.equal(
            (await access.photoCollection(session.token)).assets.length,
            0,
          );
        },
      );
      await t.test(
        "forwarded, expired and revoked tokens cannot claim permanent phone ownership or bypass permissions",
        async () => {
          const code = reviewed[1].code;
          await n.requestPhoneEmailVerification(
            code,
            "forwarded@example.invalid",
          );
          const email = await one(
            "SELECT * FROM communications WHERE recipient='forwarded@example.invalid'",
          );
          await query(
            "UPDATE gallery_access_keys SET status='REVOKED' WHERE id=$1",
            [key.id],
          );
          await assert.rejects(
            n.verifyPhoneEmail(/#code=([\w-]+)/.exec(email.rendered_body)[1]),
          );
          await query(
            "UPDATE gallery_access_keys SET status='ACTIVE' WHERE id=$1",
            [key.id],
          );
          await query(
            "UPDATE gallery_phone_access SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
            [crypto.createHash("sha256").update(code).digest("hex")],
          );
          await assert.rejects(n.inspectPhoneAccess(code));
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_trusted_phone_emails",
              )
            ).n,
            0,
          );
        },
      );
      await t.test(
        "phone lookup never binds arbitrary email, sends no SMS and stays neutral for unknown or unverified phones",
        async () => {
          const before = (
            await one("SELECT count(*)::int n FROM communications")
          ).n;
          const known = await access.requestPhotoAccess({
              channel: "PHONE",
              value: reviewed[2].recipient,
              email: "attacker@example.invalid",
            }),
            unknown = await access.requestPhotoAccess({
              channel: "PHONE",
              value: "+13125550000",
              email: "attacker@example.invalid",
            });
          assert.deepEqual(known, unknown);
          assert.equal(
            (await one("SELECT count(*)::int n FROM communications")).n,
            before,
          );
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM keepsakes_unverified_contacts",
              )
            ).n,
            0,
          );
        },
      );
      await t.test(
        "trusted preexisting ownership sends only to the trusted verified email, never caller-supplied email or SMS",
        async () => {
          const phone = reviewed[3].recipient;
          await query(
            "INSERT INTO gallery_trusted_phone_emails(phone_hash,email_ciphertext,evidence,verified_at) VALUES($1,$2,'Synthetic preexisting secure ownership evidence',now())",
            [
              n.notificationContactHash("SMS", phone),
              encryptSecretJson({ email: "trusted@example.invalid" }),
            ],
          );
          await access.requestPhotoAccess({
            channel: "PHONE",
            value: phone,
            email: "attacker@example.invalid",
          });
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM communications WHERE recipient='trusted@example.invalid'",
              )
            ).n,
            1,
          );
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM communications WHERE recipient='attacker@example.invalid'",
              )
            ).n,
            0,
          );
        },
      );
      await t.test(
        "queued consent is rechecked at dispatch, not only review time",
        async () => {
          const inc = await n.reviewGallerySms(album.id, user);
          await n.decideGallerySms(album.id, inc.id, "APPROVED", user);
          await query(
            "INSERT INTO gallery_notification_suppressions(contact_hash,channel,reason) VALUES($1,'SMS','SYNTHETIC_STOP')",
            [n.notificationContactHash("SMS", "+13125559999")],
          );
          await n.processGalleryNotifications({ limit: 20 });
          assert.equal(
            (
              await one(
                "SELECT status FROM gallery_notification_deliveries WHERE contact_hash=$1",
                [n.notificationContactHash("SMS", "+13125559999")],
              )
            ).status,
            "SUPPRESSED",
          );
        },
      );
      await t.test(
        "provider failure is visible, terminal callbacks are monotonic and do not queue retries",
        async () => {
          Object.assign(process.env, {
            TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
            TWILIO_MESSAGING_SERVICE_SID: "MG" + "b".repeat(32),
          });
          const sid = "SM" + "c".repeat(32),
            d = await one(
              "SELECT * FROM gallery_notification_deliveries WHERE channel='SMS' LIMIT 1",
            );
          await query(
            "UPDATE gallery_notification_deliveries SET provider_sid=$2,status='SENT' WHERE id=$1",
            [d.id, sid],
          );
          const callback = {
            AccountSid: process.env.TWILIO_ACCOUNT_SID,
            MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
            MessageSid: sid,
            MessageStatus: "undelivered",
            ErrorCode: "30007",
          };
          await n.galleryTwilioCallback(callback);
          await n.galleryTwilioCallback({
            ...callback,
            MessageStatus: "queued",
          });
          assert.equal(
            (
              await one(
                "SELECT status FROM gallery_notification_deliveries WHERE id=$1",
                [d.id],
              )
            ).status,
            "UNDELIVERED",
          );
          const panel = await n.notificationPanel(album.id);
          assert.ok(panel.deliveries.some((r) => r.failure_code === "30007"));
          assert.ok(!JSON.stringify(panel).includes("recipient_ciphertext"));
          await n.reconcileGallerySmsCost(album.id, d.id, user, {
            fetchMessage: async () => ({
              accountSid: process.env.TWILIO_ACCOUNT_SID,
              messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
              price: "-0.024",
              priceUnit: "USD",
            }),
          });
          await n.reconcileGallerySmsCost(album.id, d.id, user, {
            fetchMessage: async () => ({
              accountSid: process.env.TWILIO_ACCOUNT_SID,
              messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
              price: "-0.024",
              priceUnit: "USD",
            }),
          });
          assert.equal(
            Number(
              (
                await one(
                  "SELECT actual_micros FROM gallery_notification_budgets",
                )
              ).actual_micros,
            ),
            24000,
          );
        },
      );
      await t.test(
        "signed Twilio webhooks suppress STOP, reject forged signatures and never generate duplicate compliance SMS",
        async () => {
          const express = (await import("express")).default,
            twilio = (await import("twilio")).default,
            { galleryTwilioRouter } =
              await import("../server/src/routes/gallery-twilio.js");
          const app = express();
          app.use("/api/gallery-twilio", galleryTwilioRouter);
          app.use((e, _req, res, _next) =>
            res.status(e.statusCode || 500).json({ code: e.code }),
          );
          const server = app.listen(0, "127.0.0.1");
          await new Promise((resolve) => server.once("listening", resolve));
          try {
            process.env.TWILIO_AUTH_TOKEN = "synthetic-signature-secret";
            const body = {
              AccountSid: process.env.TWILIO_ACCOUNT_SID,
              MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
              OptOutType: "STOP",
              From: "+13125558888",
            };
            const endpoint =
                "http://127.0.0.1:" +
                server.address().port +
                "/api/gallery-twilio/inbound",
              headers = { "Content-Type": "application/x-www-form-urlencoded" };
            assert.equal(
              (
                await originalFetch(endpoint, {
                  method: "POST",
                  headers,
                  body: new URLSearchParams(body),
                })
              ).status,
              403,
            );
            const signature = twilio.getExpectedTwilioSignature(
              process.env.TWILIO_AUTH_TOKEN,
              "https://api.thelolabooth.com/api/gallery-twilio/inbound",
              body,
            );
            const good = await originalFetch(endpoint, {
              method: "POST",
              headers: { ...headers, "X-Twilio-Signature": signature },
              body: new URLSearchParams(body),
            });
            assert.equal(good.status, 200);
            assert.equal(await good.text(), "<Response/>");
            assert.ok(
              (
                await one(
                  "SELECT 1 AS n FROM gallery_notification_suppressions WHERE contact_hash=$1",
                  [n.notificationContactHash("SMS", body.From)],
                )
              ).n,
            );
            const help = { ...body, OptOutType: "HELP" };
            const helpSig = twilio.getExpectedTwilioSignature(
              process.env.TWILIO_AUTH_TOKEN,
              "https://api.thelolabooth.com/api/gallery-twilio/inbound",
              help,
            );
            assert.equal(
              await (
                await originalFetch(endpoint, {
                  method: "POST",
                  headers: { ...headers, "X-Twilio-Signature": helpSig },
                  body: new URLSearchParams(help),
                })
              ).text(),
              "<Response/>",
            );
          } finally {
            await new Promise((resolve) => server.close(resolve));
          }
        },
      );
      await t.test(
        "unrelated booking and marketing SMS remain disabled",
        async () => {
          const automation =
            await import("../server/src/services/automation-service.js");
          for (const trigger of [
            "BOOKING_REMINDER",
            "MARKETING",
            "PAYMENT",
            "ORDER",
          ]) {
            const c = await automation.createCommunicationDraft({
              channel: "SMS",
              recipient: "+13125558888",
              body: "Synthetic unrelated message",
              status: "DRAFT",
              trigger_key: trigger,
            });
            await assert.rejects(automation.sendCommunication(c.id, user), {
              code: "SMS_PROVIDER_DISABLED",
            });
          }
          assert.equal(networkCalls, 0);
        },
      );
      await t.test(
        "early delivery callbacks are retained until the provider SID is recorded",
        async () => {
          const sid = "SM" + "d".repeat(32),
            callback = {
              AccountSid: process.env.TWILIO_ACCOUNT_SID,
              MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
              MessageSid: sid,
              MessageStatus: "delivered",
            };
          await n.galleryTwilioCallback(callback);
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_twilio_callback_inbox WHERE provider_sid=$1 AND processed_at IS NULL",
                [sid],
              )
            ).n,
            1,
          );
          const d = await one(
            "SELECT id FROM gallery_notification_deliveries WHERE channel='SMS' AND provider_sid IS NULL LIMIT 1",
          );
          await query(
            "UPDATE gallery_notification_deliveries SET provider_sid=$2,status='SENT' WHERE id=$1",
            [d.id, sid],
          );
          await n.processGalleryNotifications({ limit: 1 });
          assert.equal(
            (
              await one(
                "SELECT status FROM gallery_notification_deliveries WHERE id=$1",
                [d.id],
              )
            ).status,
            "DELIVERED",
          );
          await n.galleryTwilioCallback(callback);
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_twilio_callback_inbox WHERE provider_sid=$1",
                [sid],
              )
            ).n,
            1,
          );
        },
      );
      await t.test(
        "existing CRM contact opt-outs suppress Gallery SMS without merging identities",
        async () => {
          await add("SMS", "+13125558889");
          await query(
            "INSERT INTO clients(name,email,phone,sms_opted_out_at,client_type) VALUES('Synthetic opted-out contact','optedout@example.invalid','(312) 555-8889',now(),'CORPORATE')",
          );
          const review = await n.reviewGallerySms(album.id, user);
          const payload = decryptSecretJson(
            (
              await one(
                "SELECT recipients_ciphertext FROM gallery_notification_reviews WHERE id=$1",
                [review.id],
              )
            ).recipients_ciphertext,
          );
          assert.ok(
            !payload.recipients.some((r) => r.recipient === "+13125558889"),
          );
        },
      );
      await t.test(
        "two galleries cannot concurrently reserve beyond the monthly budget",
        async () => {
          const secondEvent = await one(
            "INSERT INTO events(event_name,event_type,event_date) VALUES('Synthetic second event','Wedding','2035-11-19') RETURNING id",
          );
          const second = await gallery.createGalleryAlbum(
            secondEvent.id,
            "Synthetic second event",
            user,
          );
          await query(
            "UPDATE gallery_albums SET retention_days=30 WHERE id=$1",
            [second.id],
          );
          const image = await gallery.uploadGalleryMedia(second.id, {
            filename: "synthetic.jpg",
            mime_type: "image/jpeg",
            base64: bytes.toString("base64"),
          });
          await gallery.createGalleryKey(second.id, "ALBUM", null, null, user);
          await add("SMS", "+13125558886", {
            targetAlbum: second.id,
            targetMedia: image.id,
          });
          await gallery.transitionGalleryAlbum(second.id, "PUBLISHED", user);
          await add("SMS", "+13125558887");
          await n.saveNotificationSettings(
            { ...config, monthlyBudgetMicros: 48000 },
            user,
          );
          const [firstReview, secondReview] = await Promise.all([
            n.reviewGallerySms(album.id, user),
            n.reviewGallerySms(second.id, user),
          ]);
          assert.equal(firstReview.eligible, 1);
          assert.equal(secondReview.eligible, 1);
          const results = await Promise.allSettled([
            n.decideGallerySms(album.id, firstReview.id, "APPROVED", user),
            n.decideGallerySms(second.id, secondReview.id, "APPROVED", user),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(
            results.filter((r) => r.status === "rejected").length,
            1,
          );
          const budget = await one(
            "SELECT * FROM gallery_notification_budgets",
          );
          assert.equal(
            Number(budget.reserved_micros) + Number(budget.actual_micros),
            48000,
          );
        },
      );
      await t.test(
        "staging ignores unrestricted email flag and blocks unapproved notification recipients",
        async () => {
          await add("EMAIL", "not-an-approved-inbox@example.invalid");
          await gallery.transitionGalleryAlbum(album.id, "PUBLISHED", user);
          Object.assign(process.env, {
            APP_ENV: "staging",
            STAGING_EMAIL_ENABLED: "true",
            STAGING_EMAIL_ALLOW_ANY_RECIPIENT: "true",
            STAGING_EMAIL_ALLOWLIST: "approved-qa@example.invalid",
          });
          try {
            await n.processGalleryNotifications({ limit: 20 });
            const d = await one(
              "SELECT status,failure_code FROM gallery_notification_deliveries WHERE contact_hash=$1",
              [
                n.notificationContactHash(
                  "EMAIL",
                  "not-an-approved-inbox@example.invalid",
                ),
              ],
            );
            assert.equal(d.status, "FAILED");
            assert.equal(d.failure_code, "STAGING_RECIPIENT_BLOCKED");
            assert.equal(networkCalls, 0);
          } finally {
            process.env.APP_ENV = "test";
          }
        },
      );
      assert.equal(networkCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      await db?.pool.end();
      await bootstrap.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
      await bootstrap.end();
      await fs.rm(storage, { recursive: true, force: true });
    }
  },
);
