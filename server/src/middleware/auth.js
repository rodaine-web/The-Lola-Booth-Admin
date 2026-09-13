import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { AppError } from "../utils/errors.js";

export async function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new AppError("Sign in required.", 401, "UNAUTHENTICATED"));

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const result = await query(
      `SELECT u.id, u.name, u.email, u.active,
        COALESCE(json_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '[]') AS roles,
        COALESCE(json_agg(DISTINCT p.key) FILTER (WHERE p.key IS NOT NULL), '[]') AS permissions
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = $1 AND u.deleted_at IS NULL
       GROUP BY u.id`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user?.active) return next(new AppError("Sign in required.", 401, "UNAUTHENTICATED"));
    req.user = user;
    return next();
  } catch {
    return next(new AppError("Your session has expired.", 401, "TOKEN_EXPIRED"));
  }
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (req.user?.permissions?.includes("*") || req.user?.permissions?.includes(permission)) return next();
    return next(new AppError("You do not have access to this area.", 403, "FORBIDDEN"));
  };
}
