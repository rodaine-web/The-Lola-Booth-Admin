export async function assertDatabaseIdentity(db, config = process.env) {
  if (!['production','staging'].includes(config.APP_ENV)) return;
  if (!config.EXPECTED_DATABASE_SYSTEM_ID) throw new Error('EXPECTED_DATABASE_SYSTEM_ID is required for hosted environments.');
  const result = await db.query('SELECT system_identifier::text FROM pg_control_system()');
  if (result.rows[0]?.system_identifier !== config.EXPECTED_DATABASE_SYSTEM_ID) throw new Error('Database identity mismatch; refusing to start this environment.');
  return result.rows[0].system_identifier;
}
