import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectDropboxGallery,dropboxContentHash,dropboxCapture,dropboxFolderPath,DROPBOX_GALLERY_LIMIT} from '../server/src/services/dropbox-gallery-adapter.js';
const config={DROPBOX_GALLERY_APP_KEY:'test-app',DROPBOX_GALLERY_APP_SECRET:'secret-not-for-logs',DROPBOX_GALLERY_REFRESH_TOKEN:'refresh-not-for-logs',DROPBOX_GALLERY_ACCOUNT_ID:'dbid:test'};
const bytes=Buffer.from('synthetic gallery file bytes'),entry={'.tag':'file',name:'CAPTURE.jpeg',id:'id:capture_1',rev:'a123',path_lower:'/fiesta/test/capture.jpeg',size:bytes.length,content_hash:dropboxContentHash(bytes)};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture({account={},downloadBytes=bytes,result=entry,status=200,page={entries:[entry],cursor:'cursor-one',has_more:false}}={}) {
 const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'error');
 if(url.endsWith('/oauth2/token'))return json({access_token:'private-access-token'});
 if(url.endsWith('/users/get_current_account'))return json({account_id:'dbid:test',email:'info@thelolabooth.com',email_verified:true,...account});
 if(url.endsWith('/files/get_metadata'))return json({'.tag':'folder',id:'id:event_folder',path_lower:'/fiesta/test'});
 if(url.endsWith('/files/list_folder')||url.endsWith('/files/list_folder/continue'))return json(page);
 if(url.endsWith('/files/download')){const arg=JSON.parse(options.headers['Dropbox-API-Arg']);if('rev' in arg||arg.path!==`rev:${entry.rev}`)return new Response('Rev parameter is deprecated',{status:400});return new Response(downloadBytes,{status,headers:{'dropbox-api-result':JSON.stringify(result)}});}
 throw Error('Unexpected endpoint');};return {calls,fetcher};
}
test('Dropbox connection is verified and restricted to fixed read-only endpoints',async()=>{
 const f=fixture(),client=await connectDropboxGallery({config,fetcher:f.fetcher});assert.equal(client.accountId,'dbid:test');assert.equal((await client.folder('/fiesta/test')).id,'id:event_folder');
 await client.page('id:event_folder');await client.page('id:event_folder','cursor-one');assert.deepEqual(await client.download(entry,'/fiesta/test'),bytes);
 const firstList=f.calls.find(c=>c.url.endsWith('/files/list_folder'));assert.deepEqual(JSON.parse(firstList.options.body),{path:'id:event_folder',recursive:false,include_deleted:true,include_mounted_folders:false,limit:20});
 assert.deepEqual(JSON.parse(f.calls.at(-1).options.headers['Dropbox-API-Arg']),{path:`rev:${entry.rev}`});
 assert.ok(f.calls.every(c=>!/(upload|delete|create_shared_link)/.test(c.url)));
});
test('Wrong account, email or unverified identity cannot list or download files',async()=>{
 for(const account of [{account_id:'dbid:other'},{email:'other@example.invalid'},{email_verified:false}]){const f=fixture({account});await assert.rejects(connectDropboxGallery({config,fetcher:f.fetcher}),{code:'DROPBOX_ACCOUNT_MISMATCH'});assert.equal(f.calls.length,2);}
});
test('Dropbox folder paths exclude roots, URLs and traversal',()=>{
 for(const path of ['','/','/fiesta/','https://evil.invalid/folder','/fiesta/../other','/fiesta//other','/fiesta\\other','/fiesta\nother'])assert.throws(()=>dropboxFolderPath(path),{code:'DROPBOX_FOLDER_INVALID'});
 assert.equal(dropboxFolderPath('/Fiesta/Event 1'),'/Fiesta/Event 1');
});
test('Files outside the mapped folder, forged metadata and oversized captures fail closed',()=>{
 for(const change of [{path_lower:'/other/capture.jpeg'},{id:'https://evil.invalid'},{name:'../secret.jpeg'},{content_hash:'invalid'},{size:0}])assert.throws(()=>dropboxCapture({...entry,...change},'/fiesta/test'),{code:'DROPBOX_METADATA_INVALID'});
 assert.throws(()=>dropboxCapture({...entry,size:DROPBOX_GALLERY_LIMIT+1},'/fiesta/test'),{code:'DROPBOX_CAPTURE_TOO_LARGE'});
 assert.equal(dropboxCapture({'.tag':'deleted',path_lower:entry.path_lower},'/fiesta/test'),null);
 assert.equal(dropboxCapture({...entry,name:'readme.txt'},'/fiesta/test'),null);
});
test('Pinned revision and Dropbox content hash must match downloaded bytes',async()=>{
 for(const options of [{result:{...entry,rev:'changed'}},{result:{...entry,id:'id:other'}},{downloadBytes:Buffer.alloc(bytes.length,1)}]){
 const f=fixture(options),client=await connectDropboxGallery({config,fetcher:f.fetcher});await assert.rejects(client.download(entry,'/fiesta/test'),{code:options.result?'DROPBOX_REVISION_CHANGED':'DROPBOX_CONTENT_MISMATCH'});}
});
test('Dropbox content hash handles the 4 MiB block boundary',()=>{
 assert.equal(dropboxContentHash(Buffer.alloc(0)),crypto.createHash('sha256').digest('hex'));
 const data=Buffer.alloc(4*1024*1024+1,7),first=crypto.createHash('sha256').update(data.subarray(0,-1)).digest(),last=crypto.createHash('sha256').update(data.subarray(-1)).digest();
 assert.equal(dropboxContentHash(data),crypto.createHash('sha256').update(first).update(last).digest('hex'));
});
test('Provider errors never disclose credentials or returned error bodies',async()=>{
 const fetcher=async()=>new Response(JSON.stringify({error:config.DROPBOX_GALLERY_REFRESH_TOKEN}),{status:401});
 await assert.rejects(connectDropboxGallery({config,fetcher}),error=>error.code==='DROPBOX_AUTH_EXPIRED'&&!error.message.includes('refresh-not-for-logs'));
 await assert.rejects(connectDropboxGallery({config,fetcher:async()=>{throw Error('secret-not-for-logs');}}),{code:'DROPBOX_UNAVAILABLE'});
});
test('Invalid cursors and provider pagination responses are rejected',async()=>{
 const f=fixture({page:{entries:[],cursor:'',has_more:false}}),client=await connectDropboxGallery({config,fetcher:f.fetcher});
 await assert.rejects(client.page('https://evil.invalid'),{code:'DROPBOX_CURSOR_INVALID'});await assert.rejects(client.page('id:event_folder'),{code:'DROPBOX_RESPONSE_INVALID'});
});
