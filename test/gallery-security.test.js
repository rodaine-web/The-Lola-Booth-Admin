import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  newGalleryCredentials,
  hashCredential,
  normalizeCode,
  sealCredentials,
  openCredentials,
  grantUsable,
  mediaPermitted,
  downloadAllowed,
  issueMediaTicket,
  verifyMediaTicket,
  assertGalleryEnvironment,
  validateGalleryImage,
} from "../server/src/services/gallery-policy.js";
import { galleryStorage } from "../server/src/services/gallery-storage.js";
const secret = "synthetic-gallery-security-secret-over-32-characters";
const grant = {
  id: "grant",
  album_id: "album-a",
  type: "PERSON",
  status: "ACTIVE",
  album_status: "PUBLISHED",
  person_status: "ACTIVE",
  allow_download: true,
  allow_zip: true,
  allow_personal_download: false,
  allow_personal_zip: false,
};
test("personal access never inherits album permissions", () => {
  assert.equal(downloadAllowed(grant), false);
  assert.equal(downloadAllowed(grant, true), false);
  assert.equal(
    mediaPermitted(grant, { album_id: "album-a", status: "VISIBLE" }, false),
    false,
  );
  assert.equal(
    mediaPermitted(grant, { album_id: "album-a", status: "VISIBLE" }, true),
    true,
  );
  assert.equal(
    mediaPermitted(grant, { album_id: "album-b", status: "VISIBLE" }, true),
    false,
  );
});
test("hidden, archived, revoked, expired and unpublished access fails closed", () => {
  for (const status of ["HIDDEN", "ARCHIVED"])
    assert.equal(
      mediaPermitted(grant, { album_id: "album-a", status }, true),
      false,
    );
  for (const patch of [
    { status: "REVOKED" },
    { status: "EXPIRED" },
    { album_status: "DRAFT" },
    { album_status: "ARCHIVED" },
    { person_status: "ARCHIVED" },
    { expires_at: "2020-01-01" },
    { album_expires_at: "2020-01-01" },
  ])
    assert.equal(grantUsable({ ...grant, ...patch }), false);
});
test("opaque random credentials are normalized and encrypted with environment binding", () => {
  const a = newGalleryCredentials(),
    b = newGalleryCredentials();
  assert.notEqual(a.token, b.token);
  assert.equal(a.token.length, 43);
  assert.equal(a.code.length, 20);
  assert.equal(
    normalizeCode(
      a.code
        .toLowerCase()
        .match(/.{1,5}/g)
        .join("-"),
    ),
    a.code,
  );
  assert.notEqual(hashCredential(a.token), a.token);
  const sealed = sealCredentials(a, secret, "staging");
  assert.equal(sealed.includes(a.token), false);
  assert.deepEqual(openCredentials(sealed, secret, "staging"), a);
  assert.throws(() => openCredentials(sealed, secret, "production"));
  assert.throws(() => openCredentials(sealed, secret + "x", "staging"));
});
test("media tickets reject forgery, wrong environment, wrong audience and expiration", () => {
  const ticket = issueMediaTicket("grant", "media", "view", secret, "staging");
  assert.equal(verifyMediaTicket(ticket, secret, "staging").grantId, "grant");
  assert.throws(() => verifyMediaTicket(ticket, secret, "production"));
  assert.throws(() => verifyMediaTicket(ticket, secret + "x", "staging"));
  const expired = jwt.sign(
    { grantId: "grant", mediaId: "media", purpose: "view" },
    secret,
    { expiresIn: -1, audience: "lola-gallery-media", issuer: "staging" },
  );
  assert.throws(() => verifyMediaTicket(expired, secret, "staging"));
  assert.throws(() =>
    verifyMediaTicket(jwt.sign({}, secret), secret, "staging"),
  );
});
test("gallery cannot activate production or silently use a deployed local volume", () => {
  assert.throws(() => assertGalleryEnvironment({ APP_ENV: "production" }));
  assert.throws(() =>
    galleryStorage({ APP_ENV: "staging", GALLERY_STORAGE_PROVIDER: "local" }),
  );
  assert.throws(() =>
    galleryStorage({
      APP_ENV: "staging",
      GALLERY_STORAGE_PROVIDER: "s3",
      GALLERY_STORAGE_ENV: "production",
    }),
  );
});
test("uploads reject executable formats and mismatched signatures", () => {
  assert.throws(() =>
    validateGalleryImage(
      Buffer.from("<svg><script>alert(1)</script></svg>"),
      "image/svg+xml",
    ),
  );
  assert.throws(() => validateGalleryImage(Buffer.alloc(50), "image/jpeg"));
  assert.throws(() =>
    validateGalleryImage(Buffer.alloc(11 * 1024 * 1024), "image/png"),
  );
});
