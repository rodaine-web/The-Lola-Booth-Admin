import { query } from "../db/pool.js";
import { AppError } from "../utils/errors.js";

export function isDatabaseSetupError(error) {
  return ["ECONNREFUSED", "ENOTFOUND", "28000", "28P01", "3D000", "42P01"].includes(error?.code);
}

export function databaseSetupError() {
  return new AppError(
    "LOLA Admin needs its PostgreSQL database configured and seeded before sign in.",
    503,
    "DATABASE_NOT_READY",
    {
      steps: ["Create .env from .env.example", "Set DATABASE_URL and JWT_SECRET", "Run npm run db:migrate", "Run npm run db:seed"]
    }
  );
}

export async function getSetupStatus() {
  try {
    await query("SELECT 1 FROM users LIMIT 1");
    return { ready: true };
  } catch (error) {
    if (isDatabaseSetupError(error)) {
      return {
        ready: false,
        code: "DATABASE_NOT_READY",
        message: databaseSetupError().message,
        steps: databaseSetupError().details.steps
      };
    }
    throw error;
  }
}
