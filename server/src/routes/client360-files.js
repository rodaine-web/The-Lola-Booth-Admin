import {uploadEventFile} from '../services/event-files-service.js';
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requirePermission } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError } from "../utils/errors.js";
import { query } from "../db/pool.js";
import { getStorageProvider } from "../services/storage-service.js";
import { userCanAccessEvent } from "../services/event-operations-service.js";
import { writeAudit } from "../services/audit-service.js";

export const client360FileRouter = Router();
const uuid = z.string().uuid();
const MIME = new Set(["image/png", "image/jpeg", "application/pdf"]);
const MAX = 8 * 1024 * 1024;

async function scopedFile(req) {
  const id = uuid.parse(req.params.id);
  const row = (await query(`SELECT id,client_id,event_id,filename,mime_type,size_bytes,storage_key,storage_provider,visibility
    FROM files WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!row || !row.client_id || (row.event_id && !await userCanAccessEvent(req.user, row.event_id))) {
    throw new AppError("File unavailable.",404,"FILE_UNAVAILABLE");
  }
  // The Admin route requires client-record access and, for event files, event access.
  return row;
}

client360FileRouter.get("/:id/content", requirePermission("read:sales"), asyncHandler(async(req,res) => {
  const row = await scopedFile(req);
  if (!MIME.has(row.mime_type)) throw new AppError("Preview is not supported for this file type.",415,"FILE_PREVIEW_UNSUPPORTED");
  const buffer = await getStorageProvider().get(row.storage_key);
  res.set({"Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; sandbox", "Cross-Origin-Resource-Policy":"same-origin"});
  res.type(row.mime_type).send(buffer);
}));

client360FileRouter.get("/:id/download", requirePermission("read:sales"), asyncHandler(async(req,res) => {
  const row = await scopedFile(req);
  const buffer = await getStorageProvider().get(row.storage_key);
  const safeName = String(row.filename || "file").replace(/[\r\n\\/\u0000-\u001f]/g,"_").slice(0,160);
  res.set({"Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; sandbox"});
  res.attachment(safeName).type("application/octet-stream").send(buffer);
}));

const uploadSchema = z.object({
  client_id: uuid,
  event_id: uuid,
  filename: z.string().min(1).max(160),
  mime_type: z.enum(["image/png","image/jpeg","application/pdf"]),
  base64: z.string().min(4).max(12*1024*1024)
}).strict();

client360FileRouter.post("/upload", requirePermission("write:events"), asyncHandler(async(req,res) => {
  const input = uploadSchema.parse(req.body);
  const event = (await query("SELECT client_id FROM events WHERE id=$1 AND deleted_at IS NULL",[input.event_id])).rows[0];
  if (!event || event.client_id !== input.client_id || !await userCanAccessEvent(req.user,input.event_id))
    throw new AppError("You cannot upload to this event.",403,"FILE_EVENT_FORBIDDEN");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0)
    throw new AppError("Invalid file encoding.",422,"FILE_ENCODING_INVALID");
  const buffer = Buffer.from(input.base64,"base64");
  if (!buffer.length || buffer.length > MAX) throw new AppError("Choose a file smaller than 8 MB.",422,"FILE_TOO_LARGE");
  const signature = input.mime_type === "application/pdf" ? buffer.subarray(0,5).toString() === "%PDF-" :
    input.mime_type === "image/png" ? buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (!signature) throw new AppError("The file format does not match its type.",422,"FILE_TYPE_INVALID");
  const filename = input.filename.replace(/[\\/\r\n\u0000-\u001f]/g,"_");
  const result=await uploadEventFile(input.event_id,{requestId:randomUUID(),filename,mimeType:input.mime_type,data:input.base64,category:'OTHER',visibility:'PRIVATE'},req);
  res.status(201).json(result.file);
}));
