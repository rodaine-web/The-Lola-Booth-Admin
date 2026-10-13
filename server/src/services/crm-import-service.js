import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {readCrmSpreadsheet} from './campaign-contact-import.js';
import {contactCan,contactManager,saveContact,saveContactNote} from './crm-contacts-service.js';
import {createAdminLead} from './admin-lead-create.js';
import {CONTACT_FIELDS,LEAD_FIELDS,contactSchema,leadImportSchema,normalizeEmail} from '../../../shared/crm-contacts.js';
export function automaticMapping(headers,kind){const fields=kind==='LEADS'?LEAD_FIELDS:CONTACT_FIELDS;const norm=x=>x.toLowerCase().replace(/[^a-z0-9]/g,'');const aliases={contactname:'display_name',fullname:'display_name',contacttype:'contact_type',relationship:'contact_type',leadsource:kind==='LEADS'?'lead_source':'source',title:'job_title',marketingconsent:'marketing_consent',assignedowner:kind==='LEADS'?'assigned_user_id':'owner_id',consentdate:'consented_at'};return Object.fromEntries(headers.map((h,i)=>[i,fields.find(f=>norm(f)===norm(h))||aliases[norm(h)]||'']));}
export function mappedImportRows(table,mapping,kind){
 const allowed=kind==='LEADS'?LEAD_FIELDS:CONTACT_FIELDS;const assigned=Object.values(mapping).filter(Boolean);if(assigned.some(f=>!allowed.includes(f))||new Set(assigned).size!==assigned.length)throw new AppError('Map each supported field once.',422,'IMPORT_MAPPING_INVALID');if(!assigned.includes('email'))throw new AppError('Map the Email column.',422,'IMPORT_EMAIL_REQUIRED');
 const seen=new Set();return table.rows.map(row=>{
 if(table.headers.some((h,i)=>h.toLowerCase().replace(/\s/g,'')==='examplerow'&&row.cells[i].startsWith('EXAMPLE')))return {number:row.number,status:'SKIP_EXAMPLE',message:'Template example was skipped.'};
 const input={};for(const [index,field] of Object.entries(mapping))if(field&&row.cells[Number(index)]?.trim())input[field]=row.cells[Number(index)].trim();
 const notes=input.notes;delete input.notes;
 if(kind==='CONTACTS'){input.display_name=input.display_name||[input.first_name,input.last_name].filter(Boolean).join(' ')||input.email;input.source=input.source||'SPREADSHEET';input.tags=input.tags?input.tags.split(/[;,]/).map(x=>x.trim()).filter(Boolean):[];}
 for(const key of ['contact_type','status','marketing_consent'])if(input[key])input[key]=input[key].toUpperCase().replaceAll(' ','_');
 if(['YES','TRUE','1'].includes(input.marketing_consent))input.marketing_consent='OPTED_IN';if(['NO','FALSE','0'].includes(input.marketing_consent))input.marketing_consent='OPTED_OUT';
 if(input.consented_at&&/^\d{4}-\d{2}-\d{2}$/.test(input.consented_at))input.consented_at+='T12:00:00.000Z';
 if(kind==='LEADS'){if(input.guest_count)input.guest_count=Number(input.guest_count);input.status=input.status||'NEW';}
 const validated=(kind==='CONTACTS'?contactSchema:leadImportSchema).safeParse(input);
 if(!validated.success)return {number:row.number,status:'INVALID',email:normalizeEmail(input.email),message:validated.error.issues.map(i=>`${i.path.join('.')||'Consent'}: ${i.message}`).join('; ')};
 const email=normalizeEmail(validated.data.email);if(seen.has(email))return {number:row.number,status:'DUPLICATE',email,message:'Duplicate email within this file.'};seen.add(email);
 return {number:row.number,status:'VALID',email,input:validated.data,...(notes?{notes:notes.slice(0,5000)}:{})};
 });
}
export async function matchesFor(rows,kind,user){
 const emails=rows.filter(r=>r.status==='VALID').map(r=>r.email);if(!emails.length)return rows;
 const table=kind==='LEADS'?'leads':'crm_contacts',column=kind==='LEADS'?'lower(btrim(email))':'email_normalized';
 const existing=(await query(`SELECT id,email,${kind==='LEADS'?'assigned_user_id AS owner_id, status':'secondary_email,owner_id,marketing_consent,contact_type'} FROM ${table} WHERE deleted_at IS NULL AND (${column}=ANY($1::text[])${kind==='CONTACTS'?' OR lower(btrim(secondary_email))=ANY($1::text[])':''})`,[emails])).rows;
 return rows.map(r=>{if(r.status!=='VALID')return r;const found=existing.filter(x=>normalizeEmail(x.email)===r.email||kind==='CONTACTS'&&normalizeEmail(x.secondary_email)===r.email);if(!found.length)return {...r,match:'NEW'};
 if(found.length>1||!contactManager(user)&&found[0].owner_id!==user.id)return {...r,match:'RESTRICTED',message:'An existing CRM identity requires manager review; this row will be skipped.'};return {...r,match:'EXISTING',existing_id:found[0].id};});
}
export function importSummary(rows){return {new:rows.filter(r=>r.match==='NEW').length,existing:rows.filter(r=>r.match==='EXISTING').length,invalid:rows.filter(r=>r.status==='INVALID').length,duplicates:rows.filter(r=>r.status==='DUPLICATE').length,skipped:rows.filter(r=>r.status==='SKIP_EXAMPLE'||r.match==='RESTRICTED').length,total:rows.length};}
export async function inspectImport(input,user){const table=readCrmSpreadsheet(input,input.kind);return {...table,mapping:automaticMapping(table.headers,input.kind),fields:input.kind==='LEADS'?LEAD_FIELDS:CONTACT_FIELDS};}
export async function previewImport(input,req){
 const table=readCrmSpreadsheet(input,input.kind),rows=await matchesFor(mappedImportRows(table,input.mapping,input.kind),input.kind,req.user);
 const hash=crypto.createHash('sha256').update(JSON.stringify([input.kind,input.filename,input.data,input.mapping])).digest('hex');
 return transaction(async()=>{await query('SELECT pg_advisory_xact_lock(hashtextextended($1,600061))',[req.user.id+input.requestId]);const previous=(await query('SELECT * FROM crm_import_batches WHERE created_by=$1 AND request_id=$2 FOR UPDATE',[req.user.id,input.requestId])).rows[0];if(previous){if(previous.content_hash!==hash)throw new AppError('Choose the file again to create a new import request.',409,'IMPORT_REQUEST_REUSED');return batchView(previous);}
 const batch=(await query("INSERT INTO crm_import_batches(kind,source,filename,request_id,content_hash,created_by,rows_json,mapping) VALUES($1,'SPREADSHEET',$2,$3,$4,$5,$6,$7) RETURNING *",[input.kind,input.filename,input.requestId,hash,req.user.id,JSON.stringify(rows),JSON.stringify(input.mapping)])).rows[0];await writeAudit({req,action:'crm_import_previewed',entity:'crm_import',entityId:batch.id,after:{kind:input.kind,rows:rows.length}});return batchView(batch);});
}
export function batchView(batch){return {id:batch.id,kind:batch.kind,source:batch.source,filename:batch.filename,state:batch.state,created_at:batch.created_at,updated_at:batch.updated_at,cursor:batch.cursor_position,summary:importSummary(batch.rows_json),rows:batch.rows_json.map(r=>({number:r.number,status:r.status,match:r.match,email:r.email,message:r.message,existing_id:r.existing_id})),results:batch.results};}
export async function importAccess(id,user,{lock=false}={}){const batch=(await query('SELECT * FROM crm_import_batches WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!batch||batch.created_by!==user.id&&!contactManager(user))throw notFound('Import');return batch;}
const contactUpdateFields=['first_name','last_name','display_name','phone','company','job_title','website','city','state','address','source','source_detail','tags'];
const leadUpdateFields=['phone','company','venue_name','venue_address','city','state','zip','referral_source','message'];
export async function commitImport(id,input,req){return transaction(async()=>{const batch=await importAccess(id,req.user,{lock:true});if(batch.state!=='PREVIEW')return batchView(batch);
 if(batch.kind==='LEADS'&&!contactCan(req.user,'write:sales'))throw new AppError('Lead creation permission required.',403,'FORBIDDEN');
 const allowed=batch.kind==='LEADS'?leadUpdateFields:contactUpdateFields;if(input.fields.some(f=>!allowed.includes(f)))throw new AppError('Consent, identity, ownership and lifecycle cannot be overwritten by imports.',422,'IMPORT_FIELDS_BLOCKED');
 const selected=input.selectedRows||batch.rows_json.filter(r=>r.status==='VALID').map(r=>r.number);const available=new Set(batch.rows_json.map(r=>r.number));if(selected.some(n=>!available.has(n)))throw new AppError('Select rows from this preview.',422,'IMPORT_ROWS_INVALID');
 const options={policy:input.policy,fields:input.fields,selectedRows:[...new Set(selected)]};
 await query("UPDATE crm_import_batches SET state='QUEUED',options=$2,updated_at=now() WHERE id=$1",[id,JSON.stringify(options)]);await queueImportJob(id,0);await writeAudit({req,action:'crm_import_queued',entity:'crm_import',entityId:id,after:{policy:input.policy,fields:input.fields,selected:selected.length}});return batchView({...batch,state:'QUEUED'});});}
async function queueImportJob(id,offset){await query("INSERT INTO integration_jobs(provider,event_name,entity_type,entity_id,payload,idempotency_key,mode) VALUES('CRM_CONTACTS','IMPORT_BATCH','crm_import',$1,$2,$3,'EXTERNAL') ON CONFLICT(idempotency_key) DO NOTHING",[id,JSON.stringify({offset}),`crm-import:${id}:${offset}`]);}
export async function crmImportActor(id){const u=(await query("SELECT u.id,u.active,COALESCE((SELECT json_agg(key) FROM (SELECT p.key FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=u.id UNION SELECT p.key FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id) p),'[]') permissions FROM users u WHERE id=$1 AND deleted_at IS NULL",[id])).rows[0];return u;}
export async function processCrmImport(job){
 const batch=(await query('SELECT * FROM crm_import_batches WHERE id=$1 FOR UPDATE',[job.entity_id])).rows[0];if(!batch||['CANCELLED','COMPLETED','PARTIAL'].includes(batch.state))return {mode:'EXTERNAL',result:'IDEMPOTENT_REPLAY'};
 const user=await crmImportActor(batch.created_by);if(!user?.active||!contactCan(user,'import:contacts')||!contactCan(user,'write:contacts')||batch.kind==='LEADS'&&!contactCan(user,'write:sales')){throw new AppError('The import owner no longer has the required permissions.',403,'IMPORT_PERMISSION_REVOKED');}
 const req={user,headers:{},ip:null},results=[...batch.results];let offset=batch.cursor_position;const end=Math.min(offset+100,batch.rows_json.length);await query("UPDATE crm_import_batches SET state='PROCESSING' WHERE id=$1",[batch.id]);
 for(;offset<end;offset++){
 const row=batch.rows_json[offset];if(row.status!=='VALID'||!batch.options.selectedRows.includes(row.number)){results.push({number:row.number,status:'SKIPPED',message:row.message||'Not selected or invalid.'});continue;}
 await query('SAVEPOINT crm_import_row');try{
 const email=row.email;await query('SELECT pg_advisory_xact_lock(hashtextextended($1,600060))',['crm-contact:'+email]);
 let created=false,record;
 if(batch.kind==='CONTACTS'){
 const found=(await query('SELECT * FROM crm_contacts WHERE deleted_at IS NULL AND (email_normalized=$1 OR lower(btrim(secondary_email))=$1) FOR UPDATE',[email])).rows;
 if(found.length>1||found.length&&!contactManager(user)&&found[0].owner_id!==user.id){results.push({number:row.number,status:'SKIPPED',message:'Existing identity requires manager review.'});}
 else if(found.length){if(batch.options.policy==='skip'){results.push({number:row.number,status:'SKIPPED',message:'Existing contact preserved.'});}else{
 const before=found[0],next=Object.fromEntries(Object.keys(contactSchema.shape).map(k=>[k,before[k]]));
 const fields=batch.options.policy==='fill_blanks'?contactUpdateFields:batch.options.fields;for(const key of fields){const value=row.input[key];if(value!=null&&value!==''&&(!Array.isArray(value)||value.length)&&(batch.options.policy==='update'||!before[key]||Array.isArray(before[key])&&!before[key].length))next[key]=value;}
 if(next.consented_at instanceof Date)next.consented_at=next.consented_at.toISOString();record=await saveContact(next,req,before.id,{importing:true});results.push({number:row.number,status:'UPDATED',id:record.id});}}
 else{record=await saveContact(row.input,req,null,{importing:true,batchId:batch.id});created=true;results.push({number:row.number,status:'CREATED',id:record.id});}
 if(record&&row.microsoft_ids)await query('UPDATE crm_contacts SET microsoft_ids=microsoft_ids||$2::jsonb WHERE id=$1',[record.id,JSON.stringify(row.microsoft_ids)]);
 if(created&&row.notes)await saveContactNote(record.id,{body:row.notes},req);
 }else{
 const found=(await query('SELECT * FROM leads WHERE deleted_at IS NULL AND lower(btrim(email))=$1 FOR UPDATE',[email])).rows;
 if(found.length){const before=found[0];if(found.length>1||!contactManager(user)&&before.assigned_user_id!==user.id||batch.options.policy==='skip'){results.push({number:row.number,status:'SKIPPED',message:'Existing lead preserved.'});}else{const fields=(batch.options.policy==='fill_blanks'?leadUpdateFields:batch.options.fields).filter(k=>row.input[k]&& (batch.options.policy==='update'||!before[k]));if(fields.length)await query(`UPDATE leads SET ${fields.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=now() WHERE id=$${fields.length+1}`,[...fields.map(k=>row.input[k]),before.id]);results.push({number:row.number,status:'UPDATED',id:before.id});await writeAudit({req,action:'lead_import_updated',entity:'lead',entityId:before.id,after:{fields,batch_id:batch.id}});}}
 else{const {marketing_consent,consent_source,consented_at,...data}=row.input;data.marketing_email_opt_in=marketing_consent==='OPTED_IN';if(!contactManager(user))data.assigned_user_id=user.id;record=await createAdminLead(data,req);await query("UPDATE crm_contacts SET source='SPREADSHEET',import_batch_id=$2 WHERE id=$1 AND source='EXISTING_CRM' AND NOT EXISTS(SELECT 1 FROM clients WHERE contact_id=$1 AND deleted_at IS NULL)",[record.contact_id,batch.id]);if(marketing_consent==='OPTED_IN')await query("UPDATE crm_contacts SET marketing_consent='OPTED_IN',consent_source=$2,consented_at=$3 WHERE id=$1 AND marketing_consent='UNKNOWN' AND marketing_opted_out_at IS NULL",[record.contact_id,consent_source,consented_at]);if(marketing_consent==='OPTED_OUT'){await query("UPDATE crm_contacts SET marketing_consent='OPTED_OUT',marketing_opted_out_at=COALESCE(marketing_opted_out_at,now()) WHERE id=$1",[record.contact_id]);await query("INSERT INTO campaign_suppressions(email,reason) VALUES($1,'Spreadsheet opt-out') ON CONFLICT DO NOTHING",[email]);await query('UPDATE leads SET marketing_email_opt_in=false,marketing_opted_out_at=now() WHERE id=$1',[record.id]);}results.push({number:row.number,status:'CREATED',id:record.id});}
 }
 await query('RELEASE SAVEPOINT crm_import_row');
 }catch(error){await query('ROLLBACK TO SAVEPOINT crm_import_row');await query('RELEASE SAVEPOINT crm_import_row');results.push({number:row.number,status:'FAILED',message:error.code==='POSSIBLE_DUPLICATE'?'Possible duplicate phone/email; review existing lead.':error.statusCode&&error.statusCode<500?error.message:'Could not save this row. Review and retry this row in a new import.'});}
 }
 const finished=offset>=batch.rows_json.length,state=finished?(results.some(r=>r.status==='FAILED')?'PARTIAL':'COMPLETED'):'QUEUED';await query('UPDATE crm_import_batches SET state=$2,cursor_position=$3,results=$4,updated_at=now() WHERE id=$1',[batch.id,state,offset,JSON.stringify(results)]);if(!finished)await queueImportJob(batch.id,offset);else await writeAudit({req,action:'crm_import_completed',entity:'crm_import',entityId:batch.id,after:{created:results.filter(r=>r.status==='CREATED').length,updated:results.filter(r=>r.status==='UPDATED').length,failed:results.filter(r=>r.status==='FAILED').length}});return {mode:'EXTERNAL',result:'IMPORTED',rows_processed:end-batch.cursor_position};
}
export async function cancelImport(id,req){return transaction(async()=>{const batch=await importAccess(id,req.user,{lock:true});if(['COMPLETED','PARTIAL'].includes(batch.state))throw new AppError('This import is already complete.',409,'IMPORT_COMPLETED');await query("UPDATE crm_import_batches SET state='CANCELLED',updated_at=now() WHERE id=$1",[id]);await query("UPDATE integration_jobs SET status='CANCELLED' WHERE provider='CRM_CONTACTS' AND entity_id=$1 AND status='QUEUED'",[id]);await writeAudit({req,action:'crm_import_cancelled',entity:'crm_import',entityId:id});return {cancelled:true};});}
