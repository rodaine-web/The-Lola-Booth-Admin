import test from 'node:test';
import assert from 'node:assert/strict';

test('Audio fulfillment PUT sends JSON and coalesces duplicate reservations', async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:()=>null}});
  t.after(() => previousStorage ? Object.defineProperty(globalThis, 'localStorage', previousStorage) : delete globalThis.localStorage);
  let finish;
  const calls = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    calls.push({url, options});
    return new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify({id:'reservation'}), {status:200,headers:{'Content-Type':'application/json'}})); });
  });
  const {api} = await import('../src/api/client.js');
  const path = '/events/qa/audio-fulfillment', body = {equipmentId:'unit',bookingKind:'ADDON'};
  const first = api.put(path, body), duplicate = api.put(path, body);
  assert.equal(first, duplicate);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api'+path);
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
  finish();
  assert.deepEqual(await first, {id:'reservation'});
});
