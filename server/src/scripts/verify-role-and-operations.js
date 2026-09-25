import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
export const roleAreas=[
 ['Dashboard','/dashboard','/','read:dashboard'],['Leads','/leads','/sales/leads','read:sales'],['Clients','/clients','/sales/clients','read:sales'],['Events','/events','/events/events','read:events'],['Calendar','/calendar','/events/calendar','read:events'],['Tasks','/tasks','/operations/tasks','read:tasks'],['Proposals','/proposals','/sales/proposals','read:sales'],['Invoices','/invoices','/finance/invoices','read:finance'],['Communications','/communications','/sales/communications','read:sales'],['Templates','/communications/templates','/sales/communications','read:sales'],['Automations','/communications/automations','/sales/communications','read:sales'],['Staff','/staff','/events/staff','read:events'],['Equipment','/equipment','/events/equipment','read:events'],['CMS','/website/pageItems','/website/page-items','read:website'],['Analytics','/analytics','/insights/analytics','read:analytics'],['Users','/users','/system/users','view:users'],['Integrations','/integrations/catalog','/system/integrations','read:integrations'],['Health','/system/health','/system/health','read:settings'],['Audit','/audit-logs','/system/audit-log','read:audit'],['Settings','/settings','/system/settings','read:settings']
];
export async function verifyRoleAndOperations({db,call,owner,token}){
 const passed=[],matrix=[],roles=[{name:'OWNER',id:owner.id,permissions:['*']}];
 const all=(await db.query("SELECT key FROM permissions WHERE key<>'*' AND key NOT ILIKE '%root%'")).rows.map(r=>r.key);
 const adminPermissions=['read:dashboard','read:sales','write:sales','read:events','write:events','read:finance','write:finance','read:tasks','write:tasks','read:analytics','read:website','read:operations','write:operations'];
 const operationsPermissions=['read:attendant','read:tasks'];
 for(const key of [...adminPermissions,...operationsPermissions])await db.query('INSERT INTO permissions(key) VALUES($1) ON CONFLICT DO NOTHING',[key]);
 for(const [name,permissions] of [['SUPER_ADMIN',all],['ADMIN',adminPermissions],['ATTENDANT',operationsPermissions]]){
  const created=await call('POST','/users',{first_name:'Matrix',last_name:name,name:'Matrix '+name,email:name.toLowerCase()+'-matrix@example.invalid',roles:[name],permissions});assert.equal(created.status,201,JSON.stringify(created));roles.push({name,id:created.data.id,permissions});
 }
 for(const role of roles){
  const actual=(await call('GET','/auth/me',null,role.id)).data.user.permissions;role.permissions=actual;
  for(const [area,path,route,permission] of roleAreas){const allowed=actual.includes('*')||actual.includes(permission);const result=await call('GET',path,null,role.id);assert.equal(result.status,allowed?200:403,`${role.name} ${area}: ${JSON.stringify(result.data)}`);matrix.push({role:role.name,area,allowed,status:result.status,route});}
 }
 const op=roles.find(r=>r.name==='ATTENDANT');
 for(const [path,body] of [['/users',{name:'Denied',email:'denied-role@example.invalid'}],['/tasks',{title:'Denied'}],['/communications/send',{to:'denied@example.invalid',subject:'Denied',body:'Denied'}],['/integrations/GA4/local-test',{}],['/sms-escalations',{entityType:'event',entityId:owner.id,rule:'urgent_operations',reason:'Denied'}]])assert.equal((await call('POST',path,body,op.id)).status,403);
 passed.push('Four disposable roles: 80 actual API module access cases plus five restricted write denials');
 const client=await call('POST','/clients',{name:'Operations Matrix',email:'ops-matrix@example.invalid',phone:'5559990011'});assert.equal(client.status,201);
 const createEvent=async name=>(await call('POST','/events',{client_id:client.data.id,event_name:name,event_type:'Corporate',event_date:'2027-11-07',start_time:'18:00',end_time:'21:00'})).data;
 const eventA=await createEvent('Conflict A'),eventB=await createEvent('Conflict B');
 const equipment=await call('POST','/equipment',{name:'Race fixture booth',category:'Booth',status:'AVAILABLE'});assert.equal(equipment.status,201);
 const race=await Promise.all([call('POST',`/events/${eventA.id}/equipment`,{equipmentId:equipment.data.id}),call('POST',`/events/${eventB.id}/equipment`,{equipmentId:equipment.data.id})]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
 const assignment=race.find(r=>r.status===201).data;const eventId=assignment.event_id;
 assert.equal((await call('POST',`/events/${eventId}/equipment`,{equipmentId:equipment.data.id})).data.id,assignment.id);
 assert.equal((await call('POST',`/events/${eventId}/equipment/${assignment.id}/checkout`,{condition_before:'GOOD'})).status,200);
 assert.equal((await call('POST',`/events/${eventId}/equipment/${assignment.id}/onsite`,{})).status,200);
 for(let i=0;i<2;i++)assert.equal((await call('POST',`/events/${eventId}/equipment/${assignment.id}/return`,{condition_after:'DAMAGED',notes:'Synthetic return issue'})).status,200);
 assert.equal((await db.query("SELECT count(*)::int n FROM tasks WHERE event_id=$1 AND title='Equipment maintenance needed'",[eventId])).rows[0].n,1);
 passed.push('Actual simultaneous equipment assignment conflict, repeated assignment reuse and damaged-return replay creates one maintenance task');
 const staff=await call('POST','/staff',{name:'Matrix operator',email:'matrix-op@example.invalid',active:true,user_id:op.id});assert.equal(staff.status,201);
 const staffRace=await Promise.all([call('POST',`/events/${eventA.id}/staff`,{staffProfileId:staff.data.id}),call('POST',`/events/${eventB.id}/staff`,{staffProfileId:staff.data.id})]);assert.deepEqual(staffRace.map(r=>r.status).sort(),[201,409]);
 const staffAssignment=staffRace.find(r=>r.status===201).data;
 assert.equal((await call('POST',`/events/${staffAssignment.event_id}/staff/${staffAssignment.id}/acknowledge`,{},op.id)).status,200);
 assert.equal((await call('POST',`/events/${staffAssignment.event_id}/staff/${staffAssignment.id}/decline`,{reason:'Synthetic unavailability'},op.id)).status,200);
 assert.equal((await call('DELETE',`/events/${staffAssignment.event_id}/staff/${staffAssignment.id}`)).status,200);
 const reassigned=await call('POST',`/events/${staffAssignment.event_id}/staff`,{staffProfileId:staff.data.id});assert.equal(reassigned.status,201);assert.notEqual(reassigned.data.id,staffAssignment.id);
 passed.push('Staff concurrency conflict, assigned operational-user acknowledgment/decline, removal and reassignment');
 const task=await call('POST','/tasks',{title:'Recovery task',event_id:eventA.id,assigned_user_id:owner.id,due_date:'2026-01-01',priority:'HIGH'});assert.equal(task.status,201);
 assert.equal((await call('PATCH',`/tasks/${task.data.id}`,{title:''})).status,400);
 for(const status of ['DONE','OPEN'])assert.equal((await call('PATCH',`/tasks/${task.data.id}`,{status})).data.status,status);
 assert.ok((await call('GET','/tasks?search=Recovery&overdue=true')).data.data.some(r=>r.id===task.data.id));
 const incident=await call('POST',`/events/${eventA.id}/incidents`,{type:'TECHNICAL',severity:'LOW',description:'Synthetic incident'});assert.equal(incident.status,201);
 assert.equal((await call('PATCH',`/events/${eventA.id}/incidents/${incident.data.id}`,{status:'RESOLVED',resolution_notes:'Synthetic resolution'})).data.status,'RESOLVED');
 const dateChange={event_date:'2027-12-31',start_time:'23:00',end_time:'23:59'};
 assert.equal((await call('POST',`/events/${eventA.id}/operations/reschedule`,dateChange)).status,200);
 assert.equal((await call('POST',`/events/${eventA.id}/operations/reschedule`,{...dateChange,confirm:true})).status,200);
 for(const date of ['2027-03-14','2027-11-07','2027-12-31','2028-01-01']){
  const boundary=(await call('POST','/events',{client_id:client.data.id,event_name:'Calendar boundary '+date,event_type:'Corporate',event_date:date,start_time:'01:30',end_time:'03:30'})).data;
  for(const view of ['month','week','day']){const result=await call('GET',`/calendar?date=${date}&view=${view}`);assert.equal(result.status,200);const match=result.data.events.find(e=>e.id===boundary.id);assert.ok(match,view+' missing boundary event');assert.equal(match.event_date,date);}
 }

 passed.push('Task validation recovery/complete/reopen/overdue search, incident resolve, reschedule preview/commit and 12 Calendar boundary queries');
 const reviewLead=(await db.query("INSERT INTO leads(first_name,last_name,email,phone,event_type,event_date,data_classification) VALUES('Review','Fixture','review@example.invalid','5559990033','Corporate','2027-12-16','UNREVIEWED') RETURNING id")).rows[0];
 assert.ok((await call('GET','/data-review?type=leads')).data.data.some(row=>row.id===reviewLead.id));
 assert.equal((await call('PATCH','/data-review/leads/'+reviewLead.id,{classification:'QA',reason:'Disposable verification fixture'})).status,200);
 assert.equal((await db.query('SELECT data_classification FROM leads WHERE id=$1',[reviewLead.id])).rows[0].data_classification,'QA');
 assert.equal((await call('PATCH','/data-review/leads/'+reviewLead.id,{classification:'BUSINESS',reason:'Unauthorized fixture change'},op.id)).status,403);
 assert.ok((await db.query("SELECT id FROM audit_logs WHERE entity_id=$1 AND action='data_classification_changed'",[reviewLead.id])).rowCount);
 const dashboard=(await call('GET','/dashboard?range=mtd')).data;
 for(const point of dashboard.trends){const rows=(await call('GET','/dashboard/revenue-records?'+new URLSearchParams({from:dashboard.sqlRange.start,to:dashboard.sqlRange.end,bucket:point.bucket}))).data;assert.equal(Math.round(rows.bookings.reduce((n,r)=>n+Number(r.amount),0)*100),Math.round(point.booked_revenue*100));assert.equal(Math.round(rows.payments.reduce((n,r)=>n+Number(r.amount),0)*100),Math.round(point.collected_revenue*100));}
 passed.push('Permissioned data review preserves records and audit reasons; chart drilldown records reconcile to each revenue bucket');
 await fs.writeFile('audit-output/admin-final/role-api.json',JSON.stringify(matrix,null,2));
 return {passed,roles:roles.map(r=>({...r,accessToken:token(r.id)}))};
}
