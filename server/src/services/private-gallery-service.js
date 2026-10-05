import crypto from "node:crypto";
import QRCode from "qrcode";
import { query, transaction } from "../db/pool.js";
import { env } from "../config/env.js";
import { documentOrigin } from "../utils/public-document-url.js";
import { AppError } from "../utils/errors.js";
import { writeAudit } from "./audit-service.js";
import {
  createCommunicationDraft,
  brandedEmailHtml,
  sendCommunication,
} from "./automation-service.js";
import { galleryStorage } from "./gallery-storage.js";
import {
  assertGalleryEnvironment,
  unavailable,
  hashCredential,
  normalizeCode,
  newGalleryCredentials,
  sealCredentials,
  openCredentials,
  grantUsable,
  downloadAllowed,
  issueMediaTicket,
  verifyMediaTicket,
  validateGalleryImage,
} from "./gallery-policy.js";
const environment = () => process.env.APP_ENV || process.env.NODE_ENV;
const secret = () => process.env.GALLERY_SIGNING_SECRET || env.jwtSecret;
const grantSelect = `SELECT k.*,a.event_id,a.status AS album_status,a.expires_at AS album_expires_at,a.title,a.cover_media_id,a.allow_download,a.allow_zip,COALESCE(p.allow_download,a.allow_personal_download) AS allow_personal_download,COALESCE(p.allow_zip,a.allow_personal_zip) AS allow_personal_zip,e.event_date,p.status AS person_status FROM gallery_access_keys k JOIN gallery_albums a ON a.id=k.album_id JOIN events e ON e.id=a.event_id LEFT JOIN gallery_people p ON p.id=k.person_id`;
export async function galleryActivity(grant, action, mediaId = null) {
  await query(
    "INSERT INTO gallery_activity(album_id,access_key_id,media_id,action) VALUES($1,$2,$3,$4)",
    [grant?.album_id || null, grant?.id || null, mediaId, action],
  );
}
async function usable(grant) {
  if (!grantUsable(grant)) {
    await galleryActivity(
      grant,
      grant &&
        ((grant.expires_at && Date.parse(grant.expires_at) <= Date.now()) ||
          (grant.album_expires_at &&
            Date.parse(grant.album_expires_at) <= Date.now()))
        ? "LINK_EXPIRED"
        : "ACCESS_DENIED",
    );
    throw unavailable();
  }
  return grant;
}
export async function resolveGalleryToken(type, token) {
  assertGalleryEnvironment();
  if (
    !["ALBUM", "PERSON"].includes(type) ||
    !/^[-_A-Za-z0-9]{43}$/.test(token || "")
  )
    throw unavailable();
  return usable(
    (
      await query(grantSelect + " WHERE k.token_hash=$1 AND k.type=$2", [
        hashCredential(token),
        type,
      ])
    ).rows[0],
  );
}
export async function resolveGalleryCode(code) {
  assertGalleryEnvironment();
  const normalized = normalizeCode(code);
  if (!/^[A-F0-9]{20}$/.test(normalized)) throw unavailable();
  const grant = await usable(
    (
      await query(grantSelect + " WHERE k.code_hash=$1", [
        hashCredential(normalized),
      ])
    ).rows[0],
  );
  const credentials = openCredentials(
    grant.encrypted_credentials,
    secret(),
    environment(),
  );
  return {
    path: `/gallery/${grant.type === "PERSON" ? "p" : "a"}/${credentials.token}`,
  };
}
export async function allowedMedia(grant) {
  return (
    await query(
      `SELECT m.id,m.mime_type,m.media_type,m.width,m.height,m.captured_at,m.size_bytes,m.storage_provider,m.storage_key FROM gallery_media m WHERE m.album_id=$1 AND m.status='VISIBLE' AND ($2='ALBUM' OR EXISTS(SELECT 1 FROM gallery_media_people mp WHERE mp.media_id=m.id AND mp.person_id=$3 AND mp.album_id=$1)) ORDER BY m.sort_order,m.created_at`,
      [grant.album_id, grant.type, grant.person_id],
    )
  ).rows;
}
export async function publicGalleryView(grant, recordOpen = true) {
  if (recordOpen) {
    await query(
      "UPDATE gallery_access_keys SET last_used_at=now() WHERE id=$1",
      [grant.id],
    );
    await galleryActivity(
      grant,
      grant.type === "PERSON" ? "PERSONAL_OPENED" : "ALBUM_OPENED",
    );
  }
  const media = await allowedMedia(grant);
  return {
    title: grant.type === "PERSON" ? "Your Photos" : grant.title,
    eventName: grant.title,
    eventDate: grant.event_date,
    type: grant.type,
    allowDownload: downloadAllowed(grant),
    allowZip: downloadAllowed(grant, true),
    expiresAt: grant.expires_at || grant.album_expires_at,
    cover: media.find((m) => m.id === grant.cover_media_id)?.id || media[0]?.id,
    media: media.map((m) => ({
      id: m.id,
      mimeType: m.mime_type,
      mediaType: m.media_type,
      width: m.width,
      height: m.height,
      url: `/api/gallery/media/${issueMediaTicket(grant.id, m.id, "view", secret(), environment())}`,
    })),
  };
}
export async function mediaTicket(grant, id, purpose = "download") {
  const media = (await allowedMedia(grant)).find((m) => m.id === id);
  if (!media || (purpose === "download" && !downloadAllowed(grant)))
    throw unavailable();
  return {
    url: `/api/gallery/media/${issueMediaTicket(grant.id, id, purpose, secret(), environment())}`,
  };
}
export async function authorizedMediaTicket(token) {
  assertGalleryEnvironment();
  const payload = verifyMediaTicket(token, secret(), environment());
  if (!["view", "download"].includes(payload.purpose)) throw unavailable();
  const grant = await usable(
    (await query(grantSelect + " WHERE k.id=$1", [payload.grantId])).rows[0],
  );
  if (payload.purpose === "download" && !downloadAllowed(grant))
    throw unavailable();
  const media = (await allowedMedia(grant)).find(
    (m) => m.id === payload.mediaId,
  );
  if (!media) throw unavailable();
  await galleryActivity(
    grant,
    payload.purpose === "download" ? "PHOTO_DOWNLOADED" : "PHOTO_VIEWED",
    media.id,
  );
  return { media, download: payload.purpose === "download" };
}
export async function listGalleryAlbums() {
  return (
    await query(
      `SELECT a.*,e.event_name,e.event_date,(SELECT count(*) FROM gallery_media m WHERE m.album_id=a.id AND m.status<>'ARCHIVED') photos,(SELECT count(*) FROM gallery_people p WHERE p.album_id=a.id AND p.status='ACTIVE') people FROM gallery_albums a JOIN events e ON e.id=a.event_id ORDER BY a.updated_at DESC`,
    )
  ).rows;
}
export async function createGalleryAlbum(eventId, title, user) {
  const event = (
    await query(
      "SELECT id,event_name FROM events WHERE id=$1 AND deleted_at IS NULL",
      [eventId],
    )
  ).rows[0];
  if (!event) throw unavailable();
  const album = (
    await query(
      "INSERT INTO gallery_albums(event_id,title) VALUES($1,$2) ON CONFLICT(event_id) DO UPDATE SET event_id=EXCLUDED.event_id RETURNING *",
      [eventId, title || event.event_name],
    )
  ).rows[0];
  await writeAudit({
    req: { user },
    action: "gallery_album_created",
    entity: "gallery_album",
    entityId: album.id,
    after: { event_id: eventId },
  });
  return album;
}
export async function adminGalleryAlbum(id) {
  const album = (
    await query(
      "SELECT a.*,e.event_name,e.event_date FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.id=$1",
      [id],
    )
  ).rows[0];
  if (!album) throw unavailable();
  const media = (
    await query(
      `SELECT m.id,m.filename,m.mime_type,m.captured_at,m.status,m.sort_order,m.size_bytes,(SELECT count(*)::int FROM gallery_activity x WHERE x.media_id=m.id AND x.action='PHOTO_VIEWED') views,(SELECT count(*)::int FROM gallery_activity x WHERE x.media_id=m.id AND x.action='PHOTO_DOWNLOADED') downloads,COALESCE(array_agg(mp.person_id) FILTER(WHERE mp.person_id IS NOT NULL),'{}') person_ids FROM gallery_media m LEFT JOIN gallery_media_people mp ON mp.media_id=m.id WHERE m.album_id=$1 GROUP BY m.id ORDER BY m.sort_order,m.created_at`,
      [id],
    )
  ).rows;
  const people = (
    await query(
      `SELECT p.*, (SELECT count(*) FROM gallery_media_people mp WHERE mp.person_id=p.id) photos FROM gallery_people p WHERE p.album_id=$1 ORDER BY p.created_at`,
      [id],
    )
  ).rows;
  const keys = (
    await query(
      `SELECT k.id,k.type,k.person_id,k.status,k.expires_at,k.last_used_at,k.created_at,(SELECT count(*) FROM gallery_activity x WHERE x.access_key_id=k.id AND x.action IN('ALBUM_OPENED','PERSONAL_OPENED')) views,(SELECT count(*) FROM gallery_activity x WHERE x.access_key_id=k.id AND x.action IN('PHOTO_DOWNLOADED','ZIP_DOWNLOADED')) downloads FROM gallery_access_keys k WHERE k.album_id=$1 ORDER BY k.created_at DESC`,
      [id],
    )
  ).rows;
  const activity = (
    await query(
      "SELECT action,count(*)::int AS count FROM gallery_activity WHERE album_id=$1 GROUP BY action",
      [id],
    )
  ).rows;
  let storage;
  try {
    storage = { provider: galleryStorage().provider, configured: true };
  } catch {
    storage = { provider: "unconfigured", configured: false };
  }
  return { album, media, people, keys, activity, storage };
}
export async function updateGalleryAlbum(id, input, user) {
  const allowed = [
    "title",
    "expires_at",
    "allow_download",
    "allow_zip",
    "allow_personal_download",
    "allow_personal_zip",
    "cover_media_id",
    "source_provider",
    "external_event_id",
  ];
  const values = Object.entries(input).filter(([k]) => allowed.includes(k));
  if (values.length)
    await query(
      `UPDATE gallery_albums SET ${values.map(([k], i) => `${k}=$${i + 2}`).join(",")},updated_at=now() WHERE id=$1`,
      [id, ...values.map(([, v]) => v)],
    );
  await writeAudit({
    req: { user },
    action: "gallery_album_updated",
    entity: "gallery_album",
    entityId: id,
    after: input,
  });
  return adminGalleryAlbum(id);
}
export async function transitionGalleryAlbum(id, status, user) {
  return transaction(async () => {
    const a = (
      await query("SELECT * FROM gallery_albums WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!a) throw unavailable();
    if (status === "PUBLISHED") {
      const count = (
        await query(
          "SELECT count(*)::int n FROM gallery_media WHERE album_id=$1 AND status='VISIBLE'",
          [id],
        )
      ).rows[0].n;
      if (!count)
        throw new AppError(
          "Add at least one visible photo before publishing.",
          422,
          "GALLERY_EMPTY",
        );
      if (a.expires_at && Date.parse(a.expires_at) <= Date.now())
        throw new AppError(
          "Extend the album expiration before publishing.",
          422,
          "GALLERY_EXPIRED",
        );
    }
    await query(
      "UPDATE gallery_albums SET status=$2,published_at=CASE WHEN $2='PUBLISHED' THEN now() ELSE published_at END,updated_at=now() WHERE id=$1",
      [id, status],
    );
    await writeAudit({
      req: { user },
      action: "gallery_status_changed",
      entity: "gallery_album",
      entityId: id,
      before: { status: a.status },
      after: { status },
    });
    if (status === "PUBLISHED")
      await galleryActivity({ album_id: id }, "PUBLISHED");
    return adminGalleryAlbum(id);
  });
}
export async function createGalleryPerson(albumId, name) {
  return (
    await query(
      "INSERT INTO gallery_people(album_id,display_name) SELECT $1,COALESCE(NULLIF($2,''),'Person '||lpad((count(*)+1)::text,3,'0')) FROM gallery_people WHERE album_id=$1 RETURNING *",
      [albumId, name || ""],
    )
  ).rows[0];
}
export async function createGalleryKey(
  albumId,
  type,
  personId,
  expiresAt,
  user,
) {
  const credentials = newGalleryCredentials();
  const row = (
    await query(
      `INSERT INTO gallery_access_keys(album_id,type,person_id,code_hash,token_hash,encrypted_credentials,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        albumId,
        type,
        personId || null,
        hashCredential(credentials.code),
        hashCredential(credentials.token),
        sealCredentials(credentials, secret(), environment()),
        expiresAt || null,
      ],
    )
  ).rows[0];
  await writeAudit({
    req: { user },
    action: "gallery_key_created",
    entity: "gallery_access_key",
    entityId: row.id,
    after: { album_id: albumId, type, person_id: personId || null },
  });
  return revealGalleryKey(row.id);
}
export async function revealGalleryKey(id) {
  const key = (
    await query("SELECT * FROM gallery_access_keys WHERE id=$1", [id])
  ).rows[0];
  if (!key || key.status !== "ACTIVE") throw unavailable();
  const credentials = openCredentials(
    key.encrypted_credentials,
    secret(),
    environment(),
  );
  const url = `${documentOrigin()}/gallery/${key.type === "PERSON" ? "p" : "a"}/${credentials.token}`;
  return {
    id: key.id,
    type: key.type,
    code: credentials.code.match(/.{1,5}/g).join("-"),
    url,
    qr: await QRCode.toDataURL(url, {
      width: 600,
      margin: 2,
      color: { dark: "#171717", light: "#ffffff" },
    }),
  };
}
export async function changeGalleryKey(id, action, expiresAt, user) {
  return transaction(async () => {
    const key = (
      await query("SELECT * FROM gallery_access_keys WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if (!key) throw unavailable();
    if (action === "extend") {
      if (key.status === "REVOKED") throw unavailable();
      await query(
        "UPDATE gallery_access_keys SET expires_at=$2,status='ACTIVE' WHERE id=$1",
        [id, expiresAt],
      );
      return { id };
    }
    await query(
      "UPDATE gallery_access_keys SET status='REVOKED',revoked_at=now() WHERE id=$1",
      [id],
    );
    await galleryActivity(key, "REVOKED");
    await writeAudit({
      req: { user },
      action: "gallery_key_revoked",
      entity: "gallery_access_key",
      entityId: id,
      after: { status: "REVOKED" },
    });
    return action === "regenerate"
      ? createGalleryKey(
          key.album_id,
          key.type,
          key.person_id,
          expiresAt || key.expires_at,
          user,
        )
      : { id, status: "REVOKED" };
  });
}
export async function uploadGalleryMedia(albumId, input) {
  if (
    !(await query("SELECT id FROM gallery_albums WHERE id=$1", [albumId])).rows
      .length
  )
    throw unavailable();
  const buffer = Buffer.from(input.base64, "base64");
  validateGalleryImage(buffer, input.mime_type);
  const storage = galleryStorage();
  const key = await storage.put(buffer, input.mime_type);
  return (
    await query(
      `INSERT INTO gallery_media(album_id,storage_provider,storage_key,filename,mime_type,size_bytes,checksum,captured_at,source_provider,external_capture_id,source_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,filename,mime_type,status`,
      [
        albumId,
        storage.provider,
        key,
        input.filename,
        input.mime_type,
        buffer.length,
        crypto.createHash("sha256").update(buffer).digest("hex"),
        input.captured_at || null,
        input.source_provider || "MANUAL",
        input.external_capture_id || null,
        input.source_metadata || {},
      ],
    )
  ).rows[0];
}
export async function bulkGalleryMedia(albumId, input, user) {
  return transaction(async () => {
    const media = (
      await query(
        "SELECT id FROM gallery_media WHERE album_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE",
        [albumId, input.media_ids],
      )
    ).rows;
    if (media.length !== new Set(input.media_ids).size) throw unavailable();
    if (["assign", "unassign"].includes(input.action)) {
      const person = (
        await query(
          "SELECT id FROM gallery_people WHERE id=$1 AND album_id=$2 AND status='ACTIVE'",
          [input.person_id, albumId],
        )
      ).rows[0];
      if (!person) throw unavailable();
      for (const m of media) {
        if (input.action === "assign")
          await query(
            "INSERT INTO gallery_media_people(album_id,media_id,person_id,confirmed_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [albumId, m.id, person.id, user.id],
          );
        else
          await query(
            "DELETE FROM gallery_media_people WHERE media_id=$1 AND person_id=$2",
            [m.id, person.id],
          );
      }
    } else if (input.action === "reorder") {
      for (const [i, id] of input.media_ids.entries())
        await query("UPDATE gallery_media SET sort_order=$2 WHERE id=$1", [
          id,
          i,
        ]);
    } else {
      await query(
        "UPDATE gallery_media SET status=$3 WHERE album_id=$1 AND id=ANY($2::uuid[])",
        [
          albumId,
          input.media_ids,
          { hide: "HIDDEN", restore: "VISIBLE", archive: "ARCHIVED" }[
            input.action
          ],
        ],
      );
    }
    await writeAudit({
      req: { user },
      action: "gallery_media_" + input.action,
      entity: "gallery_album",
      entityId: albumId,
      after: { count: media.length },
    });
    return { updated: media.length };
  });
}
export async function adminGalleryMedia(id) {
  const m = (await query("SELECT * FROM gallery_media WHERE id=$1", [id]))
    .rows[0];
  if (!m) throw unavailable();
  return m;
}
export async function deliverGallery(id, recipient, user, send) {
  const grant = await usable(
    (await query(grantSelect + " WHERE k.id=$1", [id])).rows[0],
  );
  const access = await revealGalleryKey(id);
  const body = `Your photos are waiting.\n${grant.type === "PERSON" ? "Your personal moments" : "Your private event gallery"} from ${grant.title}.\nOpen your gallery: ${access.url}\nGallery code: ${access.code}\nPlease keep this access link private.`;
  const deliveryKey = `gallery-delivery:${id}:${hashCredential(recipient.trim().toLowerCase())}`;
  const c = await transaction(async () => {
    await query("SELECT id FROM gallery_access_keys WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    const existing = (
      await query("SELECT * FROM communications WHERE idempotency_key=$1", [
        deliveryKey,
      ])
    ).rows[0];
    if (existing) return existing;
    const draft = await createCommunicationDraft(
      {
        recipient: recipient.trim().toLowerCase(),
        event_id: grant.event_id,
        subject: `Your LOLA photos — ${grant.title}`,
        body,
        html: brandedEmailHtml(body, {
          kicker: "Your photos are ready",
          ctaLabel:
            grant.type === "PERSON" ? "View Your Photos" : "View Your Gallery",
          ctaUrl: access.url,
        }),
        trigger_key: "GALLERY_DELIVERY",
        status: "DRAFT",
      },
      user,
    );
    await query("UPDATE communications SET idempotency_key=$2 WHERE id=$1", [
      draft.id,
      deliveryKey,
    ]);
    return draft;
  });
  if (send) {
    const sent = await sendCommunication(c.id, user);
    if (sent.communication.status === 'CANCELLED') throw unavailable();
    await query(
      "UPDATE gallery_albums SET status='DELIVERED',updated_at=now() WHERE id=$1",
      [grant.album_id],
    );
    await galleryActivity(grant, "DELIVERED");
  }
  return { communicationId: c.id, sent: send };
}

// A trusted, authenticated importer supplies bytes rather than remote URLs.
// This keeps provider adapters neutral and avoids server-side URL fetching.
export async function queueGalleryImport(input, user) {
  const existing = (
    await query(
      "SELECT id,status FROM gallery_imports WHERE source_provider=$1 AND external_event_id=$2 AND external_capture_id=$3",
      [
        input.source_provider,
        input.external_event_id,
        input.external_capture_id,
      ],
    )
  ).rows[0];
  if (existing) return existing;
  const buffer = Buffer.from(input.base64, "base64");
  validateGalleryImage(buffer, input.mime_type);
  const storage = galleryStorage(),
    key = await storage.put(buffer, input.mime_type);
  const row = (
    await query(
      `INSERT INTO gallery_imports(source_provider,external_event_id,external_capture_id,storage_provider,storage_key,filename,mime_type,size_bytes,checksum,source_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(source_provider,external_event_id,external_capture_id) DO UPDATE SET source_provider=EXCLUDED.source_provider RETURNING id,status`,
      [
        input.source_provider,
        input.external_event_id,
        input.external_capture_id,
        storage.provider,
        key,
        input.filename,
        input.mime_type,
        buffer.length,
        crypto.createHash("sha256").update(buffer).digest("hex"),
        input.source_metadata || {},
      ],
    )
  ).rows[0];
  const mapped = (
    await query(
      "SELECT id FROM gallery_albums WHERE source_provider=$1 AND external_event_id=$2",
      [input.source_provider, input.external_event_id],
    )
  ).rows[0];
  if (mapped && row.status === "UNMATCHED")
    return matchGalleryImport(row.id, mapped.id, user);
  return row;
}
export async function listGalleryImports() {
  return (
    await query(
      "SELECT id,source_provider,external_event_id,external_capture_id,filename,mime_type,size_bytes,status,album_id,created_at FROM gallery_imports ORDER BY created_at DESC LIMIT 500",
    )
  ).rows;
}
export async function matchGalleryImport(id, albumId, user) {
  return transaction(async () => {
    const row = (
      await query("SELECT * FROM gallery_imports WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!row) throw unavailable();
    if (row.status === "MATCHED") {
      if (row.album_id !== albumId)
        throw new AppError(
          "Import already belongs to another album.",
          409,
          "IMPORT_ALREADY_MATCHED",
        );
      return { id, status: row.status, album_id: row.album_id };
    }
    if (
      !(await query("SELECT id FROM gallery_albums WHERE id=$1", [albumId]))
        .rows.length
    )
      throw unavailable();
    await query(
      `INSERT INTO gallery_media(album_id,storage_provider,storage_key,filename,mime_type,size_bytes,checksum,source_provider,external_capture_id,source_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(album_id,source_provider,external_capture_id) DO NOTHING`,
      [
        albumId,
        row.storage_provider,
        row.storage_key,
        row.filename,
        row.mime_type,
        row.size_bytes,
        row.checksum,
        row.source_provider,
        row.external_capture_id,
        row.source_metadata,
      ],
    );
    await query(
      "UPDATE gallery_imports SET status='MATCHED',album_id=$2 WHERE id=$1",
      [id, albumId],
    );
    await writeAudit({
      req: { user },
      action: "gallery_import_matched",
      entity: "gallery_album",
      entityId: albumId,
      after: { importId: id },
    });
    return { id, status: "MATCHED", album_id: albumId };
  });
}
export async function ignoreGalleryImport(id, user) {
  const r = await query(
    "UPDATE gallery_imports SET status='IGNORED' WHERE id=$1 AND status='UNMATCHED' RETURNING id,status",
    [id],
  );
  if (!r.rows.length) throw unavailable();
  await writeAudit({
    req: { user },
    action: "gallery_import_ignored",
    entity: "gallery_import",
    entityId: id,
  });
  return r.rows[0];
}

export async function galleryAnalytics() {
  return (
    await query(
      "SELECT action,count(*)::int count FROM gallery_activity WHERE created_at>=now()-interval '30 days' GROUP BY action ORDER BY action",
    )
  ).rows;
}

export async function updateGalleryPersonDownloads(id, input, user) {
  const row = (
    await query(
      "UPDATE gallery_people SET allow_download=$2,allow_zip=$3 WHERE id=$1 RETURNING id,album_id",
      [id, input.allow_download ?? null, input.allow_zip ?? null],
    )
  ).rows[0];
  if (!row) throw unavailable();
  await writeAudit({
    req: { user },
    action: "gallery_person_downloads_updated",
    entity: "gallery_person",
    entityId: id,
    after: input,
  });
  return row;
}
