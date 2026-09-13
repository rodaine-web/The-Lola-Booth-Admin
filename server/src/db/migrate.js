import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { logger } from "../config/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../migrations");

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const applied = await pool.query("SELECT filename FROM schema_migrations");
  const appliedSet = new Set(applied.rows.map((row) => row.filename));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    logger.info({ file }, "applying migration");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

migrate()
  .then(() => {
    logger.info("migrations complete");
    return pool.end();
  })
  .catch((error) => {
    logger.error(error, "migration failed");
    pool.end().finally(() => process.exit(1));
  });
