import crypto from "node:crypto";
import { query, transaction } from "../db/pool.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { encryptSecretJson, decryptSecretJson } from "./integration-secrets.js";
import {
  contactScopes,
  scopeAnchors,
} from "./keepsakes-photo-access-service.js";
import {
  createCommunicationDraft,
  sendCommunication,
  brandedEmailHtml,
} from "./automation-service.js";
import { writeAudit } from "./audit-service.js";
import { assertKeepsakes } from "./keepsakes-service.js";
import { stagingEmailPolicy } from "../config/staging-safety.js";
import { keepsakesPublicOrigin } from "../../../shared/keepsakes-host.js";
import { normalizePhotoLookup } from "../../../shared/keepsakes-photo-access.js";
import {
  maskRetrievalEmail,
  GUEST_RETRIEVAL_MESSAGE,
} from "../../../shared/guest-retrieval-policy.js";
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const fingerprint = (type, value) =>
  crypto
    .createHmac("sha256", env.integrationSecretKey)
    .update(type + ":" + value)
    .digest("hex");
const secret = () => crypto.randomBytes(32).toString("base64url");
const validToken = (value) =>
  typeof value === "string" && /^[\w-]{43}$/.test(value);
const neutral = { accepted: true, message: GUEST_RETRIEVAL_MESSAGE };
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const scopeFor = (a) => ({
  albumId: a.album_id,
  personId: a.person_id,
  keyId: a.key_id,
  retrievalAssociationId: a.id,
  retrievalAssociationVersion: a.version,
});
const audit = (action, id, user, after) =>
  writeAudit({
    req: { user },
    action,
    entity: "guest_retrieval_address",
    entityId: id,
    after,
  });
async function rowsFor(phoneHash) {
  return (
    await query(
      "SELECT * FROM guest_photo_retrieval_addresses WHERE phone_hash=$1 ORDER BY id",
      [phoneHash],
    )
  ).rows;
}
const version = (rows) =>
  digest(JSON.stringify(rows.map((r) => [r.id, r.version, r.status])));
