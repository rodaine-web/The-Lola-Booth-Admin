import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import { z } from "zod";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError } from "../utils/errors.js";
import {
  assertGalleryEnvironment,
  downloadAllowed,
  unavailable,
} from "../services/gallery-policy.js";
import { galleryStorage } from "../services/gallery-storage.js";
import * as gallery from "../services/private-gallery-service.js";
const id = z.string().uuid(),
  date = z.string().datetime({ offset: true }).nullable().optional();
const noCache = (_req, res, next) => {
  res.set({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  next();
};
const gate = (_req, _res, next) => {
  try {
    assertGalleryEnvironment();
    next();
  } catch (e) {
    next(e);
  }
};
const parseGrant = (req) =>
  gallery.resolveGalleryToken(
    req.params.type === "a"
      ? "ALBUM"
      : req.params.type === "p"
        ? "PERSON"
        : "INVALID",
    req.params.token,
  );
const extension = (mime) =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" })[mime] ||
  "bin";
async function streamMedia(media, res, download = false) {
  const storage = galleryStorage();
  if (storage.provider !== media.storage_provider)
    throw new AppError(
      "Media storage provider is unavailable.",
      503,
      "GALLERY_STORAGE_NOT_READY",
    );
  res.type(media.mime_type);
  res.set(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename="LOLA-Photo.${extension(media.mime_type)}"`,
  );
  await pipeline(await storage.get(media.storage_key), res);
}
export const galleryPublicRouter = Router();
galleryPublicRouter.use(gate, noCache);
galleryPublicRouter.post(
  "/resolve",
  rateLimit({
    windowMs: 60000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { message: "Please wait before trying another gallery code." },
    },
  }),
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.resolveGalleryCode(
        z.object({ code: z.string().max(80) }).parse(req.body).code,
      ),
    ),
  ),
);
galleryPublicRouter.get(
  "/access/:type/:token",
  asyncHandler(async (req, res) =>
    res.json(await gallery.publicGalleryView(await parseGrant(req))),
  ),
);
galleryPublicRouter.get(
  "/access/:type/:token/refresh",
  asyncHandler(async (req, res) =>
    res.json(await gallery.publicGalleryView(await parseGrant(req), false)),
  ),
);
galleryPublicRouter.post(
  "/access/:type/:token/media/:id/download",
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.mediaTicket(
        await parseGrant(req),
        id.parse(req.params.id),
        "download",
      ),
    ),
  ),
);
galleryPublicRouter.get(
  "/access/:type/:token/zip",
  rateLimit({
    windowMs: 60000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  asyncHandler(async (req, res) => {
    const grant = await parseGrant(req);
    if (!downloadAllowed(grant, true)) throw unavailable();
    const media = await gallery.allowedMedia(grant);
    if (
      media.length > 1000 ||
      media.reduce((s, m) => s + Number(m.size_bytes), 0) > 1024 ** 3
    )
      throw new AppError(
        "This gallery is too large for one download. Download individual photos or contact your host.",
        422,
        "GALLERY_ZIP_LIMIT",
      );
    const storage = galleryStorage();
    if (media.some((m) => m.storage_provider !== storage.provider))
      throw new AppError(
        "Media storage unavailable.",
        503,
        "GALLERY_STORAGE_NOT_READY",
      );
    await gallery.galleryActivity(grant, "ZIP_DOWNLOADED");
    res
      .type("application/zip")
      .attachment(
        grant.type === "PERSON"
          ? "LOLA-Your-Photos.zip"
          : "LOLA-Event-Gallery.zip",
      );
    const archive = new ZipArchive({ zlib: { level: 0 } });
    archive.on("error", () => res.destroy());
    res.on("close", () => archive.abort());
    archive.pipe(res);
    for (const [index, m] of media.entries())
      archive.append(await storage.get(m.storage_key), {
        name: `LOLA-Photo-${String(index + 1).padStart(3, "0")}.${extension(m.mime_type)}`,
      });
    await archive.finalize();
  }),
);
galleryPublicRouter.get(
  "/media/:ticket",
  asyncHandler(async (req, res) => {
    const { media, download } = await gallery.authorizedMediaTicket(
      req.params.ticket,
    );
    await streamMedia(media, res, download);
  }),
);
export const galleryAdminRouter = Router();
galleryAdminRouter.use(
  gate,
  noCache,
  authenticate,
  requirePermission("read:events"),
);
const write = requirePermission("write:operations");
galleryAdminRouter.get(
  "/albums",
  asyncHandler(async (_req, res) =>
    res.json({ data: await gallery.listGalleryAlbums() }),
  ),
);
galleryAdminRouter.post(
  "/albums",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        event_id: id,
        title: z.string().trim().min(1).max(200).optional(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(await gallery.createGalleryAlbum(b.event_id, b.title, req.user));
  }),
);
galleryAdminRouter.get(
  "/albums/:id",
  asyncHandler(async (req, res) =>
    res.json(await gallery.adminGalleryAlbum(id.parse(req.params.id))),
  ),
);
galleryAdminRouter.patch(
  "/albums/:id",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        expires_at: date,
        allow_download: z.boolean().optional(),
        allow_zip: z.boolean().optional(),
        allow_personal_download: z.boolean().optional(),
        allow_personal_zip: z.boolean().optional(),
        cover_media_id: id.nullable().optional(),
        source_provider: z.string().max(60).nullable().optional(),
        external_event_id: z.string().max(200).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await gallery.updateGalleryAlbum(id.parse(req.params.id), b, req.user),
    );
  }),
);
galleryAdminRouter.post(
  "/albums/:id/status",
  write,
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.transitionGalleryAlbum(
        id.parse(req.params.id),
        z
          .object({
            status: z.enum([
              "DRAFT",
              "PROCESSING",
              "READY",
              "PUBLISHED",
              "EXPIRED",
              "ARCHIVED",
            ]),
          })
          .parse(req.body).status,
        req.user,
      ),
    ),
  ),
);
galleryAdminRouter.post(
  "/albums/:id/people",
  write,
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json(
        await gallery.createGalleryPerson(
          id.parse(req.params.id),
          z
            .object({ display_name: z.string().trim().max(100).optional() })
            .parse(req.body).display_name,
        ),
      ),
  ),
);
galleryAdminRouter.post(
  "/albums/:id/keys",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        type: z.enum(["ALBUM", "PERSON"]),
        person_id: id.nullable().optional(),
        expires_at: date,
      })
      .refine((b) => (b.type === "PERSON" ? !!b.person_id : !b.person_id), {
        message:
          "Personal keys require a person; album keys must not have one.",
      })
      .parse(req.body);
    res
      .status(201)
      .json(
        await gallery.createGalleryKey(
          id.parse(req.params.id),
          b.type,
          b.person_id,
          b.expires_at,
          req.user,
        ),
      );
  }),
);
galleryAdminRouter.get(
  "/keys/:id",
  write,
  asyncHandler(async (req, res) =>
    res.json(await gallery.revealGalleryKey(id.parse(req.params.id))),
  ),
);
galleryAdminRouter.post(
  "/keys/:id/deliver",
  requirePermission("gallery.delivery.send"),
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        recipient: z.string().email(),
        send: z.boolean().default(false),
      })
      .parse(req.body);
    res.json(
      await gallery.deliverGallery(
        id.parse(req.params.id),
        b.recipient,
        req.user,
        b.send,
      ),
    );
  }),
);
galleryAdminRouter.post(
  "/keys/:id/:action",
  write,
  asyncHandler(async (req, res) => {
    const action = z
        .enum(["extend", "regenerate", "revoke"])
        .parse(req.params.action),
      b = z.object({ expires_at: date }).parse(req.body);
    if (
      action === "extend" &&
      (!b.expires_at || Date.parse(b.expires_at) <= Date.now())
    )
      throw new AppError(
        "Choose a future expiration.",
        422,
        "INVALID_EXPIRATION",
      );
    res.json(
      await gallery.changeGalleryKey(
        id.parse(req.params.id),
        action,
        b.expires_at,
        req.user,
      ),
    );
  }),
);
galleryAdminRouter.post(
  "/albums/:id/media",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        filename: z.string().min(1).max(200),
        mime_type: z.enum(["image/jpeg", "image/png", "image/gif"]),
        base64: z
          .string()
          .min(1)
          .max(14 * 1024 * 1024),
        captured_at: date,
        source_provider: z.string().max(60).optional(),
        external_capture_id: z.string().max(200).optional(),
        source_metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(await gallery.uploadGalleryMedia(id.parse(req.params.id), b));
  }),
);
galleryAdminRouter.post(
  "/albums/:id/media/bulk",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        media_ids: z.array(id).min(1).max(1000),
        action: z.enum([
          "assign",
          "unassign",
          "hide",
          "restore",
          "archive",
          "reorder",
        ]),
        person_id: id.optional(),
      })
      .parse(req.body);
    res.json(
      await gallery.bulkGalleryMedia(id.parse(req.params.id), b, req.user),
    );
  }),
);
galleryAdminRouter.get(
  "/media/:id",
  asyncHandler(async (req, res) =>
    streamMedia(await gallery.adminGalleryMedia(id.parse(req.params.id)), res),
  ),
);
galleryAdminRouter.get(
  "/storage",
  asyncHandler(async (_req, res) => res.json(await galleryStorage().check())),
);
// Provider connectors must authenticate as an authorized operator/integration user.
galleryAdminRouter.get(
  "/imports",
  asyncHandler(async (_req, res) =>
    res.json({ data: await gallery.listGalleryImports() }),
  ),
);
galleryAdminRouter.post(
  "/imports",
  write,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        source_provider: z.string().trim().min(1).max(60),
        external_event_id: z.string().min(1).max(200),
        external_capture_id: z.string().min(1).max(200),
        filename: z.string().min(1).max(200),
        mime_type: z.enum(["image/jpeg", "image/png", "image/gif"]),
        base64: z
          .string()
          .min(1)
          .max(14 * 1024 * 1024),
        source_metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);
    res.status(201).json(await gallery.queueGalleryImport(b, req.user));
  }),
);
galleryAdminRouter.post(
  "/imports/:id/match",
  write,
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.matchGalleryImport(
        id.parse(req.params.id),
        z.object({ album_id: id }).parse(req.body).album_id,
        req.user,
      ),
    ),
  ),
);
galleryAdminRouter.post(
  "/imports/:id/ignore",
  write,
  asyncHandler(async (req, res) =>
    res.json(
      await gallery.ignoreGalleryImport(id.parse(req.params.id), req.user),
    ),
  ),
);

galleryAdminRouter.get(
  "/analytics",
  requirePermission("read:analytics"),
  asyncHandler(async (_req, res) =>
    res.json({ data: await gallery.galleryAnalytics() }),
  ),
);

galleryAdminRouter.patch(
  "/people/:id/downloads",
  write,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        allow_download: z.boolean().nullable(),
        allow_zip: z.boolean().nullable(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await gallery.updateGalleryPersonDownloads(
        id.parse(req.params.id),
        input,
        req.user,
      ),
    );
  }),
);
