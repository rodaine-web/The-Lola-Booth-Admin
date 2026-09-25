import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pool,query} from '../db/pool.js';
import {saveStagingRecord,stagingSitePayload} from '../services/staging-cms-service.js';
import {publicSitePayload} from '../services/website-cms-service.js';
// This destructive fixture setup is deliberately limited to the named local QA database.
const url=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/lola_goal2_qualification')throw Error('Use the isolated local Goal 2 database.');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const projections={pageItems:'pageItems',hero:'heroSlides',experiences:'experiences',packages:'packages',eventTypes:'eventTypes',gallery:'gallery',testimonials:'testimonials',faqs:'faqs',media:'media'};
const evidence=[];
try{
 const user=(await query("INSERT INTO users(name,email,password_hash,active) VALUES('Goal 2 local QA','goal2-local@example.invalid','disabled',false) ON CONFLICT(email) DO UPDATE SET active=false RETURNING id")).rows[0];user.permissions=['*'];
 await query("INSERT INTO website_channel_records(channel,cms_type,entity_key,payload,status) VALUES('STAGING','gallery','local-qa-gallery',$1,'PUBLISHED') ON CONFLICT(channel,cms_type,entity_key) DO NOTHING",[JSON.stringify({title:'Local QA fixture',image:'/staging-site/assets/glam.jpg'})]);
 const baseline=digest(await publicSitePayload());
 const rows=(await query("SELECT DISTINCT ON(cms_type) * FROM website_channel_records WHERE channel='STAGING' ORDER BY cms_type,display_order,entity_key")).rows;
 for(const row of rows){
  const lookup=site=>row.cms_type==='settings'?site.settings[row.entity_key]:row.cms_type==='content'?site.content[row.entity_key]:site[projections[row.cms_type]].find(r=>r.id===row.id);
  const original=structuredClone(row);let restored=false;
  try{
   const changed={...row,payload:{...row.payload,qualification_marker:'QA edited',...(row.cms_type==='settings'?{value:'QA edited'}:{})},display_order:-999};
   await saveStagingRecord(row.cms_type,changed,user,row.id);let projected=lookup(await stagingSitePayload());assert.ok(projected);assert.equal(row.cms_type==='settings'?projected:projected.qualification_marker,'QA edited');if(typeof projected==='object')assert.equal(projected.display_order,-999);
   assert.equal(digest(await publicSitePayload()),baseline);
   if(['hero','experiences','eventTypes','gallery','media'].includes(row.cms_type)){
    changed.payload[row.cms_type==='media'?'url':'image']='/staging-site/assets/vogue.jpg';await saveStagingRecord(row.cms_type,changed,user,row.id);projected=lookup(await stagingSitePayload());assert.equal(projected[row.cms_type==='media'?'url':'image'],'/staging-site/assets/vogue.jpg');assert.equal(digest(await publicSitePayload()),baseline);
   }
   await saveStagingRecord(row.cms_type,{...changed,status:'DRAFT'},user,row.id);
   for(let refresh=0;refresh<2;refresh++)assert.equal(lookup(await stagingSitePayload()),undefined);
   assert.equal(digest(await publicSitePayload()),baseline);
   await saveStagingRecord(row.cms_type,original,user,row.id);restored=true;assert.ok(lookup(await stagingSitePayload()));
   assert.equal(digest(await publicSitePayload()),baseline);
   evidence.push({type:row.cms_type,id:row.id,edit:'PASS',order:'PASS',unpublish:'PASS',reload:'PASS',republish:'PASS',publicProjectionUnchanged:'PASS',visualBrowserUat:'PENDING'});
  }finally{if(!restored)await saveStagingRecord(row.cms_type,original,user,row.id);}
 }
 console.log(JSON.stringify(evidence,null,2));await fs.writeFile('audit-output/goal2/local-cms-lifecycle.json',JSON.stringify(evidence,null,2));
}finally{await pool.end();}
