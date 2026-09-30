import { galleryEnabled } from "../../../shared/features.js";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/errors.js";

export const unavailable = () =>
  new AppError(
    "This gallery link or code is unavailable. Please contact your host.",
    404,
    "GALLERY_UNAVAILABLE",
  );
export function assertGalleryEnvironment(config = process.env) {
  if (!galleryEnabled(config))
    throw new AppError(
      "Gallery preview is not enabled in this environment.",
      404,
      "GALLERY_DISABLED",
    );
}
export const hashCredential = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
export const normalizeCode = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
export function newGalleryCredentials() {
  return {
    token: crypto.randomBytes(32).toString("base64url"),
    code: crypto.randomBytes(10).toString("hex").toUpperCase(),
  };
}
function cipherKey(secret) {
  if (!secret || secret.length < 24)
    throw Error("Gallery signing secret is required");
  return crypto
    .createHash("sha256")
    .update("lola-gallery-credentials:" + secret)
    .digest();
}
export function sealCredentials(value, secret, environment) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", cipherKey(secret), iv);
  cipher.setAAD(Buffer.from(environment));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openCredentials(value, secret, environment) {
  const data = Buffer.from(value, "base64url"),
    cipher = crypto.createDecipheriv(
      "aes-256-gcm",
      cipherKey(secret),
      data.subarray(0, 12),
    );
  cipher.setAAD(Buffer.from(environment));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(data.subarray(28)),
      cipher.final(),
    ]).toString(),
  );
}
export function grantUsable(grant, now = Date.now()) {
  return (
    !!grant &&
    grant.status === "ACTIVE" &&
    ["PUBLISHED", "DELIVERED"].includes(grant.album_status) &&
    (!grant.expires_at || Date.parse(grant.expires_at) > now) &&
    (!grant.album_expires_at || Date.parse(grant.album_expires_at) > now) &&
    (grant.type === "ALBUM" || grant.person_status === "ACTIVE")
  );
}
export function mediaPermitted(grant, media, assigned) {
  return (
    grantUsable(grant) &&
    media.album_id === grant.album_id &&
    media.status === "VISIBLE" &&
    (grant.type === "ALBUM" || assigned === true)
  );
}
export function downloadAllowed(grant, zip = false) {
  return Boolean(
    grant[
      grant.type === "PERSON"
        ? zip
          ? "allow_personal_zip"
          : "allow_personal_download"
        : zip
          ? "allow_zip"
          : "allow_download"
    ],
  );
}
export function issueMediaTicket(
  grantId,
  mediaId,
  purpose,
  secret,
  environment,
) {
  return jwt.sign({ grantId, mediaId, purpose }, secret, {
    algorithm: "HS256",
    expiresIn: 60,
    audience: "lola-gallery-media",
    issuer: environment,
  });
}
export function verifyMediaTicket(token, secret, environment) {
  try {
    return jwt.verify(token, secret, {
      algorithms: ["HS256"],
      audience: "lola-gallery-media",
      issuer: environment,
    });
  } catch {
    throw unavailable();
  }
}
export function validateGalleryImage(buffer, mime) {
  const valid =
    mime === "image/png"
      ? buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg"
        ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
        : mime === "image/gif"
          ? /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString())
          : false;
  if (!valid || buffer.length < 20 || buffer.length > 10 * 1024 * 1024)
    throw new AppError(
      "Upload a JPG, PNG or GIF up to 10 MB.",
      422,
      "GALLERY_IMAGE_INVALID",
    );
}
