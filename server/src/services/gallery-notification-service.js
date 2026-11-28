import crypto from "node:crypto";
import {
  fetchGalleryMessage,
  submitApprovedGallerySms,
} from "./gallery-twilio-adapter.js";
import { query, transaction } from "../db/pool.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { encryptSecretJson, decryptSecretJson } from "./integration-secrets.js";
import { writeAudit } from "./audit-service.js";
import {
  createCommunicationDraft,
  sendCommunication,
  brandedEmailHtml,
} from "./automation-service.js";
import { stagingEmailPolicy } from "../config/staging-safety.js";
import {
  contactScopes,
  scopeAnchors,
} from "./keepsakes-photo-access-service.js";
import { normalizePhotoLookup } from "../../../shared/keepsakes-photo-access.js";
import {
  defaultNotificationSettings,
  validateNotificationSettings,
  estimateMessage,
  usMobile,
  nextDeliveryState,
} from "../../../shared/gallery-notification-policy.js";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const notificationContactHash = (channel, value) =>
  crypto
    .createHmac("sha256", env.integrationSecretKey)
    .update(channel + ":" + value)
    .digest("hex");
const secret = () => crypto.randomBytes(32).toString("base64url");
const fail = (message, code = "GALLERY_NOTIFICATION_BLOCKED") =>
  new AppError(message, 409, code);
const unavailable = () =>
  new AppError(
    "This photo link has expired or is unavailable. Please use your original link or contact your event host.",
    404,
    "PHOTO_ACCESS_UNAVAILABLE",
  );
const audit = (action, id, user, after) =>
  writeAudit({
    req: { user },
    action,
    entity: "gallery_notification",
    entityId: id,
    after,
  });
const event = (publicationId, kind, details = {}, deliveryId = null) =>
  query(
    "INSERT INTO gallery_notification_events(publication_id,delivery_id,kind,details) VALUES($1,$2,$3,$4)",
    [publicationId, deliveryId, kind, details],
  );
