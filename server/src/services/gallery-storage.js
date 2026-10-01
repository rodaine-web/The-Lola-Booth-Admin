import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { AppError } from "../utils/errors.js";
import { assertGalleryEnvironment } from "./gallery-policy.js";
import { azureBlobStorage } from "./azure-blob-storage.js";
export function galleryStorage(config = process.env) {
  assertGalleryEnvironment(config);
  const environment = config.APP_ENV || config.NODE_ENV;
  const provider = config.GALLERY_STORAGE_PROVIDER || "unconfigured";
  const prefix = `${environment}/private-gallery/`;
  if (provider === "azure") {
    const blob = azureBlobStorage(config, "gallery");
    return {
      provider: "azure", ready: true, check: blob.check,
      put: (buffer, mime) => blob.put(prefix + crypto.randomUUID(), buffer, mime),
      get: (key) => blob.stream(key),
    };
  }
  const valid = (key) => {
    if (
      !key.startsWith(prefix) ||
      key.includes("..") ||
      !/^[-a-zA-Z0-9/_.]+$/.test(key)
    )
      throw new AppError("Invalid media key.", 404, "MEDIA_UNAVAILABLE");
    return key;
  };
  if (provider === "s3") {
    if (
      config.GALLERY_STORAGE_ENV !== environment ||
      !config.GALLERY_S3_BUCKET ||
      !config.GALLERY_S3_ACCESS_KEY_ID ||
      !config.GALLERY_S3_SECRET_ACCESS_KEY
    )
      throw new AppError(
        "Isolated Gallery object storage is not configured.",
        503,
        "GALLERY_STORAGE_NOT_READY",
      );
    const client = new S3Client({
        region: config.GALLERY_S3_REGION || "auto",
        endpoint: config.GALLERY_S3_ENDPOINT || undefined,
        forcePathStyle: config.GALLERY_S3_PATH_STYLE === "true",
        credentials: {
          accessKeyId: config.GALLERY_S3_ACCESS_KEY_ID,
          secretAccessKey: config.GALLERY_S3_SECRET_ACCESS_KEY,
        },
      }),
      Bucket = config.GALLERY_S3_BUCKET;
    return {
      provider: "s3",
      ready: true,
      async check() {
        await client.send(new HeadBucketCommand({ Bucket }));
        return { provider: "s3", environment, privateDelivery: true };
      },
      async put(buffer, mime) {
        const key = prefix + crypto.randomUUID();
        await client.send(
          new PutObjectCommand({
            Bucket,
            Key: key,
            Body: buffer,
            ContentType: mime,
            ChecksumSHA256: crypto
              .createHash("sha256")
              .update(buffer)
              .digest("base64"),
            Metadata: {
              environment,
              sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
            },
          }),
        );
        return key;
      },
      async get(key) {
        const r = await client.send(
          new GetObjectCommand({ Bucket, Key: valid(key) }),
        );
        return r.Body;
      },
    };
  }
  // Explicit local development adapter; never silently fallback on deployed staging.
  if (provider === "local" && ["development", "test"].includes(environment)) {
    const root = path.resolve(
      config.GALLERY_LOCAL_ROOT || "storage/private-gallery",
    );
    return {
      provider: "local",
      ready: false,
      async check() {
        return { provider: "local", environment, privateDelivery: true };
      },
      async put(buffer) {
        const key = prefix + crypto.randomUUID();
        await fs.mkdir(path.dirname(path.join(root, key)), { recursive: true });
        await fs.writeFile(path.join(root, key), buffer, { flag: "wx" });
        return key;
      },
      async get(key) {
        return createReadStream(path.join(root, valid(key)));
      },
    };
  }
  throw new AppError(
    "Configure a private staging object-storage bucket before uploading Gallery media.",
    503,
    "GALLERY_STORAGE_NOT_READY",
  );
}
