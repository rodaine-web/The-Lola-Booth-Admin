import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin.js";
import { webhookRouter } from "./routes/webhooks.js";
import { getSetupStatus } from "./services/setup-service.js";
import { asyncHandler } from "./utils/async-handler.js";

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === env.clientOrigin || env.publicInquiryAllowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));
app.use(express.json({ limit: "14mb" }));
app.use(pinoHttp({ logger }));
app.use(rateLimit({ windowMs: env.rateLimitWindowMs, limit: env.rateLimitMax, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "LOLA Admin API" }));
app.get("/api/setup/status", asyncHandler(async (_req, res) => res.json(await getSetupStatus())));
app.use("/api/webhooks", express.raw({ type: "application/json", limit: "1mb" }), webhookRouter);
app.use("/api/auth", authRouter);
app.use("/api/public", publicRouter);
app.use("/api", adminRouter);

app.use(errorHandler);

export const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, "LOLA Admin API listening");
});
