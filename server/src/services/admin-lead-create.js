import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {recordActivity} from './activity-service.js';
import {writeAudit} from './audit-service.js';
const fieldsAllowed=new Set(['first_name','last_name','email','phone','event_date','event_start_time','event_end_time','event_type','guest_count','venue_name','venue_address','city','state','zip','preferred_experience_id','preferred_package_id','referral_source','message','assigned_user_id','status','company','preferred_contact_method','estimated_budget','campaign','utm_source','utm_medium','utm_campaign','utm_content','marketing_email_opt_in','follow_up_date','notes','lead_source','contact_id']);
export async function createAdminLead(input,req,{continueAnyway=false}={}){return transaction(async()=>{
 await query('SELECT pg_advisory_xact_lock(hashtextextended($1,600061))',['crm-lead:'+input.email.trim().toLowerCase()]);
 if(!continueAnyway){const duplicate=(await query("SELECT id,first_name,last_name,email,phone FROM leads WHERE deleted_at IS NULL AND (lower(btrim(email))=lower(btrim($1)) OR regexp_replace(phone,'\\D','','g')=regexp_replace($2,'\\D','','g')) LIMIT 1",[input.email,input.phone])).rows[0];if(duplicate)throw new AppError('Possible duplicate lead found.',409,'POSSIBLE_DUPLICATE',{duplicate:{...duplicate,match_reason:duplicate.email.toLowerCase()===input.email.toLowerCase()?'EMAIL_MATCH':'PHONE_MATCH'}});}
 const body=Object.fromEntries(Object.entries(input).filter(([k])=>fieldsAllowed.has(k))),fields=Object.keys(body),values=Object.values(body);
 const row=(await query(`INSERT INTO leads(${fields.join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values)).rows[0];
 await recordActivity({actorUserId:req.user.id,entityType:'lead',entityId:row.id,action:'lead_created',summary:'Lead created manually'});await writeAudit({req,action:'lead_created',entity:'lead',entityId:row.id,after:row});return row;
});}
