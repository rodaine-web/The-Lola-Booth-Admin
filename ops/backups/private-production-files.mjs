// Private planning-file backup. No database writes, public endpoints, or customer jobs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const env=process.env;
assert.equal(env.AZURE_STORAGE_ENV,'production');
assert.match(env.AZURE_STORAGE_ACCOUNT_URL,/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\/?$/);
assert.match(env.AZURE_DOCUMENTS_CONTAINER,/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
assert.ok(!env.AZURE_DOCUMENTS_CONTAINER.endsWith('-staging'));
const publicKey=crypto.createPublicKey(Buffer.from(env.BACKUP_PUBLIC_KEY_B64,'base64'));
assert.ok(publicKey.asymmetricKeyDetails.modulusLength>=3072);
const tokenResponse=await fetch(`https://login.microsoftonline.com/${env.AZURE_STORAGE_TENANT_ID}/oauth2/v2.0/token`,{method:'POST',body:new URLSearchParams({grant_type:'client_credentials',client_id:env.AZURE_STORAGE_CLIENT_ID,client_secret:env.AZURE_STORAGE_CLIENT_SECRET,scope:'https://storage.azure.com/.default'}),signal:AbortSignal.timeout(30000)});
assert.ok(tokenResponse.ok,'Storage authentication failed');
const token=(await tokenResponse.json()).access_token;
const base=env.AZURE_STORAGE_ACCOUNT_URL.replace(/\/$/,'')+'/'+env.AZURE_DOCUMENTS_CONTAINER;
const headers={Authorization:'Bearer '+token,'x-ms-version':'2023-11-03'};
const prefix='production/planning-files/daily/';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const url=name=>base+'/'+name.split('/').map(encodeURIComponent).join('/');
async function request(name,options={}){const r=await fetch(url(name),{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(120000)});assert.ok(r.ok,'Storage request failed: '+r.status);return r;}
async function put(name,data){return request(name,{method:'PUT',body:data,headers:{'x-ms-blob-type':'BlockBlob','If-None-Match':'*'}});}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
async function list(sourcePrefix){let marker='',rows=[];do{const params=new URLSearchParams({restype:'container',comp:'list',prefix:sourcePrefix,marker});const r=await fetch(base+'?'+params,{headers,signal:AbortSignal.timeout(120000)});assert.ok(r.ok,'Storage listing failed');const xml=await r.text();for(const block of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)){const value=tag=>decode(block[1].match(new RegExp('<'+tag+'>([\\s\\S]*?)<\\/'+tag+'>'))?.[1]||'');rows.push({name:value('Name'),etag:value('Etag'),size:Number(value('Content-Length'))});}marker=decode(xml.match(/<NextMarker>([\s\S]*?)<\/NextMarker>/)?.[1]||'');assert.ok(rows.length<=10000,'File count requires backup-capacity review');}while(marker);return rows;}
const qa=env.BACKUP_QA_PROBE==='true';
const probeId=crypto.randomUUID(),source='production/documents/qa-backup-'+probeId+'.txt',restored='production/documents/qa-restored-'+probeId+'.txt';
const created=[];
try{
 const container=await fetch(base+'?restype=container',{headers});assert.ok(container.ok);assert.equal(container.headers.get('x-ms-blob-public-access'),null);
 if(qa){await put(source,Buffer.from('LOLA synthetic storage recovery QA '+probeId));created.push(source);}
 const rows=await list('production/documents/');
 assert.ok(rows.reduce((sum,r)=>sum+r.size,0)<=128*1024*1024,'File size requires backup-capacity review');
 const files=[];
 for(const row of rows){assert.ok(row.name.startsWith('production/documents/'));const r=await request(row.name,{headers:{'If-Match':row.etag}});const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.length,row.size);files.push({name:row.name,etag:row.etag,sha256:hash(bytes),data:bytes.toString('base64')});}
 const plaintext=Buffer.from(JSON.stringify({format:'lola-private-planning-files-v1',createdAt:new Date().toISOString(),files}));
 const stem=prefix+new Date().toISOString().replace(/[-:.]/g,'')+'-'+crypto.randomUUID();
 const key=crypto.randomBytes(32),nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(stem));
 const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);
 const wrapped=crypto.publicEncrypt({key:publicKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},key);
 const manifest={format:'lola-private-files-aes256gcm-rsaoaep-sha256-v1',aad:stem,createdAt:new Date().toISOString(),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),plaintextSha256:hash(plaintext),ciphertextSha256:hash(encrypted),files:files.length,bytes:plaintext.length};
 await put(stem+'.files.gcm',encrypted);await put(stem+'.key.rsa',wrapped);await put(stem+'.manifest.json',Buffer.from(JSON.stringify(manifest)));
 const downloaded=Buffer.from(await (await request(stem+'.files.gcm')).arrayBuffer());assert.equal(hash(downloaded),hash(encrypted));
 assert.deepEqual(Buffer.from(await (await request(stem+'.key.rsa')).arrayBuffer()),wrapped);
 assert.deepEqual(await (await request(stem+'.manifest.json')).json(),manifest);
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.from(stem));decipher.setAuthTag(cipher.getAuthTag());const recovered=Buffer.concat([decipher.update(downloaded),decipher.final()]);assert.deepEqual(recovered,plaintext);
 const bundle=JSON.parse(recovered);for(const file of bundle.files)assert.equal(hash(Buffer.from(file.data,'base64')),file.sha256);
 const anonymous=await fetch(url(stem+'.files.gcm'),{signal:AbortSignal.timeout(30000)});assert.ok([401,403,404,409].includes(anonymous.status),'Anonymous backup exposed');
 if(qa){const file=bundle.files.find(f=>f.name===source);assert.ok(file);const bytes=Buffer.from(file.data,'base64');await put(restored,bytes);created.push(restored);assert.deepEqual(Buffer.from(await (await request(restored)).arrayBuffer()),bytes);const denied=await fetch(url(restored));assert.ok([401,403,404,409].includes(denied.status),'Anonymous restored asset exposed');console.log('PRODUCTION_PRIVATE_POPULATED_ASSET_ENCRYPTED_RECOVERY_PASS');}
 // Retention is restricted to this job's complete triplets, after a verified new backup.
 const groups=new Map();for(const row of await list(prefix)){const match=row.name.slice(prefix.length).match(/^(\d{8}T\d{9}Z-[0-9a-f-]{36})\.(files\.gcm|key\.rsa|manifest\.json)$/);if(match){const group=groups.get(match[1])||[];group.push(row);groups.set(match[1],group);}}
 let removed=0;for(const [id,group] of groups){const d=id.slice(0,8),date=Date.parse(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)+'T00:00:00Z');if(group.length===3&&Date.now()-date>31*86400000){for(const row of group)await request(row.name,{method:'DELETE',headers:{'If-Match':row.etag}});removed++;}}
 console.log('DAILY_PRIVATE_PLANNING_FILES_BACKUP_PASS',JSON.stringify({files:files.length,bytes:plaintext.length,backup:stem,expiredBackupsRemoved:removed}));
}finally{for(const name of created)await request(name,{method:'DELETE'});}
