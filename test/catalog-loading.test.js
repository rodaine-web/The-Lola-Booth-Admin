import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog} from '../shared/catalog-loading.js';
import {paginationSchema} from '../server/src/utils/validation.js';

test('catalog loading respects API pagination and includes packages beyond the first 100', async()=>{
  const requests=[];
  const records=Array.from({length:205},(_,id)=>({id}));
  const result=await loadCatalog(async path=>{
    requests.push(path);
    const url=new URL(path,'https://staging.example');
    const query=paginationSchema.parse(Object.fromEntries(url.searchParams));
    return {data:records.slice((query.page-1)*query.pageSize,query.page*query.pageSize),pagination:{total:records.length}};
  },'packages');
  assert.deepEqual(result,records);
  assert.equal(requests.length,3);
  assert.ok(requests.every(path=>path.includes('pageSize=100')));
});

test('catalog request failures remain visible to callers',async()=>{
  await assert.rejects(loadCatalog(async()=>{throw new Error('Catalog unavailable');},'packages'),/Catalog unavailable/);
});

test('catalog loading rejects an unexpected response instead of silently showing an empty list',async()=>{
  await assert.rejects(loadCatalog(async()=>({error:'failure'}),'experiences'),/Unable to read/);
});

test('catalog loading handles empty catalogs and unpaginated arrays',async()=>{
  assert.deepEqual(await loadCatalog(async()=>({data:[],pagination:{total:0}}),'addons'),[]);
  assert.deepEqual(await loadCatalog(async()=>[{id:'one'}],'experiences'),[{id:'one'}]);
});
