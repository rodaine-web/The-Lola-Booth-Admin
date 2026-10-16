import crypto from 'node:crypto';
import {AppError} from '../utils/errors.js';

export const DROPBOX_GALLERY_LIMIT = 10 * 1024 * 1024;
const api = 'https://api.dropboxapi.com/2';
const fail = (code, message = 'Dropbox could not complete this operation.', status = 502) => new AppError(message, status, code);
export function dropboxGalleryConfig(config = process.env) {
  const names = ['DROPBOX_GALLERY_APP_KEY', 'DROPBOX_GALLERY_APP_SECRET', 'DROPBOX_GALLERY_REFRESH_TOKEN', 'DROPBOX_GALLERY_ACCOUNT_ID'];
  if (names.some(name => !config[name])) throw fail('DROPBOX_CONFIGURATION_REQUIRED', 'Configure the read-only Dropbox connection before importing.', 503);
  return {key:config[names[0]], secret:config[names[1]], refresh:config[names[2]], account:config[names[3]], email:'info@thelolabooth.com'};
}
export function dropboxFolderPath(value) {
  if (typeof value !== 'string' || value.length > 1000 || !value.startsWith('/') || value.endsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value) || value.split('/').some((part,i) => i && (!part || part === '.' || part === '..'))) {
    throw fail('DROPBOX_FOLDER_INVALID', 'Choose a specific event delivery folder, not the Dropbox root.', 422);
  }
  return value;
}
export function dropboxContentHash(bytes) {
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += 4*1024*1024) blocks.push(crypto.createHash('sha256').update(bytes.subarray(offset,offset+4*1024*1024)).digest());
  return crypto.createHash('sha256').update(Buffer.concat(blocks)).digest('hex');
}
export function dropboxCapture(entry, folderPath) {
  if (entry?.['.tag'] !== 'file') return null; // Deleted source files never delete published LOLA records.
  const parent = String(entry.path_lower || '').slice(0, String(entry.path_lower || '').lastIndexOf('/'));
  if (parent !== dropboxFolderPath(folderPath).toLowerCase() || typeof entry.name !== 'string' || /[\/\\\u0000-\u001f\u007f]/.test(entry.name) || entry.name.length > 255 || !/^id:[A-Za-z0-9_-]+$/.test(entry.id || '') || !/^[a-zA-Z0-9]+$/.test(entry.rev || '') || !/^[a-f0-9]{64}$/.test(entry.content_hash || '') || !Number.isSafeInteger(entry.size) || entry.size <= 0) throw fail('DROPBOX_METADATA_INVALID');
  const mime = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',mp4:'video/mp4'}[entry.name.split('.').at(-1).toLowerCase()];
  if (!mime) return null;
  if (entry.size > DROPBOX_GALLERY_LIMIT) throw fail('DROPBOX_CAPTURE_TOO_LARGE', 'This capture exceeds the current 10 MB gallery limit.', 422);
  return {...entry, mime};
}
async function bounded(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw fail('DROPBOX_RESPONSE_TOO_LARGE');
  let size = 0;const chunks=[];
  if (!response.body) throw fail('DROPBOX_RESPONSE_INVALID');
  for await (const chunk of response.body) {size += chunk.length;if(size > limit) {await response.body.cancel?.().catch(()=>{});throw fail('DROPBOX_RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
function asciiJson(value) {return JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));}
export async function connectDropboxGallery({config=process.env, fetcher=fetch}={}) {
  const c=dropboxGalleryConfig(config);
  async function request(url, options) {
    let response;
    try {response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});} catch {throw fail('DROPBOX_UNAVAILABLE');}
    if(!response.ok) {
      // Never propagate provider bodies, tokens, paths or personal metadata into logs.
      await response.body?.cancel().catch(()=>{});
      throw fail(response.status===401?'DROPBOX_AUTH_EXPIRED':response.status===403?'DROPBOX_PERMISSION_DENIED':response.status===429?'DROPBOX_RATE_LIMIT':'DROPBOX_REQUEST_FAILED');
    }
    return response;
  }
  async function json(url, options) {const response=await request(url,options);try{return JSON.parse((await bounded(response,2*1024*1024)).toString('utf8'));}catch(error){if(error.code)throw error;throw fail('DROPBOX_RESPONSE_INVALID');}}
  const token=await json('https://api.dropboxapi.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:c.refresh,client_id:c.key,client_secret:c.secret})});
  if(typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 8192) throw fail('DROPBOX_AUTH_EXPIRED');
  const headers={Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'};
  const rpc=(method,body)=>json(api+'/'+method,{method:'POST',headers,body:JSON.stringify(body)});
  const account=await rpc('users/get_current_account',null);
  if(account.account_id!==c.account || String(account.email||'').toLowerCase()!==c.email || account.disabled===true || account.email_verified!==true) throw fail('DROPBOX_ACCOUNT_MISMATCH','The authorized Dropbox account does not match the approved account.',409);
  return {
    accountId:account.account_id,
    async folder(path) {dropboxFolderPath(path);const metadata=await rpc('files/get_metadata',{path,include_deleted:false});if(metadata['.tag']!=='folder'||!/^id:[A-Za-z0-9_-]+$/.test(metadata.id||'')||metadata.path_lower!==path.toLowerCase())throw fail('DROPBOX_FOLDER_INVALID');return metadata;},
    async page(folderId,cursor) {
      if(!/^id:[A-Za-z0-9_-]+$/.test(folderId||'')||cursor&&(typeof cursor!=='string'||cursor.length>20000))throw fail('DROPBOX_CURSOR_INVALID');
      const result=await rpc(cursor?'files/list_folder/continue':'files/list_folder',cursor?{cursor}:{path:folderId,recursive:false,include_deleted:true,include_mounted_folders:false,limit:20});
      if(!Array.isArray(result.entries)||result.entries.length>2000||typeof result.cursor!=='string'||!result.cursor||result.cursor.length>20000||typeof result.has_more!=='boolean')throw fail('DROPBOX_RESPONSE_INVALID');
      return result;
    },
    async download(entry,folderPath) {
      const metadata=dropboxCapture(entry,folderPath);if(!metadata)throw fail('DROPBOX_METADATA_INVALID');
      const response=await request('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:headers.Authorization,'Dropbox-API-Arg':asciiJson({path:metadata.id,rev:metadata.rev})}});
      let actual;try{actual=JSON.parse(response.headers.get('dropbox-api-result'));}catch{throw fail('DROPBOX_METADATA_INVALID');}
      if(!actual||actual.id!==metadata.id||actual.rev!==metadata.rev||actual.name!==metadata.name||actual.size!==metadata.size||actual.content_hash!==metadata.content_hash)throw fail('DROPBOX_REVISION_CHANGED');
      const bytes=await bounded(response,DROPBOX_GALLERY_LIMIT);
      if(bytes.length!==metadata.size||dropboxContentHash(bytes)!==metadata.content_hash)throw fail('DROPBOX_CONTENT_MISMATCH');
      return bytes;
    }
  };
}
