import {pool,query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {saveStagingRecord} from '../services/staging-cms-service.js';
import {writeAudit} from '../middleware/audit.js';
import {redesignGuestScenes} from '../../../shared/redesign-content.js';
try{
 if(process.env.APP_ENV!=='staging')throw Error('Staging only');
 const apply=process.argv.includes('--apply');const result=await transaction(async client=>{
 await assertDatabaseIdentity(client);await query('SELECT pg_advisory_xact_lock(7811051)');
 const owner=(await query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.active=true AND r.name='OWNER' LIMIT 1")).rows[0];if(!owner)throw Error('Owner required');
 const user={...owner,permissions:['*']},req={user,headers:{'user-agent':'Owner requested home presentation update'}};
 const rows=(await query("SELECT * FROM website_channel_records WHERE channel='STAGING' AND status='PUBLISHED'")).rows;
 const title=rows.find(r=>r.entity_key==='redesign.home.hero.title'),hero=rows.find(r=>r.entity_key==='redesign.hero.home.glam'),experience=rows.find(r=>r.cms_type==='experiences'&&String(r.payload.slug).includes('360'));
 if(!title||!hero||!experience)throw Error('Reviewed home records missing');
 const glam=redesignGuestScenes.find(x=>x.key==='glam');
 const updates=[[title,{...title.payload,html:'Good People.<br>Better Photos.'}],[hero,{...hero.payload,image:glam.image,image_crop:glam.image_crop}],[experience,{...experience.payload,website_card_image:'/staging-site/assets/owner-360-guests-event.jpg',website_card_crop:null}]];
 if(!apply)return {dryRun:true,records:updates.length};
 for(const [old,payload]of updates)await saveStagingRecord(old.cms_type,{entity_key:old.entity_key,payload,status:old.status,display_order:old.display_order},user,old.id);
 await writeAudit({req,action:'staging-home-owner-refinements-2026-11-10',entity:'website_release',before:{records:updates.map(x=>x[0])},after:{records:3}});return {updated:3};
 });console.log(JSON.stringify(result));
}finally{await pool.end();}
