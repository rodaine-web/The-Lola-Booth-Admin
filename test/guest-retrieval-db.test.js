import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { maskRetrievalEmail } from "../shared/guest-retrieval-policy.js";
test("masked retrieval email hides the full local part and domain", () => {
  assert.equal(maskRetrievalEmail("jordan@gmail.com"), "j••••@g••••.com");
  assert.equal(maskRetrievalEmail("a@b.example.com"), "a••••@b••••.com");
  assert.equal(maskRetrievalEmail("invalid"), null);
});
test(
  "event-scoped unverified guest retrieval, masked confirmation, correction and durable abuse limits",
  { skip: !process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL, timeout: 180000 },
  async (t) => {
    const url = new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.match(url.pathname, /_qa$/);
    const schema = "guest_retrieval_" + crypto.randomBytes(6).toString("hex"),
      bootstrap = new pg.Pool({ connectionString: url.toString() }),
      storage = await fs.mkdtemp(
        path.join(os.tmpdir(), "lola-guest-retrieval-"),
      );
    let db;
    const realFetch = globalThis.fetch;
    try {
      await bootstrap.query("CREATE SCHEMA " + schema);
      url.searchParams.set("options", "-c search_path=" + schema + ",public");
      Object.assign(process.env, {
        DATABASE_URL: url.toString(),
        APP_ENV: "test",
        NODE_ENV: "test",
        JWT_SECRET: "synthetic-guest-retrieval-signing-key",
        INTEGRATION_SECRET_KEY: "synthetic-guest-retrieval-encryption-key",
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
      const migrations = (
        await fs.readdir(new URL("../server/migrations/", import.meta.url))
      )
        .filter((f) => /^\d{3}_.*\.sql$/.test(f))
        .sort();
      for (const f of migrations.filter((f) => !f.startsWith("097_")))
        await transaction(() =>
          fs
            .readFile(
              new URL("../server/migrations/" + f, import.meta.url),
              "utf8",
            )
            .then(query),
        );
      const user = await one(
        "INSERT INTO users(name,email,password_hash) VALUES('Retrieval QA','retrieval-admin@example.invalid','no-login') RETURNING id",
      );
      user.roles = ["ADMIN"];
      user.permissions = ["*"];
      const gallery =
          await import("../server/src/services/private-gallery-service.js"),
        access =
          await import("../server/src/services/keepsakes-photo-access-service.js"),
        automation =
          await import("../server/src/services/automation-service.js"),
        { encryptSecretJson, decryptSecretJson } =
          await import("../server/src/services/integration-secrets.js");
      const hash = (kind, value) =>
          crypto
            .createHmac("sha256", process.env.INTEGRATION_SECRET_KEY)
            .update(kind + ":" + value)
            .digest("hex"),
        sha = (value) =>
          crypto.createHash("sha256").update(value).digest("hex");
      const bytes = await sharp({
        create: { width: 150, height: 100, channels: 3, background: "#b58d6c" },
      })
        .jpeg()
        .toBuffer();
      async function fixture(phone, name) {
        const e = await one(
          "INSERT INTO events(event_name,event_type,event_date) VALUES($1,'Wedding','2035-11-18') RETURNING id",
          [name],
        );
        const a = await gallery.createGalleryAlbum(e.id, name, user);
        const m = await gallery.uploadGalleryMedia(a.id, {
          filename: "guest.jpg",
          mime_type: "image/jpeg",
          base64: bytes.toString("base64"),
        });
        await query(
          "UPDATE gallery_albums SET status='PUBLISHED',expires_at=now()+interval '1 year' WHERE id=$1",
          [a.id],
        );
        const k = await gallery.createGalleryKey(
          a.id,
          "ALBUM",
          null,
          null,
          user,
        );
        const p = await one(
          "INSERT INTO gallery_people(album_id,display_name,external_ref) VALUES($1,'Synthetic Guest',$2) RETURNING id",
          [a.id, "fiesta:" + hash("SMS", phone)],
        );
        await query(
          "INSERT INTO fiesta_gallery_shares(album_id,person_id,filename,channel,recipient_ciphertext,capture_ref,source_share_time) VALUES($1,$2,'guest.jpg','SMS',$3,'synthetic','2035-11-18')",
          [a.id, p.id, encryptSecretJson({ recipient: phone })],
        );
        await query(
          "INSERT INTO gallery_media_people(album_id,media_id,person_id) VALUES($1,$2,$3)",
          [a.id, m.id, p.id],
        );
        return {
          phone,
          album: a,
          person: p,
          key: k,
          media: m,
          scope: { albumId: a.id, personId: p.id, keyId: k.id },
        };
      }
      const legacy = await fixture("+13125550911", "Legacy safe"),
        conflict = await fixture("+13125550912", "Legacy conflict");
      async function historic(f, email) {
        const request = await one(
          "INSERT INTO keepsakes_photo_requests(target_hash,token_hash,scopes,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes') RETURNING id",
          [
            hash("SMS", f.phone),
            sha(crypto.randomBytes(32).toString("hex")),
            JSON.stringify([f.scope]),
          ],
        );
        await query(
          "INSERT INTO keepsakes_unverified_contacts(phone_hash,email_hash,contact_ciphertext,request_id) VALUES($1,$2,$3,$4)",
          [
            hash("SMS", f.phone),
            hash("EMAIL", email),
            encryptSecretJson({ phone: f.phone, email }),
            request.id,
          ],
        );
      }
      await historic(legacy, "legacy@example.invalid");
      await historic(conflict, "first@example.invalid");
      await historic(conflict, "second@example.invalid");
      await transaction(() =>
        fs
          .readFile(
            new URL(
              "../server/migrations/097_guest_retrieval_email.sql",
              import.meta.url,
            ),
            "utf8",
          )
          .then(query),
      );
      const guest =
        await import("../server/src/services/guest-photo-retrieval-service.js");
      const main = await fixture("+13125550123", "Main retrieval");
      const context = { ip: "192.0.2.10" };
      let start, firstCode, firstSession;
      let network = 0;
      globalThis.fetch = async () => {
        network++;
        throw Error("External network disabled in synthetic retrieval tests");
      };
      const count = async () =>
        Number(
          (
            await one(
              "SELECT count(*)::int n FROM communications WHERE trigger_key='GUEST_RETRIEVAL_EMAIL'",
            )
          ).n,
        );
      const clearLimits = () =>
        query("DELETE FROM guest_photo_retrieval_limits");
      await t.test(
        "legacy associations stay event-scoped, conflicts require review and all Galleries default to restricted",
        async () => {
          assert.equal(
            (
              await one(
                "SELECT status FROM guest_photo_retrieval_addresses WHERE phone_hash=$1",
                [hash("SMS", legacy.phone)],
              )
            ).status,
            "ACTIVE",
          );
          assert.equal(
            (
              await one(
                "SELECT status FROM guest_photo_retrieval_addresses WHERE phone_hash=$1",
                [hash("SMS", conflict.phone)],
              )
            ).status,
            "REVIEW_REQUIRED",
          );
          assert.equal(
            (await guest.beginGuestRetrieval({ phone: legacy.phone }, context))
              .maskedEmail,
            null,
          );
          assert.equal(
            (await guest.guestRetrievalAdmin(main.album.id)).restricted,
            true,
          );
        },
      );
      await guest.setGuestRetrievalRestriction(main.album.id, false, user);
      await t.test(
        "first-time guest supplies phone plus email; saves only an unverified scoped address and queues a private email link",
        async () => {
          start = await guest.beginGuestRetrieval(
            { phone: main.phone },
            context,
          );
          assert.equal(start.mode, "EMAIL_REQUIRED");
          assert.equal(start.maskedEmail, null);
          const response = await guest.confirmGuestRetrieval(
            { ...start, email: " Guest@Example.invalid " },
            context,
          );
          assert.equal(response.accepted, true);
          assert.ok(!JSON.stringify(response).includes("#code="));
          assert.equal(await count(), 1);
          const a = await one(
            "SELECT * FROM guest_photo_retrieval_addresses WHERE phone_hash=$1",
            [hash("SMS", main.phone)],
          );
          assert.equal(a.verification_status, "UNVERIFIED");
          assert.equal(a.album_id, main.album.id);
          assert.equal(
            decryptSecretJson(a.contact_ciphertext).email,
            "guest@example.invalid",
          );
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM gallery_trusted_phone_emails",
              )
            ).n,
            0,
          );
          assert.equal((await one("SELECT count(*)::int n FROM clients")).n, 0);
          const c = await one(
            "SELECT * FROM communications WHERE trigger_key='GUEST_RETRIEVAL_EMAIL' ORDER BY created_at DESC LIMIT 1",
          );
          firstCode = /#code=([\w-]+)/.exec(c.rendered_body)[1];
          await assert.rejects(
            automation.updateCommunicationDraft(
              c.id,
              { recipient: "attacker@example.invalid" },
              user,
            ),
            { code: "GALLERY_NOTIFICATION_IMMUTABLE" },
          );
          await assert.rejects(automation.sendCommunication(c.id, user), {
            code: "GUEST_RETRIEVAL_JOB_REQUIRED",
          });
        },
      );
      await t.test(
        "dedicated email worker uses the existing transport and never sends SMS",
        async () => {
          assert.equal(
            (await guest.processGuestRetrievalEmails()).processed,
            1,
          );
          assert.equal(
            (
              await one(
                "SELECT guest_retrieval_delivery_state AS s FROM keepsakes_photo_requests WHERE guest_retrieval_delivery_state IS NOT NULL",
              )
            ).s,
            "SENT_TO_PROVIDER",
          );
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM communications WHERE channel='SMS'",
              )
            ).n,
            0,
          );
          assert.equal(network, 0);
          firstSession = await access.redeemPhotoAccess(firstCode);
          assert.equal(
            (await access.photoCollection(firstSession.token)).assets.length,
            1,
          );
        },
      );
      await t.test(
        "returning guest sees only a mask and must enter the complete normalized saved email",
        async () => {
          const returning = await guest.beginGuestRetrieval(
            { phone: main.phone, sessionToken: start.sessionToken },
            context,
          );
          assert.equal(returning.mode, "RETURNING");
          assert.equal(returning.maskedEmail, "g••••@e••••.invalid");
          assert.ok(
            !JSON.stringify(returning).includes("guest@example.invalid"),
          );
          assert.ok(!JSON.stringify(returning).includes("#code="));
          const before = await count();
          const bad = await guest.confirmGuestRetrieval(
            { ...returning, email: "different@example.invalid" },
            context,
          );
          assert.equal(await count(), before);
          await query(
            "UPDATE keepsakes_photo_requests SET created_at=now()-interval '3 minutes'",
          );
          const good = await guest.confirmGuestRetrieval(
            { ...returning, email: "GUEST@EXAMPLE.INVALID" },
            context,
          );
          assert.deepEqual(good, bad);
          assert.equal(await count(), before + 1);
          assert.equal(
            (
              await one(
                "SELECT recipient FROM communications WHERE trigger_key='GUEST_RETRIEVAL_EMAIL' ORDER BY created_at DESC LIMIT 1",
              )
            ).recipient,
            "guest@example.invalid",
          );
          await guest.confirmGuestRetrieval(
            { ...returning, email: "guest@example.invalid" },
            context,
          );
          assert.equal(
            await count(),
            before + 1,
            "Replaying confirmation cannot resend",
          );
        },
      );
      await t.test(
        "public lookup and the legacy endpoint cannot replace or bypass the saved association",
        async () => {
          const a = await one(
            "SELECT * FROM guest_photo_retrieval_addresses WHERE phone_hash=$1",
            [hash("SMS", main.phone)],
          );
          const before = await count();
          await access.requestPhotoAccess({
            channel: "PHONE",
            value: main.phone,
            email: "attacker@example.invalid",
          });
          const lookup = await guest.beginGuestRetrieval(
            { phone: main.phone },
            context,
          );
          await guest.confirmGuestRetrieval(
            { ...lookup, email: "attacker@example.invalid" },
            context,
          );
          const after = await one(
            "SELECT * FROM guest_photo_retrieval_addresses WHERE id=$1",
            [a.id],
          );
          assert.equal(after.email_hash, a.email_hash);
          assert.equal(after.version, a.version);
          assert.equal(await count(), before);
        },
      );
      await clearLimits();
      await t.test(
        "failed confirmations are blocked per phone across changing IPs and sessions",
        async () => {
          for (let i = 0; i < 5; i++) {
            const ctx = { ip: "192.0.2." + (20 + i) },
              c = await guest.beginGuestRetrieval({ phone: main.phone }, ctx);
            assert.equal(
              (
                await guest.confirmGuestRetrieval(
                  { ...c, email: "wrong@example.invalid" },
                  ctx,
                )
              ).accepted,
              true,
            );
          }
          await assert.rejects(
            guest.beginGuestRetrieval(
              { phone: main.phone },
              { ip: "198.51.100.20" },
            ),
            { code: "PHOTO_RETRIEVAL_RATE_LIMITED" },
          );
        },
      );
      await clearLimits();
      await t.test(
        "failed confirmations are blocked per session across different numbers",
        async () => {
          let sessionToken;
          for (let i = 0; i < 5; i++) {
            const c = await guest.beginGuestRetrieval(
              { phone: "+1312555800" + i, sessionToken },
              context,
            );
            sessionToken = c.sessionToken;
            await guest.confirmGuestRetrieval(
              { ...c, email: "none@example.invalid" },
              context,
            );
          }
          await assert.rejects(
            guest.beginGuestRetrieval(
              { phone: "+13125558111", sessionToken },
              context,
            ),
            { code: "PHOTO_RETRIEVAL_RATE_LIMITED" },
          );
        },
      );
      await clearLimits();
      await t.test(
        "failed confirmations are blocked per IP even when phone and session rotate",
        async () => {
          for (let i = 0; i < 20; i++) {
            const c = await guest.beginGuestRetrieval(
              { phone: "+1312555" + String(8200 + i) },
              context,
            );
            await guest.confirmGuestRetrieval(
              { ...c, email: "none@example.invalid" },
              context,
            );
          }
          await assert.rejects(
            guest.beginGuestRetrieval({ phone: "+13125558999" }, context),
            { code: "PHOTO_RETRIEVAL_RATE_LIMITED" },
          );
          const limits = await query(
            "SELECT * FROM guest_photo_retrieval_limits",
          );
          assert.ok(!JSON.stringify(limits.rows).includes(context.ip));
        },
      );
      await clearLimits();
      await t.test(
        "Admin correction requires identity review, is audited, and invalidates pending challenges and old access",
        async () => {
          const c = await guest.beginGuestRetrieval(
              { phone: main.phone },
              context,
            ),
            a = await one(
              "SELECT * FROM guest_photo_retrieval_addresses WHERE phone_hash=$1",
              [hash("SMS", main.phone)],
            );
          await assert.rejects(
            guest.correctGuestRetrievalAddress(
              main.album.id,
              a.id,
              {
                email: "new@example.invalid",
                reviewed: false,
                evidence: "Synthetic reviewed source",
              },
              user,
            ),
            { code: "RETRIEVAL_IDENTITY_REVIEW_REQUIRED" },
          );
          await guest.correctGuestRetrievalAddress(
            main.album.id,
            a.id,
            {
              email: "new@example.invalid",
              reviewed: true,
              evidence:
                "Synthetic identity review of original guest event records.",
            },
            user,
          );
          assert.equal(
            (
              await one(
                "SELECT version FROM guest_photo_retrieval_addresses WHERE id=$1",
                [a.id],
              )
            ).version,
            2,
          );
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM audit_logs WHERE action='guest_retrieval_address_corrected' AND actor_user_id=$1",
                [user.id],
              )
            ).n,
            1,
          );
          assert.equal(
            (await access.photoCollection(firstSession.token)).assets.length,
            0,
          );
          const before = await count();
          await guest.confirmGuestRetrieval(
            { ...c, email: "guest@example.invalid" },
            context,
          );
          assert.equal(await count(), before);
          const current = await guest.beginGuestRetrieval(
            { phone: main.phone },
            context,
          );
          assert.equal(current.maskedEmail, "n••••@e••••.invalid");
        },
      );
      await t.test(
        "unknown, restricted and revoked records never disclose a masked address or a photo link",
        async () => {
          const unknown = await guest.beginGuestRetrieval(
            { phone: "+13125559998" },
            context,
          );
          await guest.setGuestRetrievalRestriction(main.album.id, true, user);
          const restricted = await guest.beginGuestRetrieval(
            { phone: main.phone },
            context,
          );
          assert.equal(restricted.mode, unknown.mode);
          assert.equal(restricted.maskedEmail, null);
          const before = await count();
          assert.deepEqual(
            await guest.confirmGuestRetrieval(
              { ...restricted, email: "new@example.invalid" },
              context,
            ),
            await guest.confirmGuestRetrieval(
              { ...unknown, email: "new@example.invalid" },
              context,
            ),
          );
          assert.equal(await count(), before);
          await guest.setGuestRetrievalRestriction(main.album.id, false, user);
          await query(
            "UPDATE gallery_access_keys SET status='REVOKED' WHERE id=$1",
            [main.key.id],
          );
          assert.equal(
            (await guest.beginGuestRetrieval({ phone: main.phone }, context))
              .maskedEmail,
            null,
          );
          await query(
            "UPDATE gallery_access_keys SET status='ACTIVE' WHERE id=$1",
            [main.key.id],
          );
          await query("UPDATE gallery_albums SET status='DRAFT' WHERE id=$1", [
            main.album.id,
          ]);
          assert.equal(
            (await guest.beginGuestRetrieval({ phone: main.phone }, context))
              .maskedEmail,
            null,
          );
          await query(
            "UPDATE gallery_albums SET status='PUBLISHED' WHERE id=$1",
            [main.album.id],
          );
        },
      );
      await clearLimits();
      await t.test(
        "concurrent first-time emails cannot silently overwrite the first association",
        async () => {
          const f = await fixture("+13125557777", "Race retrieval");
          await guest.setGuestRetrievalRestriction(f.album.id, false, user);
          const c1 = { ip: "192.0.2.101" },
            c2 = { ip: "192.0.2.102" },
            a = await guest.beginGuestRetrieval({ phone: f.phone }, c1),
            b = await guest.beginGuestRetrieval({ phone: f.phone }, c2);
          const before = await count();
          await Promise.all([
            guest.confirmGuestRetrieval(
              { ...a, email: "one@example.invalid" },
              c1,
            ),
            guest.confirmGuestRetrieval(
              { ...b, email: "two@example.invalid" },
              c2,
            ),
          ]);
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM guest_photo_retrieval_addresses WHERE phone_hash=$1",
                [hash("SMS", f.phone)],
              )
            ).n,
            1,
          );
          assert.equal(await count(), before + 1);
        },
      );
      await t.test(
        "multiple event/email associations use neutral recovery, never merge or choose another recipient",
        async () => {
          const other = await fixture(main.phone, "Different event");
          await guest.setGuestRetrievalRestriction(other.album.id, false, user);
          await query(
            "INSERT INTO guest_photo_retrieval_addresses(phone_hash,email_hash,album_id,person_id,key_id,contact_ciphertext) VALUES($1,$2,$3,$4,$5,$6)",
            [
              hash("SMS", main.phone),
              hash("EMAIL", "other@example.invalid"),
              other.album.id,
              other.person.id,
              other.key.id,
              encryptSecretJson({
                phone: main.phone,
                email: "other@example.invalid",
              }),
            ],
          );
          const c = await guest.beginGuestRetrieval(
              { phone: main.phone },
              context,
            ),
            before = await count();
          assert.equal(c.maskedEmail, null);
          await guest.confirmGuestRetrieval(
            { ...c, email: "new@example.invalid" },
            context,
          );
          assert.equal(await count(), before);
          assert.equal(
            (await guest.guestRetrievalAdmin(main.album.id)).addresses.length,
            1,
          );
          assert.equal(
            (await guest.guestRetrievalAdmin(other.album.id)).addresses.length,
            1,
          );
          const scopes = await guest.guestRetrievalEmailScopes(
            "new@example.invalid",
          );
          assert.equal(scopes.length, 1);
          assert.equal(scopes[0].albumId, main.album.id);
        },
      );
      await t.test(
        "expired challenges and another browser session cannot authorize a delivery",
        async () => {
          await clearLimits();
          const f = await guest.beginGuestRetrieval(
            { phone: legacy.phone },
            context,
          );
          await query(
            "UPDATE guest_photo_retrieval_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
            [sha(f.challenge)],
          );
          const before = await count();
          await guest.confirmGuestRetrieval(
            { ...f, email: "legacy@example.invalid" },
            context,
          );
          assert.equal(await count(), before);
          await guest.setGuestRetrievalRestriction(
            legacy.album.id,
            false,
            user,
          );
          const c = await guest.beginGuestRetrieval(
            { phone: legacy.phone },
            context,
          );
          await guest.confirmGuestRetrieval(
            {
              ...c,
              sessionToken: crypto.randomBytes(32).toString("base64url"),
              email: "legacy@example.invalid",
            },
            context,
          );
          assert.equal(await count(), before);
        },
      );
      await t.test(
        "a stale queued email is suppressed after correction and staging ignores the old broad email bypass",
        async () => {
          await guest.processGuestRetrievalEmails({ limit: 100 });
          const f = await fixture("+13125556666", "Staging send guard");
          await guest.setGuestRetrievalRestriction(f.album.id, false, user);
          const c = await guest.beginGuestRetrieval(
            { phone: f.phone },
            context,
          );
          await guest.confirmGuestRetrieval(
            { ...c, email: "not-approved@example.invalid" },
            context,
          );
          Object.assign(process.env, {
            APP_ENV: "staging",
            STAGING_EMAIL_ENABLED: "true",
            STAGING_EMAIL_ALLOW_ANY_RECIPIENT: "true",
            STAGING_EMAIL_ALLOWLIST: "approved-qa@example.invalid",
          });
          try {
            await guest.processGuestRetrievalEmails();
            const r = await one(
              "SELECT guest_retrieval_delivery_state AS s FROM keepsakes_photo_requests WHERE target_hash=$1",
              [hash("SMS", f.phone)],
            );
            assert.equal(r.s, "FAILED");
            assert.equal(network, 0);
          } finally {
            process.env.APP_ENV = "test";
          }
        },
      );
      assert.equal(
        (await one("SELECT count(*)::int n FROM gallery_trusted_phone_emails"))
          .n,
        0,
      );
      assert.equal(
        (
          await one(
            "SELECT count(*)::int n FROM communications WHERE channel='SMS'",
          )
        ).n,
        0,
      );
      await t.test(
        "personal-grant revocation cannot be bypassed through an older album-scoped retrieval link",
        async () => {
          await clearLimits();
          const f = await fixture("+13125554444", "Grant revocation test");
          await guest.setGuestRetrievalRestriction(f.album.id, false, user);
          const c = await guest.beginGuestRetrieval(
            { phone: f.phone },
            context,
          );
          await guest.confirmGuestRetrieval(
            { ...c, email: "grants@example.invalid" },
            context,
          );
          const mail = await one(
            "SELECT rendered_body FROM communications WHERE recipient='grants@example.invalid' ORDER BY created_at DESC LIMIT 1",
          );
          const session = await access.redeemPhotoAccess(
            /#code=([\w-]+)/.exec(mail.rendered_body)[1],
          );
          assert.equal(
            (await access.photoCollection(session.token)).assets.length,
            1,
          );
          const key = await gallery.createGalleryKey(
            f.album.id,
            "PERSON",
            f.person.id,
            null,
            user,
          );
          await query(
            "UPDATE gallery_access_keys SET status='REVOKED' WHERE id=$1",
            [key.id],
          );
          assert.equal(
            (await access.photoCollection(session.token)).assets.length,
            0,
          );
          assert.equal(
            (await guest.beginGuestRetrieval({ phone: f.phone }, context))
              .maskedEmail,
            null,
          );
        },
      );
      assert.equal(network, 0);
    } finally {
      globalThis.fetch = realFetch;
      await db?.pool.end();
      await bootstrap.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
      await bootstrap.end();
      await fs.rm(storage, { recursive: true, force: true });
    }
  },
);
