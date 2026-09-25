import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "../config/env.js";

// PostgreSQL DATE is a calendar value, never a JavaScript timestamp.
pg.types.setTypeParser(1082, value => value);

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10
});
const transactionContext = new AsyncLocalStorage();

export async function query(text, params = []) {
  const result = await (transactionContext.getStore() || pool).query(text, params);
  return result;
}

export async function transaction(callback) {
  const current = transactionContext.getStore();
  if (current) return callback(current);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await transactionContext.run(client, () => callback(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
