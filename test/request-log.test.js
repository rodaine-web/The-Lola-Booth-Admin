import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRequestLog } from '../server/src/utils/request-log.js';
test('request logs redact document credentials, queries and sensitive headers', () => {
  for (const kind of ['proposals','invoices','receipts','delivery','approvals']) {
    const logged = safeRequestLog({id:'request-id', method:'GET', url:`/api/public/${kind}/secret-token/pdf?token=secret-query`, headers:{cookie:'secret-cookie',authorization:'secret-bearer'}});
    assert.equal(logged.url,`/api/public/${kind}/[redacted]/pdf`);
    assert.ok(!JSON.stringify(logged).includes('secret'));
    assert.equal(logged.id,'request-id');
  }
});
