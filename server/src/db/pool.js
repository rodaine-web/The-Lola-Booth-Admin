import pg from "pg";
import { env } from "../config/env.js";

// PostgreSQL DATE is a calendar value, never a JavaScript timestamp.
pg.types.setTypeParser(1082, value => value);

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
