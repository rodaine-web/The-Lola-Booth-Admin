import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {eventFileName,EVENT_FILE_MAX_BYTES} from '../shared/event-files.js';
import {decodeEventFile,eventFileSummary} from '../server/src/services/event-files-service.js';
import {LocalStorageProvider} from '../server/src/services/storage-service.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64');
test('event files reject unsupported extensions, traversal, corrupt MIME and oversized payloads',()=>{
 assert.equal(eventFileName('Venue plan.PDF','application/pdf'),'Venue plan.PDF');
 for(const name of ['../plan.pdf','folder/plan.pdf','C:\\plan.pdf','plan\n.pdf','plan.html'])assert.equal(eventFileName(name,'application/pdf'),null);
 const valid={filename:'reference.png',mimeType:'image/png',data:png.toString('base64')};assert.equal(decodeEventFile(valid).buffer.equals(png),true);
 for(const patch of [{filename:'reference.pdf'},{mimeType:'image/jpeg'},{data:'malformed!=='},{data:Buffer.from('not a PNG').toString('base64')},{data:Buffer.alloc(EVENT_FILE_MAX_BYTES+1).toString('base64')}])assert.throws(()=>decodeEventFile({...valid,...patch}),e=>e.code==='EVENT_FILE_INVALID');
});
test('event file summaries exclude storage keys, digest and upload request identifiers',()=>{
 const value=eventFileSummary({id:'id',filename:'private.pdf',storage_provider:'AZURE',storage_key:'azure/private/key',upload_request_id:'private',content_sha256:'private'});
 assert.equal(value.hasContent,true);for(const field of ['storage_key','storage_provider','content_sha256','upload_request_id'])assert.equal(field in value,false);
 assert.equal(eventFileSummary({storage_provider:'LOCAL_METADATA_ONLY'}).hasContent,false);
});
test('local uncommitted-upload cleanup is scoped and refuses path traversal',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lola-event-files-storage-'));try{
 const storage=new LocalStorageProvider(root),file=await storage.put({buffer:png,filename:'test.png'});assert.deepEqual(await storage.get(file.storageKey),png);
 await storage.delete(file.storageKey);await assert.rejects(storage.get(file.storageKey));
 for(const key of ['../outside','/outside','dir\\outside'])await assert.rejects(storage.delete(key));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
