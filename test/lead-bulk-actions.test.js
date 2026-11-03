import test from 'node:test';
import assert from 'node:assert/strict';
import { adminRouter } from '../server/src/routes/admin.js';
import { pool } from '../server/src/db/pool.js';

const route = adminRouter.stack.find(layer => layer.route?.path === '/leads/bulk-action').route;
const id = '11111111-1111-4111-8111-111111111111';
async function invoke(body, permissions = ['write:sales']) {
  const req = { body, user: { id, permissions }, headers: {}, ip: '127.0.0.1' };
  let result;
  for (const layer of route.stack) {
    let failure;
    await layer.handle(req, { json: value => { result = value; } }, error => { failure = error; });
    if (failure) throw failure;
  }
  return result;
}

test('lead bulk actions enforce permissions and validate input before touching the database', async () => {
  await assert.rejects(invoke({ ids: [id], action: 'delete' }, ['read:sales']), { statusCode: 403 });
  for (const body of [{ ids: [], action: 'delete' }, { ids: ['invalid'], action: 'delete' }, { ids: [id], action: 'drop' }, { ids: Array(101).fill(id), action: 'delete' }]) {
    await assert.rejects(invoke(body), { statusCode: 400 });
  }
});

test('archive, restore and delete commit a deduplicated batch with audit history', async () => {
  const original = pool.connect;
  try {
    for (const [action, assignment] of [['archive', 'archived_at=now()'], ['restore', 'archived_at=NULL'], ['delete', 'deleted_at=now()']]) {
      const calls = [];
      pool.connect = async () => ({ release() {}, async query(sql, params) {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT')) return { rows: [{ id, status: 'NEW' }] };
        if (sql.startsWith('UPDATE')) return { rows: [{ id, status: 'NEW', changed: true }] };
        return { rows: [] };
      } });
      assert.deepEqual(await invoke({ ids: [id, id], action }), { count: 1 });
      const update = calls.find(call => call.sql.startsWith('UPDATE'));
      assert.ok(update.sql.includes(assignment));
      assert.deepEqual(update.params, [[id]]);
      assert.ok(calls.some(call => call.sql.includes('INSERT INTO audit_logs')));
      assert.equal(calls.at(-1).sql, 'COMMIT');
    }
  } finally { pool.connect = original; }
});

test('missing leads and audit errors roll back the entire selection', async () => {
  const original = pool.connect;
  try {
    for (const missing of [true, false]) {
      const calls = [];
      pool.connect = async () => ({ release() {}, async query(sql) {
        calls.push(sql);
        if (sql.startsWith('SELECT')) return { rows: missing ? [] : [{ id }] };
        if (sql.startsWith('UPDATE')) return { rows: [{ id }] };
        if (sql.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
        return { rows: [] };
      } });
      await assert.rejects(invoke({ ids: [id], action: 'delete' }));
      assert.equal(calls.at(-1), 'ROLLBACK');
      if (missing) assert.ok(!calls.some(sql => sql.startsWith('UPDATE')));
    }
  } finally { pool.connect = original; }
});
