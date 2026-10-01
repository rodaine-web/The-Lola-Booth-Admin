import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { azureStorageSettings, azureBlobStorage } from '../server/src/services/azure-blob-storage.js';
import { AzureDocumentStorageProvider, LocalStorageProvider } from '../server/src/services/storage-service.js';
import { galleryStorage } from '../server/src/services/gallery-storage.js';

const config = { APP_ENV:'staging', AZURE_STORAGE_ENV:'staging', AZURE_STORAGE_ACCOUNT_URL:'https://qaaccount.blob.core.windows.net/',
  AZURE_DOCUMENTS_CONTAINER:'documents-staging', GALLERY_AZURE_CONTAINER:'gallery-staging',
  AZURE_STORAGE_TENANT_ID:'qa-tenant', AZURE_STORAGE_CLIENT_ID:'qa-client', AZURE_STORAGE_CLIENT_SECRET:'synthetic-only' };
function fake(publicAccess) {
  const objects = new Map(); const writes = [];
  return { objects, writes, service:{getContainerClient:()=>({
    getProperties:async()=>({blobPublicAccess:publicAccess}),
    getBlockBlobClient:key=>({uploadData:async(buffer,options)=>{
      if(objects.has(key)) throw Object.assign(new Error('Exists'),{statusCode:412});
      objects.set(key,Buffer.from(buffer));writes.push({key,options});
    }}),
    getBlobClient:key=>({downloadToBuffer:async()=>objects.get(key),download:async()=>({readableStreamBody:Readable.from(objects.get(key))})}),
  })} };
}
test('Azure rejects wrong environment, production containers in staging and staging containers in production',()=>{
  assert.throws(()=>azureStorageSettings({...config,AZURE_STORAGE_ENV:'production'}),/environment/);
  assert.throws(()=>azureStorageSettings({...config,AZURE_DOCUMENTS_CONTAINER:'documents'}),/environment/);
  assert.throws(()=>azureStorageSettings({...config,APP_ENV:'production',AZURE_STORAGE_ENV:'production'}),/environment/);
});
test('Azure rejects non-Azure endpoints, embedded credentials and incomplete credentials',()=>{
  for(const endpoint of ['http://qaaccount.blob.core.windows.net','https://example.com','https://qaaccount.blob.core.windows.net/?sig=secret','https://user@qaaccount.blob.core.windows.net','https://qaaccount.blob.core.windows.net/container'])
    assert.throws(()=>azureStorageSettings({...config,AZURE_STORAGE_ACCOUNT_URL:endpoint}));
  assert.throws(()=>azureStorageSettings({...config,AZURE_STORAGE_CLIENT_SECRET:''}),/required/);
});
test('Azure denies public containers before any write or download',async()=>{
  const backend=fake('blob');const adapter=azureBlobStorage(config,'documents',backend);
  await assert.rejects(adapter.put('staging/documents/a',Buffer.from('QA')),/anonymous/);
  await assert.rejects(adapter.get('staging/documents/a'),/anonymous/);
  assert.equal(backend.writes.length,0);
});
test('Azure private roundtrip preserves bytes and immutable checksum metadata',async()=>{
  const backend=fake();const adapter=azureBlobStorage(config,'documents',backend);const bytes=Buffer.from('QA document');
  await adapter.put('staging/documents/a',bytes,'application/pdf');
  assert.deepEqual(await adapter.get('staging/documents/a'),bytes);
  assert.equal(backend.writes[0].options.conditions.ifNoneMatch,'*');
  assert.equal(backend.writes[0].options.metadata.environment,'staging');
  assert.equal(backend.writes[0].options.metadata.sha256.length,64);
  await assert.rejects(adapter.put('staging/documents/a',Buffer.from('changed')),/Exists/);
});
test('Azure rejects traversal and cross-purpose or cross-environment keys',async()=>{
  const backend=fake();const adapter=azureBlobStorage(config,'gallery',backend);
  for(const key of ['production/private-gallery/a','staging/documents/a','staging/private-gallery/../a','staging/private-gallery/%2e%2e','staging/private-gallery/a?x=1'])
    await assert.rejects(adapter.get(key),/key/);
  assert.equal(backend.writes.length,0);
});
test('Azure document keys retain routing identity and content addressed imports verify existing bytes',async()=>{
  const backend=fake();const adapter=new AzureDocumentStorageProvider(config,backend);const buffer=Buffer.from('QA');
  const saved=await adapter.put({buffer,filename:'invoice.pdf',mimeType:'application/pdf'});
  assert.equal(saved.storageProvider,'AZURE');assert.match(saved.storageKey,/^azure\/staging\/documents\//);
  assert.deepEqual(await adapter.get(saved.storageKey),buffer);
  const storageKey='website-import/'+'a'.repeat(64)+'/logo.png';
  const first=await adapter.putAt({buffer,storageKey});
  assert.deepEqual(await adapter.putAt({buffer,storageKey}),first);
  await assert.rejects(adapter.putAt({buffer:Buffer.from('different'),storageKey}),/Exists/);
});
test('production Gallery stays disabled even when Azure credentials exist',()=>{
  assert.throws(()=>galleryStorage({...config,APP_ENV:'production',AZURE_STORAGE_ENV:'production',GALLERY_STORAGE_PROVIDER:'azure',GALLERY_AZURE_CONTAINER:'gallery'}));
});
test('legacy local document reads reject directory traversal',async()=>{
  const local=new LocalStorageProvider('/tmp/lola-test-no-files');
  for(const key of ['../private','/etc/passwd','..\\private']) await assert.rejects(local.get(key),/Invalid/);
});
