export const EVENT_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const EVENT_FILE_MIME_TYPES = ['application/pdf','image/png','image/jpeg'];
export const EVENT_FILE_CATEGORIES = ['DESIGN','VENUE','CLIENT_UPLOAD','INTERNAL','OTHER','CONTRACT','PROPOSAL','INVOICE'];
export const CUSTOMER_EVENT_FILE_CATEGORIES = ['DESIGN','VENUE','CLIENT_UPLOAD','OTHER'];
export function customerShareableEventFile(file){
 return file.visibility==='PRIVATE' && CUSTOMER_EVENT_FILE_CATEGORIES.includes(file.category)
  && ['LOCAL','AZURE'].includes(file.storage_provider) && Boolean(file.storage_key)
  && Number(file.size_bytes)>0 && /^[a-f0-9]{64}$/.test(file.content_sha256||'');
}
export function eventFileName(filename,mimeType){
 const name=String(filename || '').trim();
 if(!name || name.includes('..') || name.length>160 || /[\x00-\x1f\x7f/\\]/.test(name) || name==='.' || name==='..')return null;
 const extension=name.split('.').at(-1).toLowerCase();
 if(!({'application/pdf':['pdf'],'image/png':['png'],'image/jpeg':['jpg','jpeg']}[mimeType] || []).includes(extension))return null;
 return name;
}
export function managesEventFiles(user){
 return Boolean(user?.permissions?.includes('*')||user?.permissions?.includes('write:operations')||user?.roles?.some(role=>['OWNER','SUPER_ADMIN','ADMIN','EVENT_MANAGER'].includes(role)));
}
