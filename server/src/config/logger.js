import {safeError} from '../utils/safe-error.js';
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  serializers:{err:safeError},
  redact: ["req.headers.authorization", "req.headers.cookie", "password", "password_hash", "refresh_token_hash", "accessToken", "refreshToken", "token", "secret", "client_secret", "authorization", "*.password", "*.password_hash", "*.token", "*.accessToken", "*.refreshToken", "*.secret", "*.client_secret"]
});
