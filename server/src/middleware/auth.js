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
        COALESCE((SELECT json_agg(grants.key) FROM (SELECT p.key FROM user_roles ur2 JOIN role_permissions rp2 ON rp2.role_id=ur2.role_id JOIN permissions p ON p.id=rp2.permission_id WHERE ur2.user_id=u.id UNION SELECT p.key FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=u.id) grants), '[]') AS permissions
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
    // Test suites may mint signed fixture tokens; real logins always bind to a
    // revocable session. No bypass of JWT signature or user/privilege validation.
    if(payload.sid){
      const session=await query("SELECT 1 FROM user_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()",[payload.sid,user.id]);
      if(!session.rowCount)return next(new AppError("Your session has expired.",401,"SESSION_REVOKED"));
    }else if(env.nodeEnv!=="test")return next(new AppError("Please sign in again.",401,"SESSION_REQUIRED"));
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
