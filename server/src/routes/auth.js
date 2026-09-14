import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { query, transaction } from "../db/pool.js";
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

const setupPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8)
});

function signAccessToken(userId) {
  return jwt.sign({}, env.jwtSecret, { subject: userId, expiresIn: env.jwtExpiresIn });
}

function accountTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
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

authRouter.post("/setup-password", validate(setupPasswordSchema), asyncHandler(async (req, res) => {
  const tokenHash = accountTokenHash(req.body.token);
  const tokenResult = await query(
    `SELECT t.id, t.user_id, t.token_type, u.email, u.active
     FROM user_account_tokens t
     JOIN users u ON u.id=t.user_id
     WHERE t.token_hash=$1
       AND t.used_at IS NULL
       AND t.expires_at > now()
       AND u.deleted_at IS NULL`,
    [tokenHash]
  );
  const accountToken = tokenResult.rows[0];
  if (!accountToken || !accountToken.active) throw new AppError("This setup link is invalid or expired.", 400, "INVALID_SETUP_TOKEN");

  const passwordHash = await bcrypt.hash(req.body.password, 12);
  await transaction(async (client) => {
    await client.query("UPDATE users SET password_hash=$1, invitation_status='ACTIVE', updated_at=now() WHERE id=$2", [passwordHash, accountToken.user_id]);
    await client.query("UPDATE user_account_tokens SET used_at=now() WHERE id=$1", [accountToken.id]);
    await client.query("UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [accountToken.user_id]);
  });

  res.json({ ok: true, email: accountToken.email });
}));

authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));
