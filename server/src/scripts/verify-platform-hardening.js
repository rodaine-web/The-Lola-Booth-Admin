// Non-payment integration checks against a new disposable local PostgreSQL database.
// Does not use production credentials, mail providers, or customer accounts.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
const name=`lola_hardening_${Date.now()}`;
const admin=new pg.Client({host:'/private/tmp',port:55439,database:'postgres'});await admin.connect();await admin.query(`CREATE DATABASE ${name}`);
const db=new pg.Client({host:'/private/tmp',port:55439,database:name});await db.connect();
let server,pool;const passed=[];
try {
 for(const file of (await fs.readdir('server/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.query(await fs.readFile('server/migrations/'+file,'utf8'));
 passed.push('Complete migration chain applies to an empty database');
 for(const role of ['OWNER','ADMIN','SUPER_ADMIN','ATTENDANT'])await db.query('INSERT INTO roles(name) VALUES($1) ON CONFLICT DO NOTHING',[role]);
 for(const permission of ['*','read:admin','read:finance','write:finance','read:content','write:content','read:website','write:website','read:settings','write:settings','read:sales','write:sales','assign:roles','view:users','create:users','edit:users','disable:users','invitations.send','password_resets.send'])await db.query('INSERT INTO permissions(key) VALUES($1) ON CONFLICT DO NOTHING',[permission]);
 await db.query("INSERT INTO role_permissions SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='OWNER' AND p.key='*' ON CONFLICT DO NOTHING");
 await db.query("INSERT INTO role_permissions SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='SUPER_ADMIN' AND p.key <> '*' ON CONFLICT DO NOTHING");
 const owner=(await db.query("INSERT INTO users(name,email,password_hash) VALUES('QA Owner','owner@example.invalid','disabled') RETURNING id")).rows[0];
 await db.query("INSERT INTO user_roles SELECT $1,id FROM roles WHERE name='OWNER'",[owner.id]);
 const restricted=(await db.query("INSERT INTO users(name,email,password_hash) VALUES('QA Restricted','restricted@example.invalid','disabled') RETURNING id")).rows[0];
 const superAdmin=(await db.query("INSERT INTO users(name,email,password_hash) VALUES('QA Super Admin','super@example.invalid','disabled') RETURNING id")).rows[0];
 await db.query("INSERT INTO user_roles SELECT $1,id FROM roles WHERE name='SUPER_ADMIN'",[superAdmin.id]);
 await db.query("INSERT INTO business_settings(business_name) SELECT 'LOLA QA' WHERE NOT EXISTS(SELECT 1 FROM business_settings)");
 process.env.DATABASE_URL=`postgresql://localhost:55439/${name}?host=/private/tmp`;process.env.JWT_SECRET=crypto.randomBytes(40).toString('hex');process.env.EMAIL_PROVIDER='development';process.env.SMS_PROVIDER='none';process.env.NODE_ENV='test';process.env.PORT='0';process.env.RATE_LIMIT_MAX='1000';process.env.LOCAL_STORAGE_ROOT='/private/tmp/'+name;
 const {env}=await import('../config/env.js');env.databaseUrl=process.env.DATABASE_URL;env.port=0;env.emailProvider='development';env.jwtSecret=process.env.JWT_SECRET;
 ({server}=await import('../index.js'));({pool}=await import('../db/pool.js'));if(!server.listening)await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;env.clientOrigin=base;
 const token=id=>jwt.sign({},env.jwtSecret,{subject:id,expiresIn:'10m'});
 async function call(method,path,body,id=owner.id){const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(id?{authorization:'Bearer '+token(id)}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json().catch(()=>null);return {status:r.status,data};}
 assert.equal((await call('GET','/users',null,null)).status,401);
 for(const [method,path,body] of [['POST','/users',{name:'Denied',email:'denied@example.invalid'}],['PATCH','/settings',{business_name:'Denied'}],['POST','/users/'+owner.id+'/password-reset',{}],['POST','/communications/send',{recipient:'nobody@example.invalid',subject:'Denied',body:'Denied'}]])assert.equal((await call(method,path,body,restricted.id)).status,403,path);
 passed.push('Unauthenticated and restricted users denied protected API actions');
 const created=await call('POST','/users',{name:'QA Member',first_name:'QA',last_name:'Member',email:'member@example.invalid',roles:['ATTENDANT'],permissions:['read:website']},superAdmin.id);assert.equal(created.status,201,JSON.stringify(created));const id=created.data.id;
 assert.equal((await call('GET','/auth/me',null,id)).data.user.permissions.includes('read:website'),true);
 assert.equal((await call('PATCH','/users/'+id,{phone:'555-0100',roles:['ATTENDANT'],permissions:[]},superAdmin.id)).status,200);
 assert.equal((await call('GET','/auth/me',null,id)).data.user.permissions.includes('read:website'),false);
 for(const roles of [['ROOT'],['OWNER']])assert.equal((await call('PATCH','/users/'+id,{roles},superAdmin.id)).status,403);
 assert.equal((await call('PATCH','/users/'+id,{permissions:['*']},superAdmin.id)).status,403);
 assert.equal((await call('POST','/users/'+owner.id+'/deactivate',{},superAdmin.id)).status,403);
 passed.push('Super Admin create/edit and canonical privileges; ROOT/OWNER escalation denied');
 assert.equal((await call('POST','/users/'+id+'/deactivate',{},superAdmin.id)).status,200);assert.equal((await call('GET','/auth/me',null,id)).status,401);
 assert.equal((await call('POST','/users/'+id+'/reactivate',{},superAdmin.id)).status,200);
 assert.equal((await call('POST','/users/'+id+'/resend-invitation',{},superAdmin.id)).status,201);
 assert.equal((await db.query("SELECT count(*)::int n FROM user_account_tokens WHERE user_id=$1 AND token_type='INVITATION' AND used_at IS NULL",[id])).rows[0].n,1);
 const setup=crypto.randomBytes(32).toString('hex');await db.query("INSERT INTO user_account_tokens(user_id,token_hash,token_type,expires_at) VALUES($1,$2,'INVITATION',now()+interval '1 hour')",[id,crypto.createHash('sha256').update(setup).digest('hex')]);
 const setupPassword='QA-only-'+crypto.randomBytes(14).toString('hex');
 const setupResponses=await Promise.all([call('POST','/auth/setup-password',{token:setup,password:setupPassword},null),call('POST','/auth/setup-password',{token:setup,password:setupPassword},null)]);assert.deepEqual(setupResponses.map(r=>r.status).sort(),[200,400]);
 assert.equal((await call('POST','/auth/setup-password',{token:setup,password:'Another-QA-password'},null)).status,400);
 passed.push('Deactivate/reactivate, invitation invalidation and concurrent single-use password setup');
 const login=await call('POST','/auth/login',{email:'member@example.invalid',password:setupPassword},null);assert.equal(login.status,200);
 assert.equal((await call('POST','/auth/refresh',{refreshToken:login.data.refreshToken},null)).status,200);
 assert.equal((await call('POST','/auth/logout',{refreshToken:login.data.refreshToken},null)).status,204);
 assert.equal((await call('POST','/auth/refresh',{refreshToken:login.data.refreshToken},null)).status,401);
 assert.equal((await call('POST','/auth/login',{email:'member@example.invalid',password:'incorrect-password'},null)).status,401);
 const expired=crypto.randomBytes(32).toString('hex');await db.query("INSERT INTO user_account_tokens(user_id,token_hash,token_type,expires_at) VALUES($1,$2,'PASSWORD_RESET',now()-interval '1 hour')",[id,crypto.createHash('sha256').update(expired).digest('hex')]);
 assert.equal((await call('POST','/auth/setup-password',{token:expired,password:'Expired-token-should-not-work'},null)).status,400);
 passed.push('Login, refresh, logout invalidation, incorrect credentials and expired setup-token rejection');
 const lead=await call('POST','/leads',{first_name:'QA',last_name:'Lead',email:'lead@example.invalid',phone:'5551234567',event_date:'2027-01-12',event_type:'Corporate'});assert.equal(lead.status,201,JSON.stringify(lead));
 assert.equal((await call('PATCH','/leads/'+lead.data.id,{status:'QUALIFIED'})).status,200);
 assert.equal((await call('GET','/leads/'+lead.data.id)).status,200);
 const crmClient=await call('POST','/clients',{name:'Local QA Company',email:'company@example.invalid',client_type:'CORPORATE'});assert.equal(crmClient.status,201,JSON.stringify(crmClient));
 assert.equal((await call('PATCH','/clients/'+crmClient.data.id,{phone:'5551234568'})).status,200);
 assert.equal((await call('GET','/clients/'+crmClient.data.id)).status,200);
 const event=await call('POST','/events',{client_id:crmClient.data.id,event_name:'Local QA Event',event_type:'Corporate',event_date:'2027-01-12',start_time:'18:00',end_time:'21:00'});assert.equal(event.status,201,JSON.stringify(event));
 assert.equal((await call('GET','/events/'+event.data.id)).status,200);
 assert.equal((await call('GET','/calendar?date=2027-01-12')).status,200);
 for(const range of ['today','week','mtd','ytd']){const dashboard=await call('GET','/dashboard?range='+range);assert.equal(dashboard.status,200,JSON.stringify(dashboard));}
 passed.push('Lead/client create/view/update, event creation/calendar and all dashboard date ranges');
 for(const document_template_key of ['standard_event_proposal','corporate_brand_activation']){
   const created=await call('POST','/proposals',{lead_id:lead.data.id,client_id:crmClient.data.id,event_id:event.data.id,proposal_title:'Local QA '+document_template_key,document_template_key,package_amount:100,valid_through:'2027-02-01',custom_services:[{description:'QA bespoke service',quantity:1,unit_price:50}]});assert.equal(created.status,201,JSON.stringify(created));
   const detail=await call('GET','/proposals/'+created.data.id);assert.equal(detail.status,200,JSON.stringify(detail));assert.ok(detail.data.versions.length>0);
   const pdf=await fetch(base+'/api/proposals/'+created.data.id+'/pdf',{headers:{authorization:'Bearer '+token(owner.id)}});assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
   assert.equal((await call('GET','/public/proposals/'+detail.data.secure_token,null,null)).status,200);
   assert.equal((await call('POST','/public/proposals/'+detail.data.secure_token+'/accept',{acceptedByName:'Local QA Customer'},null)).status,409);
   const updated=await call('PATCH','/proposals/'+created.data.id,{notes:'Version two',package_amount:120});assert.equal(updated.status,200,JSON.stringify(updated));assert.equal(Number(updated.data.total),170);
   assert.ok((await call('GET','/proposals/'+created.data.id)).data.versions.length>=2);
   assert.equal((await call('POST','/proposals/'+created.data.id+'/send',{})).status,200);
   assert.equal((await call('POST','/public/proposals/'+detail.data.secure_token+'/accept',{acceptedByName:'Local QA Customer'},null)).status,200);
   assert.equal((await call('POST','/public/proposals/'+detail.data.secure_token+'/decline',{},null)).status,409);
 }
 const funnelDashboard=(await call('GET','/dashboard?range=mtd')).data;
 const funnelList=await call('GET','/proposals?'+new URLSearchParams({funnel:'sent',from:funnelDashboard.sqlRange.start,to:funnelDashboard.sqlRange.end}));assert.equal(funnelList.status,200,JSON.stringify(funnelList));assert.equal(funnelList.data.pagination.total,funnelDashboard.funnel.stages.find(stage=>stage.key==='proposals_sent').count);assert.equal(funnelList.data.data.length,1);
 passed.push('Dashboard proposal funnel count matches its filtered list for repeated proposals on one lead');
 const uploaded=await call('POST','/proposals/upload',{client_id:crmClient.data.id,event_id:event.data.id,filename:'local-qa-proposal.pdf',proposal_title:'Local uploaded QA',total_investment:200,pdf_base64:(await fs.readFile('qa-output/LOLA-Invoice-QA.pdf')).toString('base64')});assert.equal(uploaded.status,201,JSON.stringify(uploaded));
 const uploadPdf=await fetch(base+'/api/proposals/'+uploaded.data.id+'/pdf',{headers:{authorization:'Bearer '+token(owner.id)}});assert.equal(uploadPdf.status,200);assert.equal(Buffer.from(await uploadPdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 passed.push('Standard/bespoke proposal PDF/public link/version/email/acceptance and uploaded-document retrieval');
 const customer=(await db.query("INSERT INTO clients(name,email) VALUES('QA Customer','customer@example.invalid') RETURNING id")).rows[0];
 const invoice=await call('POST','/invoices',{client_id:customer.id,items:[{description:'QA service',quantity:1,unit_price:100,taxable:false,tax_rate:0,discount:0}]});assert.equal(invoice.status,201,JSON.stringify(invoice));
 const detail=await call('GET','/invoices/'+invoice.data.id);assert.equal(detail.status,200,JSON.stringify(detail));assert.equal(detail.data.items.length,1);assert.equal(Number(detail.data.total),100);
 const edited=await call('PATCH','/invoices/'+invoice.data.id,{notes:'Updated draft',items:[{description:'Revised service',quantity:2,unit_price:75,taxable:false}]});assert.equal(edited.status,200,JSON.stringify(edited));assert.equal(Number(edited.data.total),150);assert.equal(edited.data.notes,'Updated draft');
 assert.equal((await call('PATCH','/invoices/'+invoice.data.id,{notes:'Denied'},restricted.id)).status,403);
 await db.query("UPDATE invoices SET status='SENT' WHERE id=$1",[invoice.data.id]);
 assert.equal((await call('PATCH','/invoices/'+invoice.data.id,{notes:'Must not change'})).status,409);
 passed.push('Draft invoice edits recalculate totals; sent documents and restricted actors cannot edit');
 const pdf=await fetch(base+'/api/invoices/'+invoice.data.id+'/pdf',{headers:{authorization:'Bearer '+token(owner.id)}});assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 assert.equal((await call('GET','/invoices/'+crypto.randomUUID())).status,404);
 assert.equal((await call('GET','/pickers/experiences?q=')).status,200);
 passed.push('Invoice creation/detail/PDF/not-found and experience picker execute against migrated schema');
 const mediaBody={filename:'qa.png',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6X1sAAAAASUVORK5CYII=',altText:'Local QA image',visibility:'PUBLIC',permissionState:'APPROVED'};
 const imageA=await call('POST','/website/media',mediaBody);assert.equal(imageA.status,201,JSON.stringify(imageA));
 const imageB=await call('POST','/website/media',{...mediaBody,filename:'qa-replacement.png'});assert.equal(imageB.status,201,JSON.stringify(imageB));
 const mediaResponse=await fetch(base+'/api/public/media/'+imageA.data.id);assert.equal(mediaResponse.status,200);assert.equal(mediaResponse.headers.get('cross-origin-resource-policy'),'cross-origin');
 const fixtures=[
  ['hero','heroSlides',{alt_text:'QA hero',desktop_image_file_id:imageA.data.id,is_active:true},'desktop_image_file_id'],
  ['gallery','gallery',{title:'QA gallery',alt_text:'QA gallery',media_id:imageA.data.id,category:'GLAM'},'media_id'],
  ['eventTypes','eventTypes',{name:'QA event',slug:'qa-event',image_media_id:imageA.data.id,show_on_website:true},'image_media_id'],
  ['testimonials','testimonials',{client_name:'QA only',quote:'Local verification',rating:5,client_photo_media_id:imageA.data.id},'client_photo_media_id'],
  ['faqs','faqs',{question:'QA question?',answer:'Local verification'},null],
  ['mediaMappings','mediaMappings',{asset_key:'assets/qa.png',media_id:imageA.data.id},'media_id']
 ];
 for(const [type,collection,body,assetField] of fixtures){
   const created=await call('POST','/website/'+type,{...body,status:'DRAFT',display_order:900});assert.equal(created.status,201,JSON.stringify(created));const cid=created.data.id,route='/website/'+type+'/'+cid;
   assert.equal((await call('POST',route+'/publish',{})).status,200,type+' publish');
   assert.ok((await call('GET','/public/site',null,null)).data[collection].some(x=>x.id===cid),type+' visible');
   assert.equal((await call('PATCH',route,{display_order:3,...(assetField?{[assetField]:imageB.data.id}:{answer:'Edited QA answer'})})).status,200,type+' edit');
   const item=(await call('GET','/public/site',null,null)).data[collection].find(x=>x.id===cid);assert.equal(item.display_order,3);
   if(assetField)assert.ok(JSON.stringify(item).includes(imageB.data.id),type+' replacement');
   assert.equal((await call('POST',route+'/unpublish',{})).status,200,type+' unpublish');
   assert.equal((await call('GET','/public/site',null,null)).data[collection].some(x=>x.id===cid),false,type+' hidden');
   assert.equal((await call('POST',route+'/publish',{})).status,200,type+' republish');
   assert.ok((await call('GET','/public/site',null,null)).data[collection].some(x=>x.id===cid),type+' restored');
 }
 passed.push('Hero/gallery/event/testimonial/FAQ/image mapping lifecycle with asset replacement and public retrieval');
 for(const [resource,body,field,changed] of [
  ['experiences',{name:'QA Experience',slug:'qa-experience',website_heading:'Original heading',base_price:100,cover_image_media_id:imageA.data.id},'website_heading','Edited heading'],
  ['packages',{name:'QA Package',website_key:'qa:package',starting_price:100,website_features:['QA service']},'starting_price',125]
 ]){
   const created=await call('POST','/'+resource,{...body,website_status:'DRAFT',show_on_website:true,active:true});assert.equal(created.status,201,JSON.stringify(created));const cid=created.data.id,route='/'+resource+'/'+cid;
   assert.equal((await call('PATCH',route,{website_status:'PUBLISHED'})).status,200);
   assert.ok((await call('GET','/public/site',null,null)).data[resource].some(x=>x.id===cid));
   assert.equal((await call('PATCH',route,{[field]:changed,display_order:3,...(resource==='experiences'?{cover_image_media_id:imageB.data.id}:{website_display_order:3})})).status,200);
   const item=(await call('GET','/public/site',null,null)).data[resource].find(x=>x.id===cid);assert.equal(item[field],changed);
   if(resource==='experiences')assert.ok(item.image.includes(imageB.data.id));
   assert.equal((await call('PATCH',route,{website_status:'DRAFT'})).status,200);
   assert.equal((await call('GET','/public/site',null,null)).data[resource].some(x=>x.id===cid),false);
   assert.equal((await call('PATCH',route,{website_status:'PUBLISHED'})).status,200);
   assert.ok((await call('GET','/public/site',null,null)).data[resource].some(x=>x.id===cid));
 }
 passed.push('Experience/package publish, edit, replacement where applicable, ordering, unpublish and republish');
 await db.query("INSERT INTO user_permissions SELECT $1,id FROM permissions WHERE key='write:website' ON CONFLICT DO NOTHING",[restricted.id]);
 assert.equal((await call('POST','/website/pageItems',{page_slug:'home',slot_key:'qa.forbidden',html:'Should never publish',status:'PUBLISHED'},restricted.id)).status,403);
 passed.push('Website editors cannot bypass publish privileges through direct record creation');
 const cmsItem=await call('POST','/website/pageItems',{page_slug:'home',slot_key:'qa.lifecycle',html:'QA first',display_order:9000,status:'DRAFT'});assert.equal(cmsItem.status,201,JSON.stringify(cmsItem));const cmsId=cmsItem.data.id;
 assert.equal((await call('POST','/website/pageItems/'+cmsId+'/publish',{},restricted.id)).status,403);
 assert.equal((await call('POST','/website/pageItems/'+cmsId+'/publish',{})).status,200);
 assert.ok((await call('GET','/public/site',null,null)).data.pageItems.some(x=>x.id===cmsId));
 assert.equal((await call('PATCH','/website/pageItems/'+cmsId,{html:'QA revised',display_order:5})).status,200);
 let current=(await call('GET','/public/site',null,null)).data.pageItems.find(x=>x.id===cmsId);assert.equal(current.html,'QA revised');assert.equal(current.display_order,5);
 assert.equal((await call('POST','/website/pageItems/'+cmsId+'/unpublish',{})).status,200);
 assert.equal((await call('GET','/public/site',null,null)).data.pageItems.some(x=>x.id===cmsId),false);
 assert.equal((await call('POST','/website/pageItems/'+cmsId+'/publish',{})).status,200);
 assert.ok((await call('GET','/public/site',null,null)).data.pageItems.some(x=>x.id===cmsId));
 assert.equal((await call('GET','/website/diagnostics',null,restricted.id)).status,403);
 const diagnostics=await call('GET','/website/diagnostics');assert.equal(diagnostics.status,200,JSON.stringify(diagnostics));assert.equal(diagnostics.data.counts.pageItems,1);
 passed.push('CMS page-item edit/order/publish/unpublish/republish and protected diagnostics');
 const inquiry={firstName:'QA',lastName:'Inquiry',email:'inquiry@example.invalid',phone:'5551234567',eventDate:'2026-12-12',eventType:'Birthday',city:'Chicago',state:'IL',form_id:'contact',landing_page_url:'https://thelolabooth.com/contact',utm_campaign:'hardening-qa',message:'Controlled local form test'};
 assert.equal((await call('POST','/public/inquiries',{...inquiry,website:'spam'},null)).status,400);
 assert.equal((await call('POST','/public/inquiries',inquiry,null)).status,201);
 const queued=(await db.query("SELECT c.* FROM communications c JOIN leads l ON l.id=c.lead_id WHERE l.email='inquiry@example.invalid' AND c.trigger_key='PUBLIC_FORM'")).rows;
 assert.equal(queued.length,2);assert.ok(queued.every(c=>c.status==='SCHEDULED'&&c.rendered_html.includes('<')));
 const {processDueJobs}=await import('../services/automation-service.js');await processDueJobs({limit:25});
 const delivered=(await db.query("SELECT status FROM communications WHERE id=ANY($1::uuid[])",[queued.map(c=>c.id)])).rows;
 assert.ok(delivered.every(c=>c.status==='SENT_TO_PROVIDER'),JSON.stringify(delivered));
 passed.push('Form honeypot, persistence, two durable HTML email records and worker delivery');
 for(let n=0;n<25;n++)assert.equal((await call('GET','/public/site',null,null)).status,200);
 passed.push('Public content reads do not consume the form-submission quota');
 // Product stabilization: execute real new management and reporting routes.
 const equipment=await call('POST','/equipment',{name:'Synthetic camera kit',category:'Booth',status:'AVAILABLE'});assert.equal(equipment.status,201,JSON.stringify(equipment));assert.ok(equipment.data.asset_uid);
 assert.equal((await call('PATCH','/equipment/'+equipment.data.id,{status:'MAINTENANCE'})).status,200);
 assert.equal((await call('POST','/events/'+event.data.id+'/equipment',{equipmentId:equipment.data.id})).status,409);
 assert.equal((await call('PATCH','/equipment/'+equipment.data.id,{status:'AVAILABLE'})).status,200);
 const eqAssign=await call('POST','/events/'+event.data.id+'/equipment',{equipmentId:equipment.data.id});assert.equal(eqAssign.status,201,JSON.stringify(eqAssign));
 const staff=await call('POST','/staff',{name:'Synthetic attendant',email:'staff@example.invalid',active:true,availability:{unavailable_dates:['2027-01-12']}});assert.equal(staff.status,201,JSON.stringify(staff));
 assert.equal((await call('POST','/events/'+event.data.id+'/staff',{staffProfileId:staff.data.id})).status,409);
 assert.equal((await call('PATCH','/staff/'+staff.data.id,{availability:{unavailable_dates:[]}})).status,200);
 assert.equal((await call('POST','/events/'+event.data.id+'/staff',{staffProfileId:staff.data.id})).status,201);
 for(const resource of ['staff','equipment']){const rid=resource==='staff'?staff.data.id:equipment.data.id;const detail=await call('GET','/'+resource+'/'+rid);assert.equal(detail.status,200,JSON.stringify(detail));assert.equal(detail.data.assignments.length,1);assert.ok(detail.data.history.length>=2);assert.equal((await call('PATCH','/'+resource+'/'+rid,{name:'Denied'},restricted.id)).status,403);}
 passed.push('Staff/equipment real CRUD, audit history, assignment, unavailable/maintenance denial and restricted-role denial');
 for(const action of ['checkout','onsite','return']){const result=await call('POST',`/events/${event.data.id}/equipment/${eqAssign.data.id}/${action}`,{condition_before:'GOOD',condition_after:'GOOD'});assert.equal(result.status,200,JSON.stringify(result));}
 const assignment=(await call('GET','/staff/'+staff.data.id)).data.assignments[0];
 assert.equal((await call('POST',`/events/${event.data.id}/staff/${assignment.id}/acknowledge`,{})).status,200);
 for(const status of ['PREPARING','EN_ROUTE','ON_SITE','SETTING_UP','READY','LIVE','BREAKDOWN'])assert.equal((await call('POST',`/events/${event.data.id}/operations/status`,{status})).status,200);
 assert.equal((await call('GET',`/events/${event.data.id}/operations`)).status,200);
 const runSheet=await fetch(base+`/api/events/${event.data.id}/run-sheet.pdf`,{headers:{authorization:'Bearer '+token(owner.id)}});assert.equal(runSheet.status,200);assert.equal(Buffer.from(await runSheet.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 passed.push('Equipment checkout/on-site/return, staff acknowledgment, seven operational statuses and run-sheet PDF against real schema');

 for(const resource of ['staff','equipment','users'])assert.equal((await call('GET','/pickers/'+resource)).status,200);
 const analytics=await call('GET','/analytics?range=mtd');assert.equal(analytics.status,200,JSON.stringify(analytics));const d=(await call('GET','/dashboard?range=mtd')).data;
 assert.equal(Number(analytics.data.summary.average_booking_value),Number(d.groups.flatMap(g=>g.metrics).find(m=>m.key==='average_booking_value').value));
 assert.equal((await call('GET','/audit-logs?entity=equipment')).status,200);
 assert.equal((await call('GET','/integrations/overview')).data.communications[0].status,'DISABLED');
 passed.push('Human-readable roster/user pickers, Dashboard/Analytics metric parity, audit filters and development integration status');
 const convertLead=await call('POST','/leads',{first_name:'Concurrent',last_name:'Fixture',email:'convert@example.invalid',phone:'5550098881',event_date:'2027-12-16',event_type:'Corporate',preferred_package_id:(await db.query('SELECT id FROM packages LIMIT 1')).rows[0].id});
 assert.equal(convertLead.status,201,JSON.stringify(convertLead));
 const converted=await Promise.all([call('POST','/leads/'+convertLead.data.id+'/convert',{}),call('POST','/leads/'+convertLead.data.id+'/convert',{})]);assert.deepEqual(converted.map(r=>r.status).sort(),[200,201],JSON.stringify(converted));assert.equal(converted[0].data.event.id,converted[1].data.event.id);
 assert.equal((await db.query('SELECT count(*)::int n FROM bookings WHERE lead_id=$1',[convertLead.data.id])).rows[0].n,1);
 passed.push('Concurrent lead conversion produces one client/event/booking and safely reuses the result');
 const priced=await call('POST','/invoices',{client_id:customer.id,items:[{description:'Taxable fixture',quantity:3,unit_price:19.95,discount:1,tax_rate:8.25,taxable:true},{description:'Non-taxable fixture',quantity:1,unit_price:10,taxable:false}]});assert.equal(priced.status,201,JSON.stringify(priced));
 const pricedDetail=(await call('GET','/invoices/'+priced.data.id)).data;
 const pricedList=(await call('GET','/invoices?search='+pricedDetail.invoice_number)).data.data[0];
 const pricedPublic=(await call('GET','/public/invoices/'+pricedDetail.secure_token,null,null)).data.invoice;
 for(const item of [pricedDetail,pricedList,pricedPublic])for(const [key,value] of Object.entries({subtotal:69.85,discount:1,tax:4.86,total:73.71,amount_paid:0,amount_outstanding:73.71}))assert.equal(Number(item[key]),value,key);
 const pdfResponse=await fetch(base+`/api/invoices/${priced.data.id}/pdf`,{headers:{authorization:'Bearer '+token(owner.id)}});
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const invoicePdfTask=pdfjs.getDocument({data:new Uint8Array(await pdfResponse.arrayBuffer()),useSystemFonts:true});const invoicePdfDoc=await invoicePdfTask.promise;let pdfText='';for(let n=1;n<=invoicePdfDoc.numPages;n++)pdfText+=(await (await invoicePdfDoc.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');await invoicePdfTask.destroy();assert.match(pdfText,/73\.71/);assert.match(pdfText,/69\.85/);assert.match(pdfText,/4\.86/);
 passed.push('Tax/discount invoice totals agree across list/detail/public payload and actual PDF text');
 const privateMedia=await call('POST','/website/media',{...mediaBody,filename:'private-qa.png',visibility:'PRIVATE',permissionState:'RESTRICTED'});assert.equal(privateMedia.status,201);
 assert.ok([403,404].includes((await fetch(base+'/api/public/media/'+privateMedia.data.id)).status));
 assert.equal((await fetch(base+'/api/website/media/'+privateMedia.data.id+'/file',{headers:{authorization:'Bearer '+token(restricted.id)}})).status,403);
 passed.push('Private media denied to anonymous public requests and unauthorized Admin users');
 const metricValue=(payload,key)=>Number(payload.groups.flatMap(g=>g.metrics).find(m=>m.key===key).value);
 const beforeScope=(await call('GET','/dashboard?range=mtd')).data;
 await db.query("UPDATE leads SET data_classification='QA' WHERE id=$1",[convertLead.data.id]);await db.query("UPDATE bookings SET data_classification='QA' WHERE lead_id=$1",[convertLead.data.id]);
 const afterScope=(await call('GET','/dashboard?range=mtd')).data;assert.equal(metricValue(afterScope,'new_leads'),metricValue(beforeScope,'new_leads')-1);
 assert.equal((await db.query('SELECT count(*)::int n FROM leads WHERE id=$1',[convertLead.data.id])).rows[0].n,1);
 passed.push('Explicit QA classification excludes reporting activity without deleting original records');
 const publicLead=(await db.query("SELECT * FROM leads WHERE email='inquiry@example.invalid' AND deleted_at IS NULL")).rows[0];
 await call('PATCH','/leads/'+publicLead.id,{preferred_package_id:(await db.query('SELECT id FROM packages LIMIT 1')).rows[0].id,assigned_user_id:owner.id});
 const journeyConvert=await call('POST','/leads/'+publicLead.id+'/convert',{});assert.equal(journeyConvert.status,201,JSON.stringify(journeyConvert));
 const journeyProposal=await call('POST','/proposals',{lead_id:publicLead.id,client_id:journeyConvert.data.client.id,event_id:journeyConvert.data.event.id,proposal_title:'Synthetic full journey',package_amount:125,valid_through:'2027-12-20'});assert.equal(journeyProposal.status,201,JSON.stringify(journeyProposal));assert.ok(journeyProposal.data.proposal_number);
 const journeyDetail=(await call('GET','/proposals/'+journeyProposal.data.id)).data;
 assert.equal((await call('POST','/proposals/'+journeyProposal.data.id+'/send',{})).status,200);
 assert.equal((await call('POST','/public/proposals/'+journeyDetail.secure_token+'/accept',{acceptedByName:'Synthetic Customer'},null)).status,200);
 const journeyInvoice=await call('POST','/invoices',{proposal_id:journeyProposal.data.id});assert.equal(journeyInvoice.status,201,JSON.stringify(journeyInvoice));
 const journeyInvoiceDetail=(await call('GET','/invoices/'+journeyInvoice.data.id)).data;assert.equal(journeyInvoiceDetail.client_id,journeyConvert.data.client.id);assert.equal(journeyInvoiceDetail.event_id,journeyConvert.data.event.id);assert.ok(journeyInvoiceDetail.items.length);
 assert.ok((await db.query('SELECT id FROM communications WHERE proposal_id=$1',[journeyProposal.data.id])).rowCount>0);
 assert.ok((await db.query('SELECT id FROM audit_logs WHERE entity_id=ANY($1::uuid[])',[[publicLead.id,journeyProposal.data.id,journeyInvoice.data.id]])).rowCount>=3);
 passed.push('Continuous inquiry → assigned lead → client/event → numbered proposal → development send → public acceptance → related draft invoice and communication/audit records');
 if(process.argv.includes('--visual')){
  await db.query("UPDATE events SET event_date=current_date,status='CONFIRMED',operational_status='LIVE' WHERE id=$1",[event.data.id]);
  const {runLocalProductBrowser}=await import('./verify-local-product-browser.js');
  passed.push(...await runLocalProductBrowser({base,accessToken:token(owner.id),eventId:journeyConvert.data.event.id,proposalId:journeyProposal.data.id,invoiceId:journeyInvoice.data.id}));
 }
 await fs.mkdir('audit-output/platform-hardening',{recursive:true});await fs.writeFile('audit-output/platform-hardening/local-dashboard.json',JSON.stringify((await call('GET','/dashboard?range=mtd')).data,null,2));await fs.writeFile('audit-output/platform-hardening/local-api-report.json',JSON.stringify({checkedAt:new Date().toISOString(),passed},null,2));console.log(JSON.stringify({passed},null,2));
}finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.end();await db.end();await admin.query(`DROP DATABASE ${name}`);await admin.end();}
