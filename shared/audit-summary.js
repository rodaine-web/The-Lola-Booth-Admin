const sensitive=/password|secret|token|credential|authorization|cookie|api.?key/i;
export function redactAudit(value){
 if(Array.isArray(value))return value.map(redactAudit);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sensitive.test(key)?'[redacted]':redactAudit(item)]));
 return value;
}
export function auditChanges(before={},after={}){
 before=redactAudit(before||{});after=redactAudit(after||{});
 return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!sensitive.test(key)&&!['updated_at','created_at'].includes(key)&&JSON.stringify(before[key])!==JSON.stringify(after[key])).map(field=>({field,before:before[field]??null,after:after[field]??null}));
}
