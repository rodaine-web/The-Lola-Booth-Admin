import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError } from "../utils/errors.js";
import { validate } from "../utils/validation.js";
import { authenticate } from "../middleware/auth.js";
import { databaseSetupError, isDatabaseSetupError } from "../services/setup-service.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8)
});

function signAccessToken(userId) {
  return jwt.sign({}, env.jwtSecret, { subject: userId, expiresIn: env.jwtExpiresIn });
}

authRouter.post("/login", validate(loginSchema), asyncHandler(async (req, res) => {
  let result;
  try {
    result = await query("SELECT id, password_hash, active FROM users WHERE email = $1 AND deleted_at IS NULL", [req.body.email]);
  } catch (error) {
    if (isDatabaseSetupError(error)) throw databaseSetupError();
    throw error;
  }
  const user = result.rows[0];
  const matches = user ? await bcrypt.compare(req.body.password, user.password_hash) : false;
  if (!matches || !user.active) throw new AppError("Email or password is incorrect.", 401, "INVALID_CREDENTIALS");

  const refreshToken = crypto.randomBytes(48).toString("hex");
  const refreshHash = await bcrypt.hash(refreshToken, 12);
  await query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [user.id, refreshHash, env.refreshTokenDays]
  );

  res.json({ accessToken: signAccessToken(user.id), refreshToken });
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError("Refresh token required.", 401, "UNAUTHENTICATED");
  const sessions = await query("SELECT id, user_id, refresh_token_hash FROM user_sessions WHERE revoked_at IS NULL AND expires_at > now()");
  for (const session of sessions.rows) {
    if (await bcrypt.compare(refreshToken, session.refresh_token_hash)) {
      return res.json({ accessToken: signAccessToken(session.user_id) });
    }
  }
  throw new AppError("Session expired.", 401, "UNAUTHENTICATED");
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const sessions = await query("SELECT id, refresh_token_hash FROM user_sessions WHERE revoked_at IS NULL");
    for (const session of sessions.rows) {
      if (await bcrypt.compare(refreshToken, session.refresh_token_hash)) {
        await query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1", [session.id]);
      }
    }
  }
  res.status(204).send();
}));

authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));
