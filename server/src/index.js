import {pool} from './db/pool.js';
import {assertDatabaseIdentity} from './config/database-identity.js';
import {originAllowed} from '../../shared/environment-isolation.js';
import {buildInfo} from './config/staging-safety.js';
import crypto from "node:crypto";
import { safeRequestLog, safeResponseLog } from "./utils/request-log.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import {createApiRateLimits} from "./middleware/api-rate-limits.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRouter } from "./routes/auth.js";
import {galleryPublicRouter,galleryAdminRouter} from "./routes/gallery.js";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin.js";
import { webhookRouter } from "./routes/webhooks.js";
import { getSetupStatus } from "./services/setup-service.js";
import { asyncHandler } from "./utils/async-handler.js";
import { AppError } from "./utils/errors.js";

await assertDatabaseIdentity(pool);
const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (originAllowed(process.env.APP_ENV, origin, [env.clientOrigin, ...env.publicInquiryAllowedOrigins])) return callback(null, true);
    return callback(new AppError("Requests are not allowed from this origin.", 403, "CORS_REJECTED"));
  },
  credentials: true
}));
app.use(pinoHttp({ logger, genReqId: (_req, res) => { const id = crypto.randomUUID(); res.setHeader("X-Request-ID", id); return id; }, serializers: { req: safeRequestLog, res: safeResponseLog } }));
app.use("/api/webhooks", express.raw({ type: "application/json", limit: "1mb" }), webhookRouter);
app.use(express.json({ limit: "14mb" }));
app.use(createApiRateLimits({windowMs:env.rateLimitWindowMs,limit:env.rateLimitMax}));

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "LOLA Admin API", ...buildInfo() }));
app.get("/api/setup/status", asyncHandler(async (_req, res) => res.json(await getSetupStatus())));
app.use("/api/auth", authRouter);
app.use("/api/gallery", galleryPublicRouter);
app.use("/api/gallery-admin", galleryAdminRouter);
app.use("/api/public", publicRouter);
app.use("/api", adminRouter);

app.use(errorHandler);

export const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, "LOLA Admin API listening");
});