async function eligibility(phone) {
  const scopes = await contactScopes("SMS", phone);
  if (scopes.length !== 1) return null;
  const scope = scopes[0],
    album = (
      await query(
        "SELECT guest_retrieval_restricted FROM gallery_albums WHERE id=$1",
        [scope.albumId],
      )
    ).rows[0];
  return album?.guest_retrieval_restricted === false ? scope : null;
}
async function usableAddress(a, scope) {
  return (
    a.status === "ACTIVE" &&
    scope &&
    a.album_id === scope.albumId &&
    a.person_id === scope.personId &&
    a.key_id === scope.keyId &&
    (await scopeAnchors(scopeFor(a))).length > 0
  );
}
async function limit(keys, search = false, failed = false) {
  const now = Date.now(),
    entries = Object.entries(keys)
      .map(([kind, value]) => ({
        kind,
        key: fingerprint("GUEST_RATE", kind + ":" + value),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  for (const e of entries) {
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "guest-rate:" + e.key,
    ]);
    await query(
      "INSERT INTO guest_photo_retrieval_limits(key_hash) VALUES($1) ON CONFLICT DO NOTHING",
      [e.key],
    );
    await query(
      "UPDATE guest_photo_retrieval_limits SET window_started_at=now(),searches=0,failures=0,blocked_until=NULL WHERE key_hash=$1 AND window_started_at<now()-interval '15 minutes' AND (blocked_until IS NULL OR blocked_until<=now())",
      [e.key],
    );
    const row = (
        await query(
          "SELECT * FROM guest_photo_retrieval_limits WHERE key_hash=$1",
          [e.key],
        )
      ).rows[0],
      searchCap = e.kind === "ip" ? 30 : 15,
      failCap = e.kind === "ip" ? 20 : 5;
    if (
      (row.blocked_until && Date.parse(row.blocked_until) > now) ||
      (search && row.searches >= searchCap) ||
      row.failures >= failCap
    )
      return false;
  }
  for (const e of entries) {
    const cap = e.kind === "ip" ? 20 : 5;
    await query(
      `UPDATE guest_photo_retrieval_limits SET searches=searches+$2,failures=failures+$3,blocked_until=CASE WHEN failures+$3>=$4 THEN now()+interval '15 minutes' ELSE blocked_until END WHERE key_hash=$1`,
      [e.key, search ? 1 : 0, failed ? 1 : 0, cap],
    );
  }
  return true;
}
const limited = () => ({ rateLimited: true });
function unwrap(result) {
  if (result.rateLimited)
    throw new AppError(
      "Please wait before trying again, or use your original photo link or contact support.",
      429,
      "PHOTO_RETRIEVAL_RATE_LIMITED",
    );
  return result;
}
export async function beginGuestRetrieval(input, context = {}) {
  assertKeepsakes();
  const phone = normalizePhotoLookup("SMS", input.phone);
  if (!phone)
    throw new AppError(
      "Enter a valid phone number.",
      422,
      "PHOTO_LOOKUP_INVALID",
    );
  return unwrap(
    await transaction(async () => {
      const phoneHash = fingerprint("SMS", phone),
        ipHash = fingerprint("GUEST_IP", context.ip || "unknown");
      await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "guest-phone:" + phoneHash,
      ]);
      let sessionToken = input.sessionToken,
        session = validToken(sessionToken)
          ? (
              await query(
                "SELECT * FROM guest_photo_retrieval_sessions WHERE token_hash=$1 AND ip_hash=$2 AND expires_at>now()",
                [digest(sessionToken), ipHash],
              )
            ).rows[0]
          : null;
      if (!session) {
        sessionToken = secret();
        session = (
          await query(
            "INSERT INTO guest_photo_retrieval_sessions(token_hash,ip_hash) VALUES($1,$2) RETURNING *",
            [digest(sessionToken), ipHash],
          )
        ).rows[0];
      }
      if (
        !(await limit(
          { phone: phoneHash, ip: ipHash, session: session.id },
          true,
        ))
      )
        return limited();
      const rows = await rowsFor(phoneHash),
        scope = await eligibility(phone);
      let disposition = "RECOVERY",
        maskedEmail = null;
      if (rows.length === 1 && (await usableAddress(rows[0], scope))) {
        const email = normalizePhotoLookup(
          "EMAIL",
          decryptSecretJson(rows[0].contact_ciphertext).email,
        );
        if (email && fingerprint("EMAIL", email) === rows[0].email_hash) {
          disposition = "RETURNING";
          maskedEmail = maskRetrievalEmail(email);
        }
      } else if (
        !rows.length &&
        scope &&
        !(
          await query(
            "SELECT 1 FROM gallery_trusted_phone_emails WHERE phone_hash=$1 AND revoked_at IS NULL",
            [phoneHash],
          )
        ).rowCount
      )
        disposition = "NEW";
      const challenge = secret();
      await query(
        "INSERT INTO guest_photo_retrieval_challenges(token_hash,session_id,phone_hash,phone_ciphertext,association_version,disposition) VALUES($1,$2,$3,$4,$5,$6)",
        [
          digest(challenge),
          session.id,
          phoneHash,
          encryptSecretJson({ phone }),
          version(rows),
          disposition,
        ],
      );
      return {
        challenge,
        sessionToken,
        mode: maskedEmail ? "RETURNING" : "EMAIL_REQUIRED",
        maskedEmail,
        message:
          "Enter your full email address to receive a secure link to your photos.",
      };
    }),
  );
}
export async function confirmGuestRetrieval(input, context = {}) {
  assertKeepsakes();
  if (!validToken(input.challenge) || !validToken(input.sessionToken))
    return neutral;
  return unwrap(
    await transaction(async () => {
      const first = (
        await query(
          "SELECT phone_hash FROM guest_photo_retrieval_challenges WHERE token_hash=$1",
          [digest(input.challenge)],
        )
      ).rows[0];
      if (!first) return neutral;
      await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "guest-phone:" + first.phone_hash,
      ]);
      const c = (
        await query(
          `SELECT c.*,s.ip_hash,s.expires_at AS session_expiry,s.token_hash AS session_hash FROM guest_photo_retrieval_challenges c JOIN guest_photo_retrieval_sessions s ON s.id=c.session_id WHERE c.token_hash=$1 FOR UPDATE OF c`,
          [digest(input.challenge)],
        )
      ).rows[0];
      const ipHash = fingerprint("GUEST_IP", context.ip || "unknown");
      if (
        !c ||
        c.consumed_at ||
        new Date(c.expires_at) <= new Date() ||
        new Date(c.session_expiry) <= new Date()
      )
        return neutral;
      const keys = { phone: c.phone_hash, ip: ipHash, session: c.session_id };
      if (!(await limit(keys))) return limited();
      if (
        c.ip_hash !== ipHash ||
        !equal(c.session_hash, digest(input.sessionToken))
      ) {
        await limit(keys, false, true);
        return neutral;
      }
      const phone = decryptSecretJson(c.phone_ciphertext).phone,
        email = normalizePhotoLookup("EMAIL", input.email),
        rows = await rowsFor(c.phone_hash),
        scope = await eligibility(phone);
      let a = rows.length === 1 ? rows[0] : null;
      const fail = async () => {
        await limit(keys, false, true);
        return neutral;
      };
      if (!email || !scope || c.disposition === "RECOVERY") return fail();
      if (
        c.disposition === "RETURNING" &&
        version(rows) !== c.association_version
      )
        return fail();
      if (rows.length) {
        if (
          !a ||
          !(await usableAddress(a, scope)) ||
          !equal(a.email_hash, fingerprint("EMAIL", email))
        )
          return fail();
      } else {
        if (
          c.disposition !== "NEW" ||
          !(version(rows) === c.association_version)
        )
          return fail();
        a = (
          await query(
            `INSERT INTO guest_photo_retrieval_addresses(phone_hash,email_hash,album_id,person_id,key_id,contact_ciphertext) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
            [
              c.phone_hash,
              fingerprint("EMAIL", email),
              scope.albumId,
              scope.personId,
              scope.keyId,
              encryptSecretJson({ phone, email }),
            ],
          )
        ).rows[0];
        await audit(
          "guest_retrieval_address_recorded",
          a.id,
          {},
          {
            albumId: a.album_id,
            personId: a.person_id,
            verificationStatus: "UNVERIFIED",
            source: "GUEST_PROVIDED",
          },
        );
      }
      const saved = normalizePhotoLookup(
        "EMAIL",
        decryptSecretJson(a.contact_ciphertext).email,
      );
      if (
        !saved ||
        !equal(fingerprint("EMAIL", saved), a.email_hash) ||
        !equal(fingerprint("EMAIL", saved), fingerprint("EMAIL", email))
      )
        return fail();
      await query(
        "UPDATE guest_photo_retrieval_challenges SET consumed_at=now() WHERE id=$1",
        [c.id],
      );
      if (
        (
          await query(
            "SELECT 1 FROM keepsakes_photo_requests WHERE target_hash=$1 AND created_at>now()-interval '2 minutes' LIMIT 1",
            [c.phone_hash],
          )
        ).rowCount
      )
        return neutral;
      const code = secret(),
        request = (
          await query(
            "INSERT INTO keepsakes_photo_requests(target_hash,token_hash,scopes,expires_at,guest_retrieval_delivery_state) VALUES($1,$2,$3,now()+interval '30 minutes','QUEUED') RETURNING id",
            [c.phone_hash, digest(code), JSON.stringify([scopeFor(a)])],
          )
        ).rows[0];
      const link =
          keepsakesPublicOrigin(process.env).replace(/\/$/, "") +
          "/photos/access#code=" +
          code,
        body = `Your Lola Booth photos are ready.\n\nView My Photos:\n${link}\n\nThis secure link expires in 30 minutes and can be used once. This email is only for the photo link you requested.\n\nIf you did not request this email, you can ignore it or contact The Lola Booth.`;
      const message = await createCommunicationDraft({
        channel: "EMAIL",
        recipient: saved,
        subject: "Your Lola Booth photos are ready",
        body,
        html: brandedEmailHtml(body, {
          ctaUrl: link,
          ctaLabel: "View My Photos",
        }),
        status: "DRAFT",
        trigger_key: "GUEST_RETRIEVAL_EMAIL",
      });
      await query(
        "UPDATE keepsakes_photo_requests SET communication_id=$2 WHERE id=$1",
        [request.id, message.id],
      );
      await audit(
        "guest_retrieval_link_queued",
        a.id,
        {},
        { albumId: a.album_id, requestId: request.id },
      );
      return neutral;
    }),
  );
}
export async function guestRetrievalEmailScopes(email) {
  const rows = (
      await query(
        "SELECT * FROM guest_photo_retrieval_addresses WHERE email_hash=$1 AND status='ACTIVE' ORDER BY id",
        [fingerprint("EMAIL", email)],
      )
    ).rows,
    scopes = [];
  for (const a of rows) {
    if (
      normalizePhotoLookup(
        "EMAIL",
        decryptSecretJson(a.contact_ciphertext).email,
      ) !== email
    )
      continue;
    const scope = scopeFor(a);
    if ((await scopeAnchors(scope)).length) scopes.push(scope);
  }
  return scopes;
}
export async function guestRetrievalAdmin(albumId) {
  const album = (
    await query(
      "SELECT guest_retrieval_restricted FROM gallery_albums WHERE id=$1",
      [albumId],
    )
  ).rows[0];
  const rows = (
    await query(
      "SELECT a.*,p.display_name FROM guest_photo_retrieval_addresses a JOIN gallery_people p ON p.id=a.person_id AND p.album_id=a.album_id WHERE a.album_id=$1 ORDER BY a.created_at",
      [albumId],
    )
  ).rows;
  return {
    restricted: album.guest_retrieval_restricted,
    addresses: rows.map((a) => ({
      id: a.id,
      personId: a.person_id,
      name: a.display_name,
      maskedEmail: maskRetrievalEmail(
        decryptSecretJson(a.contact_ciphertext).email,
      ),
      status: a.status,
      verificationStatus: a.verification_status,
      version: a.version,
      updatedAt: a.updated_at,
    })),
  };
}
export async function setGuestRetrievalRestriction(albumId, restricted, user) {
  await transaction(async () => {
    await query(
      "UPDATE gallery_albums SET guest_retrieval_restricted=$2 WHERE id=$1",
      [albumId, restricted],
    );
    await audit("guest_retrieval_restriction_changed", albumId, user, {
      restricted,
    });
  });
  return guestRetrievalAdmin(albumId);
}
export async function correctGuestRetrievalAddress(albumId, id, input, user) {
  const email = normalizePhotoLookup("EMAIL", input.email);
  if (
    !email ||
    input.reviewed !== true ||
    typeof input.evidence !== "string" ||
    input.evidence.trim().length < 20
  )
    throw new AppError(
      "Record the identity review and the corrected email address.",
      422,
      "RETRIEVAL_IDENTITY_REVIEW_REQUIRED",
    );
  return transaction(async () => {
    const a0 = (
      await query(
        "SELECT phone_hash FROM guest_photo_retrieval_addresses WHERE id=$1 AND album_id=$2",
        [id, albumId],
      )
    ).rows[0];
    if (!a0)
      throw new AppError("Retrieval address unavailable.", 404, "NOT_FOUND");
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "guest-phone:" + a0.phone_hash,
    ]);
    const a = (
        await query(
          "SELECT * FROM guest_photo_retrieval_addresses WHERE id=$1 AND album_id=$2 FOR UPDATE",
          [id, albumId],
        )
      ).rows[0],
      phone = decryptSecretJson(a.contact_ciphertext).phone;
    await query(
      "UPDATE guest_photo_retrieval_addresses SET email_hash=$2,contact_ciphertext=$3,version=version+1,status='ACTIVE',updated_at=now(),corrected_by=$4 WHERE id=$1",
      [
        id,
        fingerprint("EMAIL", email),
        encryptSecretJson({ phone, email }),
        user.id,
      ],
    );
    await audit("guest_retrieval_address_corrected", id, user, {
      albumId,
      personId: a.person_id,
      previousVersion: a.version,
      newVersion: a.version + 1,
      evidence: input.evidence.trim(),
      verificationStatus: "UNVERIFIED",
    });
    return guestRetrievalAdmin(albumId);
  });
}
export async function processGuestRetrievalEmails({
  limit: batchLimit = 10,
} = {}) {
  if (
    !(await query("SELECT to_regclass('guest_photo_retrieval_addresses') AS t"))
      .rows[0].t
  )
    return { processed: 0 };
  await query(
    "UPDATE keepsakes_photo_requests SET guest_retrieval_delivery_state='UNKNOWN' WHERE guest_retrieval_delivery_state='SUBMITTING' AND created_at<now()-interval '10 minutes'",
  );
  await query(
    "DELETE FROM guest_photo_retrieval_sessions WHERE expires_at<now()-interval '1 day'",
  );
  await query(
    "DELETE FROM guest_photo_retrieval_limits WHERE window_started_at<now()-interval '1 day' AND (blocked_until IS NULL OR blocked_until<now())",
  );
  let processed = 0;
  for (let i = 0; i < batchLimit; i++) {
    const request = await transaction(async () => {
      const r = (
        await query(
          "SELECT * FROM keepsakes_photo_requests WHERE guest_retrieval_delivery_state='QUEUED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!r) return null;
      let allowed = !!r.scopes.length;
      for (const scope of r.scopes)
        if (!(await scopeAnchors(scope)).length) allowed = false;
      if (!allowed) {
        await query(
          "UPDATE keepsakes_photo_requests SET guest_retrieval_delivery_state='SUPPRESSED' WHERE id=$1",
          [r.id],
        );
        await query(
          "UPDATE communications SET status='CANCELLED' WHERE id=$1 AND status='DRAFT'",
          [r.communication_id],
        );
        return { skip: true };
      }
      await query(
        "UPDATE keepsakes_photo_requests SET guest_retrieval_delivery_state='SUBMITTING',expires_at=now()+interval '30 minutes' WHERE id=$1",
        [r.id],
      );
      return r;
    });
    if (!request) break;
    if (request.skip) continue;
    try {
      const c = (
        await query("SELECT recipient FROM communications WHERE id=$1", [
          request.communication_id,
        ])
      ).rows[0];
      stagingEmailPolicy(
        { to: c.recipient },
        { ...process.env, STAGING_EMAIL_ALLOW_ANY_RECIPIENT: "false" },
      );
      await sendCommunication(
        request.communication_id,
        {},
        { guestRetrievalClaim: true },
      );
      await query(
        "UPDATE keepsakes_photo_requests SET guest_retrieval_delivery_state='SENT_TO_PROVIDER' WHERE id=$1",
        [request.id],
      );
    } catch (e) {
      await query(
        "UPDATE keepsakes_photo_requests SET guest_retrieval_delivery_state=$2 WHERE id=$1",
        [request.id, e.details?.outcomeUnknown ? "UNKNOWN" : "FAILED"],
      );
    }
    processed++;
  }
  return { processed };
}