function origin() {
  if (process.env.APP_ENV === "staging")
    return "https://staginggallery.thelolabooth.com";
  if (process.env.APP_ENV === "production")
    return "https://gallery.thelolabooth.com";
  return "http://localhost:5173";
}
function masked(channel, value) {
  return channel === "SMS"
    ? "••• ••• " + value.slice(-4)
    : value[0] + "•••@" + value.split("@")[1];
}
async function settings(lock = false) {
  const row = (
    await query(
      "SELECT * FROM gallery_notification_settings WHERE id=true" +
        (lock ? " FOR UPDATE" : ""),
    )
  ).rows[0];
  return {
    config: { ...defaultNotificationSettings, ...row.config },
    version: row.version,
  };
}
export async function notificationSettings() {
  const s = await settings();
  return {
    ...s,
    mode: "SIMULATED",
    liveSendingAvailable: false,
    credentials: {
      account: !!process.env.TWILIO_ACCOUNT_SID,
      key: !!process.env.TWILIO_API_KEY_SID,
      secret: !!process.env.TWILIO_API_KEY_SECRET,
      service: !!process.env.TWILIO_MESSAGING_SERVICE_SID,
      webhook: !!process.env.TWILIO_AUTH_TOKEN,
    },
    phoneLookup:
      "Trusted ownership required. Token-scoped email verification never establishes phone ownership.",
  };
}
export async function saveNotificationSettings(input, user) {
  let config;
  try {
    config = validateNotificationSettings(input);
  } catch (e) {
    throw new AppError(e.message, 422, "INVALID_NOTIFICATION_SETTINGS");
  }
  return transaction(async () => {
    await settings(true);
    await query(
      "UPDATE gallery_notification_settings SET config=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=true",
      [config, user.id],
    );
    await audit("gallery_notification_settings_changed", null, user, {
      config,
      mode: "SIMULATED",
    });
    return notificationSettings();
  });
}
async function contacts(albumId) {
  const rows = (
    await query(
      `SELECT DISTINCT ON(s.person_id,s.channel) s.person_id,s.channel,s.recipient_ciphertext,p.display_name,p.status,a.evidence,a.revoked_at
 FROM fiesta_gallery_shares s JOIN gallery_people p ON p.id=s.person_id AND p.album_id=s.album_id
 LEFT JOIN gallery_notification_authorizations a ON a.album_id=s.album_id AND a.person_id=s.person_id AND a.channel=s.channel WHERE s.album_id=$1 ORDER BY s.person_id,s.channel,s.created_at DESC`,
      [albumId],
    )
  ).rows;
  const groups = new Map();
  let invalid = 0,
    duplicates = 0,
    validMobile = 0;
  for (const row of rows) {
    const raw = decryptSecretJson(row.recipient_ciphertext).recipient;
    const value =
      row.channel === "SMS"
        ? usMobile(raw)
        : normalizePhotoLookup("EMAIL", raw);
    if (!value) {
      invalid++;
      continue;
    }
    if (row.channel === "SMS") validMobile++;
    const key = notificationContactHash(row.channel, value);
    const group = groups.get(key);
    if (group) {
      if (row.channel === "SMS") duplicates++;
      group.people.push(row);
    } else
      groups.set(key, {
        hash: key,
        channel: row.channel,
        value,
        people: [row],
      });
  }
  return {
    groups: [...groups.values()],
    invalid,
    duplicates,
    validMobile,
    total: (
      await query(
        "SELECT count(*)::int n FROM gallery_people WHERE album_id=$1",
        [albumId],
      )
    ).rows[0].n,
  };
}
async function existingSmsOptOut(phone) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return (
    (
      await query(
        "SELECT 1 FROM clients WHERE (sms_opted_out_at IS NOT NULL OR sms_consent_status='OPTED_OUT') AND right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),10)=$1 UNION ALL SELECT 1 FROM leads WHERE (sms_opted_out_at IS NOT NULL OR sms_consent_status='OPTED_OUT') AND right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),10)=$1 LIMIT 1",
        [digits],
      )
    ).rowCount > 0
  );
}
async function eligible(albumId) {
  const imported = await contacts(albumId),
    all = [];
  let excluded = 0;
  for (const group of imported.groups) {
    const suppressed = (
      await query(
        "SELECT 1 FROM gallery_notification_suppressions WHERE contact_hash=$1",
        [group.hash],
      )
    ).rowCount;
    const people = group.people.filter(
      (p) => p.status === "ACTIVE" && p.evidence && !p.revoked_at,
    );
    if (
      suppressed ||
      !people.length ||
      (group.channel === "SMS" && (await existingSmsOptOut(group.value)))
    ) {
      if (group.channel === "SMS") excluded++;
      continue;
    }
    const ids = new Set(people.map((p) => p.person_id));
    const scopes = (await contactScopes(group.channel, group.value)).filter(
      (s) => s.albumId === albumId && ids.has(s.personId),
    );
    if (!scopes.length) {
      if (group.channel === "SMS") excluded++;
      continue;
    }
    all.push({ ...group, scopes });
  }
  return { ...imported, all, excluded };
}
export async function notificationContacts(albumId) {
  const c = await contacts(albumId);
  return c.groups.flatMap((g) =>
    g.people.map((p) => ({
      personId: p.person_id,
      name: p.display_name,
      channel: g.channel,
      recipient: masked(g.channel, g.value),
      authorized: !!p.evidence && !p.revoked_at,
      evidence: p.evidence || "",
    })),
  );
}
export async function authorizeNotification(albumId, input, user) {
  const { personId, channel, evidence, authorized } = input;
  if (
    !["EMAIL", "SMS"].includes(channel) ||
    typeof evidence !== "string" ||
    evidence.trim().length < 10 ||
    evidence.length > 1000
  )
    throw new AppError(
      "Record the source and wording of the guest’s transactional photo-delivery authorization.",
      422,
      "CONSENT_EVIDENCE_REQUIRED",
    );
  if (
    !(
      await query(
        "SELECT 1 FROM fiesta_gallery_shares WHERE album_id=$1 AND person_id=$2 AND channel=$3",
        [albumId, personId, channel],
      )
    ).rowCount
  )
    throw unavailable();
  await transaction(async () => {
    await query(
      `INSERT INTO gallery_notification_authorizations(album_id,person_id,channel,evidence,authorized_by,revoked_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $6 THEN NULL ELSE now() END) ON CONFLICT(album_id,person_id,channel) DO UPDATE SET evidence=EXCLUDED.evidence,authorized_by=EXCLUDED.authorized_by,authorized_at=now(),revoked_at=EXCLUDED.revoked_at`,
      [
        albumId,
        personId,
        channel,
        evidence.trim(),
        user.id,
        authorized === true,
      ],
    );
    await audit(
      "gallery_photo_delivery_authorization_recorded",
      albumId,
      user,
      {
        personId,
        channel,
        authorized: authorized === true,
        evidence: evidence.trim(),
      },
    );
  });
  return { saved: true };
}
async function publication(albumId) {
  const p = (
    await query(
      `SELECT p.*,a.title,a.status,a.expires_at FROM gallery_notification_publications p JOIN gallery_albums a ON a.id=p.album_id WHERE p.album_id=$1`,
      [albumId],
    )
  ).rows[0];
  if (
    !p ||
    !["PUBLISHED", "DELIVERED"].includes(p.status) ||
    (p.expires_at && new Date(p.expires_at) <= new Date())
  )
    throw fail("Publish an active Gallery before reviewing notifications.");
  return p;
}
async function emailRequest(recipient, scopes, subject, bodyMaker, trigger) {
  const code = secret(),
    request = (
      await query(
        `INSERT INTO keepsakes_photo_requests(target_hash,token_hash,scopes,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes') RETURNING id`,
        [
          notificationContactHash("EMAIL", recipient),
          hash(code),
          JSON.stringify(scopes),
        ],
      )
    ).rows[0];
  const link = origin() + "/photos/access#code=" + code;
  const body = bodyMaker(link);
  const message = await createCommunicationDraft({
    channel: "EMAIL",
    recipient,
    subject,
    body,
    html: brandedEmailHtml(body, {
      kicker: "YOUR LOLA BOOTH PHOTOS",
      ctaUrl: link,
      ctaLabel: "View My Photos",
      secondaryCta: {
        url:
          (process.env.APP_ENV === "staging"
            ? "https://stagingshop.thelolabooth.com"
            : "https://shop.thelolabooth.com") + "/shop",
        label: "Explore Keepsakes",
        copyLabel: "Explore the Lola Keepsakes collection:",
      },
    }),
    status: "DRAFT",
    trigger_key: trigger,
  });
  await query(
    "UPDATE keepsakes_photo_requests SET communication_id=$2 WHERE id=$1",
    [request.id, message.id],
  );
  return message;
}
export async function onGalleryPublished(albumId, user) {
  // Called inside the existing publication transaction; import/mapping has no delivery side effects.
  const album = (
    await query("SELECT * FROM gallery_albums WHERE id=$1", [albumId])
  ).rows[0];
  const p = (
    await query(
      `INSERT INTO gallery_notification_publications(album_id,event_id,published_by) VALUES($1,$2,$3) ON CONFLICT(album_id) DO UPDATE SET album_id=EXCLUDED.album_id RETURNING *`,
      [albumId, album.event_id, user.id],
    )
  ).rows[0];
  const recipients = await eligible(albumId);
  let queued = 0;
  for (const g of recipients.all.filter((g) => g.channel === "EMAIL")) {
    const d = (
      await query(
        `INSERT INTO gallery_notification_deliveries(publication_id,event_id,channel,contact_hash,contact_ciphertext,scopes,status) VALUES($1,$2,'EMAIL',$3,$4,$5,'QUEUED') ON CONFLICT(event_id,channel,contact_hash) DO NOTHING RETURNING id`,
        [
          p.id,
          p.event_id,
          g.hash,
          encryptSecretJson({ recipient: g.value }),
          JSON.stringify(g.scopes),
        ],
      )
    ).rows[0];
    if (!d) continue;
    const communication = await emailRequest(
      g.value,
      g.scopes,
      "Your Lola Booth Photos Are Ready!",
      (link) =>
        `Your favorite moments are ready!\n\nThank you for celebrating with The Lola Booth.\n\nView My Photos:\n${link}\n\nThis secure link expires in 30 minutes. You can request a fresh email link from Find My Photos.\n\nWhen you’re ready, turn your favorite memories into personalized Keepsakes.\nExplore Keepsakes: ${process.env.APP_ENV === "staging" ? "https://stagingshop.thelolabooth.com" : "https://shop.thelolabooth.com"}/shop`,
      "GALLERY_PUBLICATION",
    );
    await query(
      "UPDATE gallery_notification_deliveries SET communication_id=$2 WHERE id=$1",
      [d.id, communication.id],
    );
    queued++;
  }
  await event(p.id, "PUBLISHED", { emailQueued: queued });
  return { emailQueued: queued };
}
async function budget() {
  const month = (await query("SELECT date_trunc('month',now())::date AS month"))
    .rows[0].month;
  await query(
    "INSERT INTO gallery_notification_budgets(month) VALUES($1) ON CONFLICT DO NOTHING",
    [month],
  );
  const b = (
    await query("SELECT * FROM gallery_notification_budgets WHERE month=$1", [
      month,
    ])
  ).rows[0];
  return {
    month,
    reserved: Number(b.reserved_micros),
    actual: Number(b.actual_micros),
  };
}
export async function reviewGallerySms(albumId, user, {eventId=null}={}) {
  return transaction(async () => {
    const p = await publication(albumId),
      s = await settings(),
      b = await budget(),
      recipients = eventId?await eligibleEventPhotoRecipients(eventId,user):await eligible(albumId),
      pending = [];
    if(eventId&&eventId!==p.event_id)throw fail("Choose the Gallery for this event.");
    let already = 0;
    for (const g of recipients.all.filter((g) => g.channel === "SMS")) {
      if (
        (
          await query(
            "SELECT 1 FROM gallery_notification_deliveries WHERE event_id=$1 AND channel='SMS' AND contact_hash=$2",
            [p.event_id, g.hash],
          )
        ).rowCount
      ) {
        already++;
        continue;
      }
      const code = secret(),
        link = origin() + "/photos/phone-access#code=" + code,
        m = estimateMessage(s.config.template, link, s.config);
      pending.push({
        hash: g.hash,
        recipient: g.value,
        scopes: g.scopes,
        code,
        ...m,
      });
    }
    const priced = pending.every((p) => p.costMicros !== null),
      cost = priced ? pending.reduce((v, p) => v + p.costMicros, 0) : null;
    const gallerySpent = Number(
      (
        await query(
          "SELECT COALESCE(sum(GREATEST(estimated_micros,COALESCE(actual_micros,0))),0) AS n FROM gallery_notification_deliveries WHERE publication_id=$1 AND channel='SMS'",
          [p.id],
        )
      ).rows[0].n,
    );
    const reasons = [];
    if (!s.config.enabled)
      reasons.push("Gallery SMS is disabled in notification settings.");
    if (!priced)
      reasons.push(
        "Configure current US base, carrier and additional fee rates with pricing evidence.",
      );
    if (!pending.length) reasons.push("No new authorized SMS recipients.");
    if (pending.length > s.config.maxRecipients)
      reasons.push("Recipient limit exceeded.");
    if (pending.some((p) => p.segments > s.config.maxSegments))
      reasons.push("A rendered message exceeds the segment limit.");
    if (cost !== null && cost + gallerySpent > s.config.galleryLimitMicros)
      reasons.push("Per-gallery spending limit exceeded.");
    if (
      cost !== null &&
      cost + b.reserved + b.actual > s.config.monthlyBudgetMicros
    )
      reasons.push("Monthly budget exceeded.");
    const snapshot = {
      eventScope: eventId,
      eventName: p.title,
      eventId: p.event_id,
      totalGuests: recipients.total,
      validMobile: recipients.validMobile,
      duplicates: recipients.duplicates,
      invalid: recipients.invalid,
      consentExcluded: recipients.excluded,
      alreadyNotified: already,
      eligible: pending.length,
      segments: pending.reduce((v, p) => v + p.segments, 0),
      estimatedMicros: cost,
      remainingMicros: Math.max(
        0,
        s.config.monthlyBudgetMicros - b.reserved - b.actual,
      ),
      month: b.month,
      settings: s.config,
      mode: "SIMULATED",
      warning: cost !== null && cost >= s.config.warningMicros,
      reasons,
      sampleBody:
        pending[0]?.body.replace(
          /#code=[\w-]+/,
          "#code=[recipient-specific link]",
        ) || null,
    };
    const review = (
      await query(
        "INSERT INTO gallery_notification_reviews(publication_id,settings_version,snapshot,recipients_ciphertext,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at",
        [
          p.id,
          s.version,
          snapshot,
          encryptSecretJson({ recipients: pending }),
          user.id,
        ],
      )
    ).rows[0];
    return { ...snapshot, id: review.id, expiresAt: review.expires_at };
  });
}
export async function decideGallerySms(albumId, reviewId, decision, user) {
  return transaction(async () => {
    // Serialize all approvals, settings edits and reservations across galleries.
    const s = await settings(true),
      p = await publication(albumId),
      r = (
        await query(
          "SELECT * FROM gallery_notification_reviews WHERE id=$1 AND publication_id=$2 FOR UPDATE",
          [reviewId, p.id],
        )
      ).rows[0];
    if (!r) throw unavailable();
    if (r.decision) {
      if (r.decision === decision)
        return { decision: r.decision, duplicatePrevented: true };
      throw fail("This review already has a decision. Open a fresh review.");
    }
    if (!["APPROVED", "CANCELED"].includes(decision))
      throw fail("Choose Confirm or Cancel.");
    if (decision === "CANCELED") {
      await query(
        "UPDATE gallery_notification_reviews SET decision='CANCELED',decided_by=$2,decided_at=now() WHERE id=$1",
        [r.id, user.id],
      );
      await event(p.id, "SMS_CANCELED");
      await audit("gallery_sms_canceled", r.id, user, {});
      return { decision: "CANCELED" };
    }
    if (
      new Date(r.expires_at) <= new Date() ||
      r.settings_version !== s.version
    )
      throw fail(
        "This review has expired or settings changed. Review recipients and costs again.",
      );
    if (r.snapshot.reasons.length) throw fail(r.snapshot.reasons.join(" "));
    if(r.snapshot.eventScope&&r.snapshot.eventScope!==p.event_id)throw fail("Event selection changed. Review again.");
    const fresh = r.snapshot.eventScope?await eligibleEventPhotoRecipients(r.snapshot.eventScope,user):await eligible(albumId),
      current = new Map(
        fresh.all.filter((g) => g.channel === "SMS").map((g) => [g.hash, g]),
      ),
      pending = decryptSecretJson(r.recipients_ciphertext).recipients;
    for (const g of pending) {
      const c = current.get(g.hash);
      if (
        !c ||
        JSON.stringify(
          [...c.scopes].sort((a, b) => a.personId.localeCompare(b.personId)),
        ) !==
          JSON.stringify(
            [...g.scopes].sort((a, b) => a.personId.localeCompare(b.personId)),
          ) ||
        (
          await query(
            "SELECT 1 FROM gallery_notification_deliveries WHERE event_id=$1 AND channel='SMS' AND contact_hash=$2",
            [p.event_id, g.hash],
          )
        ).rowCount
      )
        throw fail("Recipient eligibility changed. Open a fresh review.");
    }
    const b = await budget(),
      cost = r.snapshot.estimatedMicros;
    if (
      b.month !== r.snapshot.month ||
      b.reserved + b.actual + cost > s.config.monthlyBudgetMicros
    )
      throw fail("Available budget changed. Open a fresh review.");
    const spent = Number(
      (
        await query(
          "SELECT COALESCE(sum(GREATEST(estimated_micros,COALESCE(actual_micros,0))),0) AS n FROM gallery_notification_deliveries WHERE publication_id=$1 AND channel='SMS'",
          [p.id],
        )
      ).rows[0].n,
    );
    if (spent + cost > s.config.galleryLimitMicros)
      throw fail("Per-gallery budget exceeded.");
    await query(
      "UPDATE gallery_notification_budgets SET reserved_micros=reserved_micros+$2 WHERE month=$1",
      [b.month, cost],
    );
    for (const g of pending) {
      const d = (
        await query(
          `INSERT INTO gallery_notification_deliveries(publication_id,event_id,channel,contact_hash,contact_ciphertext,scopes,status,review_id,body_ciphertext,segments,estimated_micros,budget_month,reserved_micros) VALUES($1,$2,'SMS',$3,$4,$5,'APPROVED',$6,$7,$8,$9,$10,$9) RETURNING id`,
          [
            p.id,
            p.event_id,
            g.hash,
            encryptSecretJson({ recipient: g.recipient }),
            JSON.stringify(g.scopes),
            r.id,
            encryptSecretJson({ body: g.body }),
            g.segments,
            g.costMicros,
            b.month,
          ],
        )
      ).rows[0];
      await query(
        "INSERT INTO gallery_phone_access(delivery_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [d.id, hash(g.code)],
      );
    }
    await query(
      "UPDATE gallery_notification_reviews SET decision='APPROVED',decided_by=$2,decided_at=now() WHERE id=$1",
      [r.id, user.id],
    );
    await event(p.id, "SMS_APPROVED", {
      recipients: pending.length,
      segments: r.snapshot.segments,
      estimatedMicros: cost,
      mode: "SIMULATED",
    });
    await audit("gallery_sms_approved", r.id, user, {
      recipients: pending.length,
      estimatedMicros: cost,
      settingsVersion: r.settings_version,
      mode: "SIMULATED",
    });
    return {
      decision: "APPROVED",
      recipients: pending.length,
      mode: "SIMULATED",
    };
  });
}
async function stillAuthorized(d) {
  if (
    d.channel === "SMS" &&
    (await existingSmsOptOut(decryptSecretJson(d.contact_ciphertext).recipient))
  )
    return false;
  if (
    (
      await query(
        "SELECT 1 FROM gallery_notification_suppressions WHERE contact_hash=$1",
        [d.contact_hash],
      )
    ).rowCount
  )
    return false;
  for (const scope of d.scopes) {
    if (
      !(
        await query(
          "SELECT 1 FROM gallery_notification_authorizations WHERE album_id=$1 AND person_id=$2 AND channel=$3 AND revoked_at IS NULL",
          [scope.albumId, scope.personId, d.channel],
        )
      ).rowCount ||
      !(await scopeAnchors(scope)).length
    )
      return false;
  }
  return d.scopes.length > 0;
}
async function releaseReservation(d) {
  if (!d.reserved_micros || !d.budget_month) return;
  await query(
    "UPDATE gallery_notification_budgets SET reserved_micros=reserved_micros-$2 WHERE month=$1",
    [d.budget_month, Number(d.reserved_micros)],
  );
  await query(
    "UPDATE gallery_notification_deliveries SET reserved_micros=0 WHERE id=$1",
    [d.id],
  );
}
export async function processGalleryNotifications({ limit = 10 } = {}) {
  if (
    !(await query("SELECT to_regclass('gallery_notification_deliveries') AS t"))
      .rows[0].t
  )
    return { processed: 0 };
  await query(
    "UPDATE gallery_notification_deliveries SET status='UNKNOWN',failure_code='DISPATCH_INTERRUPTED',updated_at=now() WHERE status='SUBMITTING' AND updated_at<now()-interval '10 minutes'",
  );
  const callbacks = (
    await query(
      "SELECT i.* FROM gallery_twilio_callback_inbox i JOIN gallery_notification_deliveries d ON d.provider_sid=i.provider_sid WHERE i.processed_at IS NULL ORDER BY i.created_at LIMIT 50",
    )
  ).rows;
  for (const c of callbacks)
    await galleryTwilioCallback({
      AccountSid: c.account_sid,
      MessagingServiceSid: c.service_sid,
      MessageSid: c.provider_sid,
      MessageStatus: c.status,
      ErrorCode: c.error_code,
    });
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const d = await transaction(async () => {
      const row = (
        await query(
          "SELECT * FROM gallery_notification_deliveries WHERE status IN('QUEUED','APPROVED') ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return null;
      if (!(await stillAuthorized(row))) {
        await query(
          "UPDATE gallery_notification_deliveries SET status='SUPPRESSED',updated_at=now() WHERE id=$1",
          [row.id],
        );
        await releaseReservation(row);
        return { skip: true };
      }
      if (row.channel === "SMS") {
        const month = (
          await query("SELECT date_trunc('month',now())::date AS month")
        ).rows[0].month;
        if (month !== row.budget_month) {
          await query(
            "UPDATE gallery_notification_deliveries SET status='SUPPRESSED',failure_code='BUDGET_MONTH_CHANGED',updated_at=now() WHERE id=$1",
            [row.id],
          );
          await releaseReservation(row);
          return { skip: true };
        }
        const config = await settings();
        if (!config.config.enabled) {
          await query(
            "UPDATE gallery_notification_deliveries SET status='SUPPRESSED',failure_code='SMS_DISABLED',updated_at=now() WHERE id=$1",
            [row.id],
          );
          await releaseReservation(row);
          return { skip: true };
        }
        if (
          !(
            await query(
              "SELECT 1 FROM gallery_phone_access WHERE delivery_id=$1 AND revoked_at IS NULL AND expires_at>now()",
              [row.id],
            )
          ).rowCount
        ) {
          await query(
            "UPDATE gallery_notification_deliveries SET status='SUPPRESSED',failure_code='LINK_EXPIRED',updated_at=now() WHERE id=$1",
            [row.id],
          );
          await releaseReservation(row);
          return { skip: true };
        }
      }
      await query(
        "UPDATE gallery_notification_deliveries SET status='SUBMITTING',updated_at=now() WHERE id=$1",
        [row.id],
      );
      return row;
    });
    if (!d) break;
    if (d.skip) continue;
    try {
      if (d.channel === "SMS") {
        const result = await submitApprovedGallerySms({
          to: decryptSecretJson(d.contact_ciphertext).recipient,
          body: decryptSecretJson(d.body_ciphertext).body,
        });
        await transaction(async () => {
          await query(
            "UPDATE gallery_notification_deliveries SET status=$2,provider_sid=$3,submitted_at=now(),updated_at=now() WHERE id=$1",
            [
              d.id,
              result.simulated
                ? "SIMULATED"
                : nextDeliveryState("SUBMITTING", result.status),
              result.sid || null,
            ],
          );
          if (result.simulated) await releaseReservation(d);
          await event(
            d.publication_id,
            result.simulated ? "SMS_SIMULATED" : "SMS_SUBMITTED",
            {
              segments: d.segments,
              estimatedMicros: Number(d.estimated_micros),
            },
            d.id,
          );
        });
      } else {
        const recipient = decryptSecretJson(d.contact_ciphertext).recipient;
        // Ignore the legacy broad QA switch: Gallery notifications always require an explicit test inbox in staging.
        stagingEmailPolicy(
          { to: recipient, subject: "Gallery photo delivery" },
          { ...process.env, STAGING_EMAIL_ALLOW_ANY_RECIPIENT: "false" },
        );
        await query(
          "UPDATE keepsakes_photo_requests SET expires_at=now()+interval '30 minutes' WHERE communication_id=$1 AND redeemed_at IS NULL",
          [d.communication_id],
        );
        const result = await sendCommunication(
          d.communication_id,
          {},
          { galleryClaim: true },
        );
        await query(
          "UPDATE gallery_notification_deliveries SET status=$2,submitted_at=now(),updated_at=now() WHERE id=$1",
          [d.id, result.communication.status],
        );
        await event(d.publication_id, "EMAIL_SUBMITTED", {}, d.id);
      }
    } catch (e) {
      await query(
        "UPDATE gallery_notification_deliveries SET status=$2,failure_code=$3,updated_at=now() WHERE id=$1",
        [
          d.id,
          e.details?.outcomeUnknown ||
          (d.channel === "SMS" && !e.code?.startsWith?.("GALLERY_SMS_"))
            ? "UNKNOWN"
            : "FAILED",
          String(e.code || "DELIVERY_FAILED").slice(0, 100),
        ],
      );
      await event(
        d.publication_id,
        "DELIVERY_FAILED",
        { code: e.code || "DELIVERY_FAILED" },
        d.id,
      );
    }
    processed++;
  }
  return { processed };
}
export async function notificationPanel(albumId) {
  const p = (
    await query(
      "SELECT * FROM gallery_notification_publications WHERE album_id=$1",
      [albumId],
    )
  ).rows[0];
  if (!p) return { published: false, deliveries: [], events: [] };
  const deliveries = (
    await query(
      `SELECT d.id,d.channel,d.status,d.segments,d.estimated_micros,d.actual_micros,d.price_currency,d.failure_code,d.created_at,d.submitted_at,d.updated_at,d.contact_ciphertext,c.status AS email_status,c.failure_code AS email_failure_code FROM gallery_notification_deliveries d LEFT JOIN communications c ON c.id=d.communication_id WHERE d.publication_id=$1 ORDER BY d.created_at DESC`,
      [p.id],
    )
  ).rows.map(({ contact_ciphertext, ...d }) => ({
    ...d,
    recipient: masked(
      d.channel,
      decryptSecretJson(contact_ciphertext).recipient,
    ),
  }));
  const events = (
    await query(
      "SELECT id,kind,details,created_at FROM gallery_notification_events WHERE publication_id=$1 ORDER BY created_at DESC LIMIT 100",
      [p.id],
    )
  ).rows;
  const eligibility = await eligible(albumId);
  const metrics = Object.fromEntries(
    (
      await query(
        "SELECT kind,count(*)::int AS count FROM gallery_notification_events WHERE publication_id=$1 GROUP BY kind",
        [p.id],
      )
    ).rows.map((r) => [r.kind, r.count]),
  );
  return {
    metrics,
    published: true,
    publicationId: p.id,
    eligibleEmail: eligibility.all.filter((r) => r.channel === "EMAIL").length,
    eligibleSms: eligibility.all.filter((r) => r.channel === "SMS").length,
    deliveries,
    events,
    mode: "SIMULATED",
  };
}
async function phoneAccess(code, lock = false) {
  if (!/^[\w-]{43}$/.test(code || "")) throw unavailable();
  const row = (
    await query(
      `SELECT a.*,d.scopes,d.publication_id FROM gallery_phone_access a JOIN gallery_notification_deliveries d ON d.id=a.delivery_id WHERE a.token_hash=$1 AND a.revoked_at IS NULL AND a.consumed_at IS NULL AND a.expires_at>now() AND d.status IN('SIMULATED','SENT','DELIVERED','QUEUED','SENDING')` +
        (lock ? " FOR UPDATE OF a" : ""),
      [hash(code)],
    )
  ).rows[0];
  if (!row) throw unavailable();
  for (const scope of row.scopes)
    if (!(await scopeAnchors(scope)).length) throw unavailable();
  return row;
}
export async function inspectPhoneAccess(code) {
  await phoneAccess(code);
  return {
    emailVerificationRequired: true,
    message:
      "Verify your email to open only the photos shared by this link. This does not establish phone ownership.",
  };
}
export async function requestPhoneEmailVerification(code, email) {
  email = normalizePhotoLookup("EMAIL", email);
  if (!email)
    throw new AppError("Enter a valid email address.", 422, "EMAIL_REQUIRED");
  return transaction(async () => {
    const a = await phoneAccess(code, true);
    if (
      (
        await query(
          "SELECT 1 FROM gallery_phone_email_verifications WHERE access_id=$1 AND created_at>now()-interval '2 minutes'",
          [a.id],
        )
      ).rowCount
    )
      return { accepted: true };
    if (
      (
        await query(
          "SELECT count(*)::int n FROM gallery_phone_email_verifications WHERE access_id=$1",
          [a.id],
        )
      ).rows[0].n >= 5
    )
      throw fail(
        "Please use your original photo link or contact your event host.",
      );
    const verification = secret(),
      v = (
        await query(
          "INSERT INTO gallery_phone_email_verifications(access_id,email_ciphertext,token_hash,expires_at) VALUES($1,$2,$3,LEAST($4::timestamptz,now()+interval '15 minutes')) RETURNING id",
          [
            a.id,
            encryptSecretJson({ email }),
            hash(verification),
            a.expires_at,
          ],
        )
      ).rows[0];
    const message = await createCommunicationDraft({
      channel: "EMAIL",
      recipient: email,
      subject: "Verify your email to view your Lola Booth photos",
      body: `Verify this email address to open the photographs shared by your secure link.\n\n${origin()}/photos/verify-email#code=${verification}\n\nThe verification link expires in 15 minutes and can be used once. This grants access only to the photographs shared by that link, not permanent ownership of a phone number.`,
      status: "DRAFT",
      trigger_key: "GALLERY_EMAIL_VERIFICATION",
    });
    await query(
      "UPDATE gallery_phone_email_verifications SET communication_id=$2 WHERE id=$1",
      [v.id, message.id],
    );
    await event(a.publication_id, "EMAIL_VERIFICATION_REQUESTED");
    return { accepted: true };
  });
}
export async function verifyPhoneEmail(code) {
  if (!/^[\w-]{43}$/.test(code || "")) throw unavailable();
  return transaction(async () => {
    const v = (
      await query(
        `SELECT v.*,a.delivery_id,a.expires_at AS access_expiry,a.revoked_at,a.consumed_at,d.scopes,d.publication_id FROM gallery_phone_email_verifications v JOIN gallery_phone_access a ON a.id=v.access_id JOIN gallery_notification_deliveries d ON d.id=a.delivery_id WHERE v.token_hash=$1 FOR UPDATE OF a,v`,
        [hash(code)],
      )
    ).rows[0];
    if (
      !v ||
      v.verified_at ||
      v.revoked_at ||
      v.consumed_at ||
      new Date(v.expires_at) <= new Date() ||
      new Date(v.access_expiry) <= new Date()
    )
      throw unavailable();
    for (const scope of v.scopes)
      if (!(await scopeAnchors(scope)).length) throw unavailable();
    await query(
      "UPDATE gallery_phone_email_verifications SET verified_at=now() WHERE id=$1",
      [v.id],
    );
    await query(
      "UPDATE gallery_phone_access SET consumed_at=now() WHERE id=$1",
      [v.access_id],
    );
    const sessionToken = secret(),
      scopes = v.scopes.map((s) => ({ ...s, phoneAccessId: v.access_id }));
    await query(
      "INSERT INTO keepsakes_photo_sessions(token_hash,scopes,expires_at) VALUES($1,$2,$3)",
      [hash(sessionToken), JSON.stringify(scopes), v.access_expiry],
    );
    await event(v.publication_id, "TOKEN_SCOPED_EMAIL_VERIFIED");
    return {
      token: sessionToken,
      expiresAt: v.access_expiry,
      association: "TOKEN_SCOPED",
    };
  });
}
export async function processGalleryVerifications() {
  if (
    !(
      await query(
        "SELECT to_regclass('gallery_phone_email_verifications') AS t",
      )
    ).rows[0].t
  )
    return;
  const rows = (
    await query(
      `SELECT v.id,v.communication_id,v.email_ciphertext FROM gallery_phone_email_verifications v JOIN communications c ON c.id=v.communication_id WHERE c.status='DRAFT' AND v.expires_at>now() ORDER BY v.created_at LIMIT 10`,
    )
  ).rows;
  for (const v of rows) {
    try {
      stagingEmailPolicy(
        { to: decryptSecretJson(v.email_ciphertext).email },
        { ...process.env, STAGING_EMAIL_ALLOW_ANY_RECIPIENT: "false" },
      );
      await sendCommunication(v.communication_id, {}, { galleryClaim: true });
    } catch (e) {
      await query(
        "UPDATE communications SET status='FAILED',failure_code=$2 WHERE id=$1 AND status='DRAFT'",
        [v.communication_id, e.code || "VERIFICATION_FAILED"],
      );
    }
  }
}
export async function galleryTwilioCallback(body) {
  if (
    body.AccountSid !== process.env.TWILIO_ACCOUNT_SID ||
    body.MessagingServiceSid !== process.env.TWILIO_MESSAGING_SERVICE_SID
  )
    throw new AppError(
      "Callback account or service mismatch.",
      403,
      "TWILIO_CALLBACK_INVALID",
    );
  if (body.OptOutType) {
    if (body.OptOutType === "STOP" && usMobile(body.From)) {
      await query(
        "INSERT INTO gallery_notification_suppressions(contact_hash,channel,reason) VALUES($1,'SMS','TWILIO_STOP') ON CONFLICT(contact_hash) DO NOTHING",
        [notificationContactHash("SMS", usMobile(body.From))],
      );
    }
    return;
  }
  if (!/^SM[0-9a-f]{32}$/i.test(body.MessageSid || "")) return;
  const fingerprint = hash(
    [body.MessageSid, body.MessageStatus, body.ErrorCode || ""].join(":"),
  );
  await query(
    "INSERT INTO gallery_twilio_callback_inbox(fingerprint,provider_sid,account_sid,service_sid,status,error_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(fingerprint) DO NOTHING",
    [
      fingerprint,
      body.MessageSid,
      body.AccountSid,
      body.MessagingServiceSid,
      String(body.MessageStatus || "").slice(0, 30),
      body.ErrorCode || null,
    ],
  );
  await transaction(async () => {
    const d = (
      await query(
        "SELECT * FROM gallery_notification_deliveries WHERE provider_sid=$1 AND channel='SMS' FOR UPDATE",
        [body.MessageSid],
      )
    ).rows[0];
    if (!d) return;
    await query(
      "UPDATE gallery_twilio_callback_inbox SET processed_at=now() WHERE fingerprint=$1",
      [fingerprint],
    );
    const state = nextDeliveryState(d.status, body.MessageStatus);
    if (
      state === d.status &&
      (!body.ErrorCode || body.ErrorCode === d.failure_code)
    )
      return;
    await query(
      "UPDATE gallery_notification_deliveries SET status=$2,failure_code=COALESCE($3,failure_code),updated_at=now() WHERE id=$1",
      [d.id, state, body.ErrorCode || null],
    );
    await event(
      d.publication_id,
      "SMS_CALLBACK",
      { status: state, errorCode: body.ErrorCode || null },
      d.id,
    );
  });
}

export async function reconcileGallerySmsCost(
  albumId,
  deliveryId,
  user,
  { fetchMessage = fetchGalleryMessage } = {},
) {
  const row = (
    await query(
      "SELECT d.* FROM gallery_notification_deliveries d JOIN gallery_notification_publications p ON p.id=d.publication_id WHERE d.id=$1 AND p.album_id=$2 AND d.channel='SMS'",
      [deliveryId, albumId],
    )
  ).rows[0];
  if (!row?.provider_sid)
    throw fail(
      "This notification has no live provider message to reconcile. Staging simulation has no provider charges.",
    );
  const message = await fetchMessage(row.provider_sid);
  if (
    message.accountSid !== process.env.TWILIO_ACCOUNT_SID ||
    message.messagingServiceSid !== process.env.TWILIO_MESSAGING_SERVICE_SID
  )
    throw fail("Provider account or service mismatch.");
  if (message.price === null || message.price === undefined)
    return { available: false };
  if (
    String(message.priceUnit).toUpperCase() !== "USD" ||
    !Number.isFinite(Number(message.price))
  )
    throw fail("Provider currency or price requires manual review.");
  const micros = Math.round(Math.abs(Number(message.price)) * 1000000);
  if (!Number.isSafeInteger(micros))
    throw fail("Provider cost requires review.");
  return transaction(async () => {
    await settings(true);
    const d = (
      await query(
        "SELECT * FROM gallery_notification_deliveries WHERE id=$1 FOR UPDATE",
        [deliveryId],
      )
    ).rows[0];
    await query(
      "UPDATE gallery_notification_budgets SET reserved_micros=reserved_micros-$2,actual_micros=actual_micros+$3 WHERE month=$1",
      [
        d.budget_month,
        Number(d.reserved_micros),
        micros - Number(d.actual_micros || 0),
      ],
    );
    await query(
      "UPDATE gallery_notification_deliveries SET actual_micros=$2,price_currency='USD',reserved_micros=0,updated_at=now() WHERE id=$1",
      [d.id, micros],
    );
    await event(
      d.publication_id,
      "SMS_COST_RECONCILED",
      { providerMicros: micros, currency: "USD" },
      d.id,
    );
    await audit("gallery_sms_cost_reconciled", d.id, user, {
      providerMicros: micros,
      currency: "USD",
    });
    return { available: true, actualMicros: micros, currency: "USD" };
  });
}

export async function notificationReport(user) {
  const { assertFiestaReviewAccess } =
    await import("./fiesta-survey-review-service.js");
  const publications = (
    await query(
      "SELECT p.id,p.album_id,a.title,p.created_at FROM gallery_notification_publications p JOIN gallery_albums a ON a.id=p.album_id ORDER BY p.created_at DESC",
    )
  ).rows;
  const rows = [];
  for (const p of publications) {
    try {
      await assertFiestaReviewAccess(p.album_id, user);
    } catch (e) {
      if (e.statusCode === 403) continue;
      throw e;
    }
    const counts = (
      await query(
        "SELECT count(*) FILTER(WHERE channel='EMAIL')::int AS emails,count(*) FILTER(WHERE channel='EMAIL' AND status='FAILED')::int AS email_failed,count(*) FILTER(WHERE channel='SMS')::int AS sms_recipients,count(*) FILTER(WHERE channel='SMS' AND status IN('FAILED','UNDELIVERED'))::int AS sms_failed,COALESCE(sum(segments),0)::int AS segments,COALESCE(sum(estimated_micros) FILTER(WHERE channel='SMS'),0)::bigint AS estimated_micros,sum(actual_micros) FILTER(WHERE channel='SMS')::bigint AS actual_micros FROM gallery_notification_deliveries WHERE publication_id=$1",
        [p.id],
      )
    ).rows[0];
    const metrics = Object.fromEntries(
      (
        await query(
          "SELECT kind,count(*)::int AS count FROM gallery_notification_events WHERE publication_id=$1 GROUP BY kind",
          [p.id],
        )
      ).rows.map((r) => [r.kind, r.count]),
    );
    rows.push({ ...p, ...counts, metrics });
  }
  return { rows, mode: "SIMULATED", phoneOwnershipAssociationsEnabled: false };
}

// Campaigns reuse the Gallery delivery ledger, permissions and idempotency keys.
export {emailRequest as createEventPhotoEmail};
export async function eligibleEventPhotoRecipients(eventId,user){
 const {userCanAccessEvent}=await import('./event-operations-service.js');
 if(!await userCanAccessEvent(user,eventId))throw new AppError('Event access denied.',403,'FORBIDDEN');
 const albums=(await query("SELECT a.id,a.title,p.id publication_id FROM gallery_albums a JOIN events e ON e.id=a.event_id LEFT JOIN gallery_notification_publications p ON p.album_id=a.id WHERE a.event_id=$1 AND e.deleted_at IS NULL AND a.status IN('PUBLISHED','DELIVERED') AND (a.expires_at IS NULL OR a.expires_at>now()) ORDER BY a.created_at,a.id",[eventId])).rows;
 const groups=new Map();let invalid=0,duplicates=0,validMobile=0,excluded=0,total=0;
 for(const album of albums){const result=await eligible(album.id);invalid+=result.invalid;duplicates+=result.duplicates;validMobile+=result.validMobile;excluded+=result.excluded;total+=result.total;
  for(const g of result.all){const current=groups.get(g.hash);if(current){duplicates++;for(const scope of g.scopes)if(!current.scopes.some(s=>s.albumId===scope.albumId&&s.personId===scope.personId&&s.keyId===scope.keyId))current.scopes.push(scope);}else groups.set(g.hash,{...g,scopes:[...g.scopes]});}
 }
 return {albums,all:[...groups.values()],invalid,duplicates,validMobile,excluded,total};
}
