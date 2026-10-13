import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {recordActivity} from './activity-service.js';
import {contactSchema,normalizeEmail} from '../../../shared/crm-contacts.js';
export const contactCan=(user,key)=>Boolean(user?.permissions?.includes('*')||user?.permissions?.includes(key));
export const contactManager=user=>contactCan(user,'manage:contacts');
export async function contactAccess(id,user,{lock=false,includeDeleted=false}={}){
 const row=(await query(`SELECT * FROM crm_contacts WHERE id=$1 ${includeDeleted?'':'AND deleted_at IS NULL'} ${lock?'FOR UPDATE':''}`,[id])).rows[0];
 if(!row||!contactManager(user)&&row.owner_id!==user.id)throw notFound('Contact');return row;
}
export function contactFilters(input,user){
 const values=[],where=['c.deleted_at IS NULL'];const bind=v=>{values.push(v);return '$'+values.length;};
 if(!contactManager(user))where.push('c.owner_id='+bind(user.id));
 if(input.tab==='archived')where.push('c.archived_at IS NOT NULL');
 if(input.tab==='active')where.push("c.archived_at IS NULL AND c.status='ACTIVE'");
 if(input.tab==='mine')where.push('c.owner_id='+bind(user.id));
 if(input.search){const p=bind('%'+String(input.search).slice(0,200)+'%');where.push(`(c.display_name ILIKE ${p} OR c.email ILIKE ${p} OR c.secondary_email ILIKE ${p} OR c.phone ILIKE ${p} OR c.company ILIKE ${p} OR c.job_title ILIKE ${p} OR array_to_string(c.tags,' ') ILIKE ${p})`);}
 for(const key of ['status','source','contact_type','owner_id','company'])if(input[key])where.push(`c.${key}=${bind(input[key])}`);
 if(input.tag)where.push(`${bind(input.tag)}=ANY(c.tags)`);
 if(input.from)where.push(`c.created_at::date>=${bind(input.from)}::date`);
 if(input.to)where.push(`c.created_at::date<=${bind(input.to)}::date`);
 if(input.ids?.length)where.push(`c.id=ANY(${bind(input.ids)}::uuid[])`);
 return {where:where.join(' AND '),values};
}
export async function listContacts(input,user,{exportAll=false}={}){
 const {where,values}=contactFilters(input,user),page=Math.max(1,Number(input.page)||1),pageSize=Math.min(100,Math.max(1,Number(input.pageSize)||10));
 const sort=['display_name','email','company','job_title','status','source','last_contacted_at','created_at','phone','contact_type'].includes(input.sort)?input.sort:'last_contacted_at';
 const direction=input.direction==='asc'?'ASC':'DESC';
 const total=(await query(`SELECT count(*)::int total FROM crm_contacts c WHERE ${where}`,values)).rows[0].total;
 const countScope=contactManager(user)?'true':'owner_id=$1';const count=(await query(`SELECT count(*)::int AS "all",count(*) FILTER(WHERE archived_at IS NULL AND status='ACTIVE')::int active,count(*) FILTER(WHERE owner_id=$${contactManager(user)?1:2})::int mine,count(*) FILTER(WHERE archived_at IS NOT NULL)::int archived FROM crm_contacts WHERE deleted_at IS NULL AND ${countScope}`,contactManager(user)?[user.id]:[user.id,user.id])).rows[0];
 const rows=(await query(`SELECT c.*,u.name owner_name FROM crm_contacts c LEFT JOIN users u ON u.id=c.owner_id WHERE ${where} ORDER BY c.${sort} ${direction} NULLS LAST,c.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,exportAll?10000:pageSize,exportAll?0:(page-1)*pageSize])).rows;
 return {data:rows,total,page,pageSize,counts:count,truncated:exportAll&&total>10000};
}
async function activity(req,id,action,summary){await recordActivity({actorUserId:req.user.id,entityType:'contact',entityId:id,action,summary});}
async function checkOwner(id){if(id&&!((await query('SELECT 1 FROM users WHERE id=$1 AND active AND deleted_at IS NULL',[id])).rowCount))throw new AppError('Choose an active owner.',422,'CONTACT_OWNER_INVALID');}
export async function saveContact(input,req,id=null,{importing=false,batchId=null}={}){
 let data=contactSchema.parse(input);return transaction(async()=>{
 const before=id?await contactAccess(id,req.user,{lock:true}):null;
 if(!contactManager(req.user)){if(data.owner_id&&data.owner_id!==req.user.id)throw new AppError('Only a contact manager can reassign ownership.',403,'FORBIDDEN');data.owner_id=req.user.id;}
 else if(!id&&!data.owner_id)data.owner_id=req.user.id;
 await checkOwner(data.owner_id);
 const emails=[normalizeEmail(data.email),normalizeEmail(data.secondary_email)].filter(Boolean).sort();
 for(const email of emails)await query('SELECT pg_advisory_xact_lock(hashtextextended($1,600060))',['crm-contact:'+email]);
 const duplicate=(await query("SELECT id FROM crm_contacts WHERE deleted_at IS NULL AND id IS DISTINCT FROM $1::uuid AND (email_normalized=ANY($2::text[]) OR lower(btrim(secondary_email))=ANY($2::text[])) LIMIT 1",[id,emails])).rows[0];
 if(duplicate)throw new AppError('This email already belongs to a contact. Review the existing record instead.',409,'CONTACT_DUPLICATE',contactManager(req.user)?{id:duplicate.id}:undefined);
 if(before){const linked=(await query('SELECT sales_qualified FROM clients WHERE contact_id=$1 AND deleted_at IS NULL',[id])).rows;if(linked.some(row=>row.sales_qualified))data.contact_type='CLIENT';else if(linked.length&&data.contact_type==='CLIENT')data.contact_type='PROSPECT';}
 if(importing&&before?.marketing_consent==='OPTED_OUT')data={...data,marketing_consent:'OPTED_OUT',consent_source:before.consent_source,consented_at:before.consented_at};
 let companyId=null;if(data.company){const company=(await query("INSERT INTO crm_companies(name,normalized_name) VALUES($1,lower(btrim($1))) ON CONFLICT(normalized_name) DO UPDATE SET normalized_name=EXCLUDED.normalized_name RETURNING id",[data.company])).rows[0];companyId=company.id;}
 const fields=Object.keys(data),values=Object.values(data);fields.push('company_id');values.push(companyId);
 if(batchId&&!id){fields.push('import_batch_id');values.push(batchId);}
 const row=(await query(id?`UPDATE crm_contacts SET ${fields.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=now(),marketing_opted_out_at=CASE WHEN $${fields.indexOf('marketing_consent')+1}='OPTED_OUT' THEN COALESCE(marketing_opted_out_at,now()) ELSE marketing_opted_out_at END WHERE id=$${values.length+1} RETURNING *`:`INSERT INTO crm_contacts(${fields.join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,id?[...values,id]:values)).rows[0];
 if(row.marketing_consent==='OPTED_OUT'){
  await query("INSERT INTO campaign_suppressions(email,reason) VALUES($1,'CRM contact opted out') ON CONFLICT(email) DO NOTHING",[row.email_normalized]);
  await query('UPDATE leads SET marketing_email_opt_in=false,marketing_opted_out_at=COALESCE(marketing_opted_out_at,now()) WHERE contact_id=$1',[row.id]);
  await query('UPDATE clients SET marketing_email_opt_in=false,marketing_opted_out_at=COALESCE(marketing_opted_out_at,now()) WHERE contact_id=$1',[row.id]);
 }
 await writeAudit({req,action:id?'contact_updated':'contact_created',entity:'contact',entityId:row.id,before,after:row});await activity(req,row.id,id?'contact_updated':'contact_created',id?'Contact updated':'Contact created');return row;
 });
}
export async function contactState(id,action,req){return transaction(async()=>{
 const row=await contactAccess(id,req.user,{lock:true});
 if(action==='delete'){
  if(!contactManager(req.user))throw new AppError('Contact manager permission required.',403,'FORBIDDEN');
  const links=(await query('SELECT 1 FROM leads WHERE contact_id=$1 UNION ALL SELECT 1 FROM clients WHERE contact_id=$1 UNION ALL SELECT 1 FROM campaign_recipients WHERE contact_id=$1 UNION ALL SELECT 1 FROM communications WHERE contact_id=$1 LIMIT 1',[id])).rowCount;
  if(links)throw new AppError('This contact has linked business records. Archive it to preserve that history.',409,'CONTACT_LINKED');
 }
 const set=action==='archive'?'archived_at=now()':action==='restore'?'archived_at=NULL':'deleted_at=now()';const saved=(await query(`UPDATE crm_contacts SET ${set},updated_at=now() WHERE id=$1 RETURNING *`,[id])).rows[0];
 await writeAudit({req,action:'contact_'+action,entity:'contact',entityId:id,before:row,after:saved});await activity(req,id,'contact_'+action,'Contact '+action+'d');return saved;
 });}
export async function contactDetail(id,user){
 const contact=await contactAccess(id,user);const canSales=contactCan(user,'read:sales'),canFinance=contactCan(user,'read:finance'),canEvents=contactCan(user,'read:events'),canEmails=contactCan(user,'read:communications');
 const [company,notes,activity,leads,clients,emails,campaigns]=await Promise.all([
 query('SELECT * FROM crm_companies WHERE id=$1',[contact.company_id]),query('SELECT n.*,u.name author_name FROM crm_contact_notes n JOIN users u ON u.id=n.author_id WHERE contact_id=$1 AND n.deleted_at IS NULL ORDER BY n.created_at DESC',[id]),query("SELECT a.*,u.name actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_user_id WHERE entity_type='contact' AND entity_id=$1 ORDER BY created_at DESC LIMIT 200",[id]),
 canSales?query('SELECT id,first_name,last_name,email,status,event_date,event_type FROM leads WHERE contact_id=$1 AND deleted_at IS NULL',[id]):{rows:[]},canSales?query('SELECT id,name,email,sales_qualified FROM clients WHERE contact_id=$1 AND deleted_at IS NULL',[id]):{rows:[]},
 canEmails?query("SELECT id,type,channel,direction,subject,status,occurred_at,sent_at FROM communications WHERE deleted_at IS NULL AND (contact_id=$1 OR lead_id IN (SELECT id FROM leads WHERE contact_id=$1) OR client_id IN (SELECT id FROM clients WHERE contact_id=$1)) ORDER BY occurred_at DESC LIMIT 100",[id]):{rows:[]},
 contactCan(user,'campaigns.read')?query('SELECT DISTINCT c.id,c.name,c.status FROM campaigns c JOIN campaign_recipients r ON r.campaign_id=c.id WHERE c.deleted_at IS NULL AND (r.contact_id=$1 OR r.lead_id IN (SELECT id FROM leads WHERE contact_id=$1) OR r.client_id IN (SELECT id FROM clients WHERE contact_id=$1))',[id]):{rows:[]}]);
 const ids=clients.rows.map(c=>c.id);const [events,proposals,invoices]=await Promise.all([canEvents&&canSales?query('SELECT id,event_name,event_date,status FROM events WHERE client_id=ANY($1::uuid[]) AND deleted_at IS NULL AND sales_closed_at IS NULL',[ids]):{rows:[]},canSales?query('SELECT id,proposal_number,status,total FROM proposals WHERE deleted_at IS NULL AND (client_id=ANY($1::uuid[]) OR lead_id IN(SELECT id FROM leads WHERE contact_id=$2))',[ids,id]):{rows:[]},canFinance&&canSales?query('SELECT id,invoice_number,status,total FROM invoices WHERE client_id=ANY($1::uuid[]) AND deleted_at IS NULL',[ids]):{rows:[]}]);
 return {...contact,company_info:company.rows[0]||null,notes:notes.rows,activity:activity.rows,emails:emails.rows,related:{leads:leads.rows,clients:clients.rows.filter(row=>row.sales_qualified),events:events.rows,proposals:proposals.rows,invoices:invoices.rows,campaigns:campaigns.rows},marketing_suppressed:Boolean((await query('SELECT 1 FROM campaign_suppressions WHERE lower(email)=$1',[contact.email_normalized])).rowCount)};
}
export async function saveContactNote(id,input,req,noteId=null){return transaction(async()=>{await contactAccess(id,req.user);const body=String(input.body||'').trim();if(!body||body.length>5000)throw new AppError('Enter a note up to 5,000 characters.',422,'CONTACT_NOTE_INVALID');
 if(noteId){const existing=(await query('SELECT * FROM crm_contact_notes WHERE id=$1 AND contact_id=$2 AND deleted_at IS NULL FOR UPDATE',[noteId,id])).rows[0];if(!existing||existing.author_id!==req.user.id&&!contactManager(req.user))throw notFound('Note');}
 const row=(await query(noteId?'UPDATE crm_contact_notes SET body=$1,updated_at=now() WHERE id=$2 AND contact_id=$3 RETURNING *':'INSERT INTO crm_contact_notes(body,contact_id,author_id) VALUES($1,$2,$3) RETURNING *',noteId?[body,noteId,id]:[body,id,req.user.id])).rows[0];await writeAudit({req,action:'contact_note_saved',entity:'contact_note',entityId:row.id,after:{contact_id:id}});await activity(req,id,'contact_note_saved',noteId?'Note edited':'Note added');return row;});}
export async function deleteContactNote(id,noteId,req){await contactAccess(id,req.user);const result=await query('UPDATE crm_contact_notes SET deleted_at=now() WHERE id=$1 AND contact_id=$2 AND deleted_at IS NULL AND (author_id=$3 OR $4) RETURNING id',[noteId,id,req.user.id,contactManager(req.user)]);if(!result.rowCount)throw notFound('Note');await writeAudit({req,action:'contact_note_deleted',entity:'contact_note',entityId:noteId,after:{contact_id:id}});return {deleted:true};}
export async function linkContactLead(id,leadId,req){return transaction(async()=>{const c=await contactAccess(id,req.user,{lock:true});const l=(await query('SELECT id,email,contact_id FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[leadId])).rows[0];if(!l)throw notFound('Lead');if(![normalizeEmail(c.email),normalizeEmail(c.secondary_email)].includes(normalizeEmail(l.email)))throw new AppError('The lead email does not match this contact. Review the identity before linking.',409,'CONTACT_IDENTITY_CONFLICT');if(l.contact_id&&l.contact_id!==id)throw new AppError('Lead is already linked to another contact.',409,'CONTACT_ALREADY_LINKED');await query('UPDATE leads SET contact_id=$1 WHERE id=$2',[id,leadId]);await activity(req,id,'contact_lead_linked','Existing lead linked');await writeAudit({req,action:'contact_lead_linked',entity:'contact',entityId:id,after:{lead_id:leadId}});return {linked:true};});}
