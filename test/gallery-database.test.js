import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const enabled = process.env.GALLERY_TEST_DATABASE_URL;
test(
  "private gallery database authorization and lifecycle",
  { skip: !enabled },
  async (t) => {
    const url = new URL(enabled);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_qa"),
      "This test only uses an explicit localhost QA database",
    );
    process.env.DATABASE_URL = enabled;
    process.env.APP_ENV = "test";
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "synthetic-gallery-database-test-secret-32chars";
    process.env.GALLERY_STORAGE_PROVIDER = "local";
    process.env.GALLERY_LOCAL_ROOT = "/private/tmp/lola-gallery-test-media";
    const { query, pool } = await import("../server/src/db/pool.js");
    const g = await import("../server/src/services/private-gallery-service.js");
    const id = crypto.randomUUID();
    const user = (
      await query(
        "INSERT INTO users(name,email,password_hash) VALUES('GALLERY QA',$1,'synthetic-not-login') RETURNING id",
        [`gallery-${id}@example.invalid`],
      )
    ).rows[0];
    try {
      const event = (
        await query(
          "INSERT INTO events(event_name,event_type,event_date,status) VALUES('GALLERY QA Privacy','CORPORATE','2026-11-21','INQUIRY') RETURNING id",
        )
      ).rows[0];
      const event2 = (
        await query(
          "INSERT INTO events(event_name,event_type,event_date,status) VALUES('GALLERY QA Other','CORPORATE','2026-11-22','INQUIRY') RETURNING id",
        )
      ).rows[0];
      const album = await g.createGalleryAlbum(
          event.id,
          "GALLERY QA Privacy",
          user,
        ),
        other = await g.createGalleryAlbum(event2.id, "GALLERY QA Other", user);
      const person = await g.createGalleryPerson(album.id),
        person2 = await g.createGalleryPerson(album.id),
        outsider = await g.createGalleryPerson(other.id);
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=";
      const photo = await g.uploadGalleryMedia(album.id, {
          filename: "synthetic.png",
          mime_type: "image/png",
          base64: png,
        }),
        hidden = await g.uploadGalleryMedia(album.id, {
          filename: "unassigned.png",
          mime_type: "image/png",
          base64: png,
        });
      await t.test(
        "database rejects cross-album many-to-many assignments",
        async () => {
          await assert.rejects(
            query(
              "INSERT INTO gallery_media_people(album_id,media_id,person_id) VALUES($1,$2,$3)",
              [album.id, photo.id, outsider.id],
            ),
            (e) => e.code === "23503",
          );
        },
      );
      await g.bulkGalleryMedia(
        album.id,
        { action: "assign", media_ids: [photo.id], person_id: person.id },
        user,
      );
      await g.bulkGalleryMedia(
        album.id,
        { action: "assign", media_ids: [photo.id], person_id: person2.id },
        user,
      );
      await g.transitionGalleryAlbum(album.id, "PUBLISHED", user);
      const access = await g.createGalleryKey(
          album.id,
          "PERSON",
          person.id,
          null,
          user,
        ),
        token = access.url.split("/").at(-1),
        albumAccess = await g.createGalleryKey(
          album.id,
          "ALBUM",
          null,
          null,
          user,
        );
      await t.test("QR encodes the exact scoped token URL", async () => {
        const { createCanvas, loadImage } = await import("@napi-rs/canvas");
        const { default: jsQR } = await import("jsqr");
        const image = await loadImage(
          Buffer.from(access.qr.split(",")[1], "base64"),
        );
        const canvas = createCanvas(image.width, image.height),
          context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height);
        assert.equal(
          jsQR(pixels.data, image.width, image.height).data,
          access.url,
        );
      });
      await t.test(
        "album creation is unique per event and expired grants are rejected",
        async () => {
          assert.equal(
            (await g.createGalleryAlbum(event.id, "Duplicate request", user))
              .id,
            album.id,
          );
          const expired = await g.createGalleryKey(
            album.id,
            "PERSON",
            person.id,
            "2020-01-01T00:00:00Z",
            user,
          );
          await assert.rejects(g.resolveGalleryCode(expired.code));
          await g.changeGalleryKey(
            expired.id,
            "extend",
            "2099-01-01T00:00:00Z",
            user,
          );
          assert.match(
            (await g.resolveGalleryCode(expired.code)).path,
            /\/p\//,
          );
        },
      );
      await t.test(
        "personal code resolves only to personal route; cannot swap route type",
        async () => {
          assert.match(
            (await g.resolveGalleryCode(access.code)).path,
            /^\/gallery\/p\//,
          );
          await assert.rejects(g.resolveGalleryToken("ALBUM", token));
        },
      );
      await t.test(
        "personal payload includes assigned group photo only and no storage paths",
        async () => {
          const view = await g.publicGalleryView(
            await g.resolveGalleryToken("PERSON", token),
          );
          assert.deepEqual(
            view.media.map((m) => m.id),
            [photo.id],
          );
          assert.equal(JSON.stringify(view).includes("storage_key"), false);
          await assert.rejects(
            g.mediaTicket(
              await g.resolveGalleryToken("PERSON", token),
              hidden.id,
            ),
          );
        },
      );
      await t.test("album sees approved full album", async () => {
        assert.equal(
          (
            await g.publicGalleryView(
              await g.resolveGalleryToken(
                "ALBUM",
                albumAccess.url.split("/").at(-1),
              ),
            )
          ).media.length,
          2,
        );
      });
      await t.test(
        "existing ticket immediately loses access after assignment removal",
        async () => {
          const ticket = (
            await g.mediaTicket(
              await g.resolveGalleryToken("PERSON", token),
              photo.id,
              "view",
            )
          ).url
            .split("/")
            .at(-1);
          await g.bulkGalleryMedia(
            album.id,
            { action: "unassign", media_ids: [photo.id], person_id: person.id },
            user,
          );
          await assert.rejects(g.authorizedMediaTicket(ticket));
          await g.bulkGalleryMedia(
            album.id,
            { action: "assign", media_ids: [photo.id], person_id: person.id },
            user,
          );
        },
      );
      await t.test("download controls enforced server-side", async () => {
        await g.updateGalleryAlbum(
          album.id,
          { allow_personal_download: false, allow_personal_zip: false },
          user,
        );
        await assert.rejects(
          g.mediaTicket(await g.resolveGalleryToken("PERSON", token), photo.id),
        );
      });
      await t.test(
        "hidden media invalidates an already issued ticket",
        async () => {
          const ticket = (
            await g.mediaTicket(
              await g.resolveGalleryToken("PERSON", token),
              photo.id,
              "view",
            )
          ).url
            .split("/")
            .at(-1);
          await g.bulkGalleryMedia(
            album.id,
            { action: "hide", media_ids: [photo.id] },
            user,
          );
          await assert.rejects(g.authorizedMediaTicket(ticket));
          await g.bulkGalleryMedia(
            album.id,
            { action: "restore", media_ids: [photo.id] },
            user,
          );
        },
      );
      await t.test(
        "regeneration revokes old code and token; new key works",
        async () => {
          const newer = await g.changeGalleryKey(
            access.id,
            "regenerate",
            null,
            user,
          );
          await assert.rejects(g.resolveGalleryToken("PERSON", token));
          await assert.rejects(g.resolveGalleryCode(access.code));
          assert.match((await g.resolveGalleryCode(newer.code)).path, /\/p\//);
          await g.changeGalleryKey(newer.id, "revoke", null, user);
          await assert.rejects(g.resolveGalleryCode(newer.code));
        },
      );
      await t.test(
        "unmatched imports retain media and matching is idempotent",
        async () => {
          const input = {
            source_provider: "QA_FTP",
            external_event_id: id,
            external_capture_id: "capture-1",
            filename: "import.png",
            mime_type: "image/png",
            base64: png,
          };
          const pending = await g.queueGalleryImport(input, user);
          assert.equal(pending.status, "UNMATCHED");
          assert.equal(
            (await g.queueGalleryImport(input, user)).id,
            pending.id,
          );
          await g.matchGalleryImport(pending.id, other.id, user);
          await g.matchGalleryImport(pending.id, other.id, user);
          assert.equal(
            (
              await query(
                "SELECT count(*)::int n FROM gallery_media WHERE album_id=$1",
                [other.id],
              )
            ).rows[0].n,
            1,
          );
          await assert.rejects(
            g.matchGalleryImport(pending.id, album.id, user),
          );
        },
      );
      await t.test(
        "personal overrides are independent and do not grant album access",
        async () => {
          await g.updateGalleryAlbum(
            album.id,
            { allow_personal_download: true, allow_personal_zip: true },
            user,
          );
          await g.updateGalleryPersonDownloads(
            person2.id,
            { allow_download: false, allow_zip: false },
            user,
          );
          const key = await g.createGalleryKey(
            album.id,
            "PERSON",
            person2.id,
            null,
            user,
          );
          const grant = await g.resolveGalleryToken(
            "PERSON",
            key.url.split("/").at(-1),
          );
          assert.equal(grant.allow_personal_download, false);
          await assert.rejects(g.mediaTicket(grant, photo.id));
          await assert.rejects(
            g.resolveGalleryToken("ALBUM", key.url.split("/").at(-1)),
          );
        },
      );
      await t.test(
        "HTTP endpoints protect private media, ZIP downloads and code lookup",
        async () => {
          const { default: express } = await import("express");
          const { galleryPublicRouter, galleryAdminRouter } =
            await import("../server/src/routes/gallery.js");
          const { errorHandler } =
            await import("../server/src/middleware/error-handler.js");
          const app = express();
          app.use(express.json());
          app.use("/api/gallery", galleryPublicRouter);
          app.use("/api/gallery-admin", galleryAdminRouter);
          app.use(errorHandler);
          const server = app.listen(0, "127.0.0.1");
          await new Promise((resolve) => server.once("listening", resolve));
          const base = `http://127.0.0.1:${server.address().port}`;
          try {
            assert.equal(
              (await fetch(base + "/api/gallery-admin/albums")).status,
              401,
            );
            const root =
              "/api/gallery/access/a/" + albumAccess.url.split("/").at(-1);
            const response = await fetch(base + root);
            assert.equal(response.status, 200);
            const view = await response.json();
            const image = await fetch(base + view.media[0].url);
            assert.equal(image.status, 200);
            assert.equal(
              image.headers.get("cache-control"),
              "private, no-store",
            );
            assert.equal(image.headers.get("content-type"), "image/png");
            const zip = await fetch(base + root + "/zip");
            assert.equal(zip.status, 200);
            assert.equal(
              Buffer.from(await zip.arrayBuffer())
                .subarray(0, 2)
                .toString(),
              "PK",
            );
            await g.updateGalleryAlbum(album.id, { allow_zip: false }, user);
            assert.equal((await fetch(base + root + "/zip")).status, 404);
            const wrong = await fetch(base + "/api/gallery/resolve", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code: "AAAAAAAAAAAAAAAAAAAA" }),
            });
            const invalid = await wrong.json();
            assert.equal(wrong.status, 404);
            assert.equal(invalid.error.code, "GALLERY_UNAVAILABLE");
            let limited;
            for (let n = 0; n < 8; n++)
              limited = await fetch(base + "/api/gallery/resolve", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ code: "AAAAAAAAAAAAAAAAAAAA" }),
              });
            assert.equal(limited.status, 429);
            const email = await g.deliverGallery(
              albumAccess.id,
              "gallery-qa@example.invalid",
              user,
              false,
            );
            assert.equal(email.sent, false);
            assert.equal(
              (
                await g.deliverGallery(
                  albumAccess.id,
                  "gallery-qa@example.invalid",
                  user,
                  false,
                )
              ).communicationId,
              email.communicationId,
            );
            const saved = (
              await query(
                "SELECT status,rendered_html FROM communications WHERE id=$1",
                [email.communicationId],
              )
            ).rows[0];
            assert.equal(saved.status, "DRAFT");
            assert.match(saved.rendered_html, /gallery/);
          } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
          }
        },
      );
    } finally {
      await pool.end();
    }
  },
);
