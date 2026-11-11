import fs from 'node:fs';
import {pool,query,transaction} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {currentPricingCatalog} from '../services/pricing-catalog-service.js';
import {saveStagingRecord} from '../services/staging-cms-service.js';
import {writeAudit} from '../middleware/audit.js';
import {redesignGuestScenes} from '../../../shared/redesign-content.js';

const action='production-home-owner-refinements-2026-11-10';
const rehearse=process.argv.includes('--rehearse');
const apply=process.argv.includes('--apply') || rehearse;
const expectedVersion=process.argv.find(arg=>arg.startsWith('--expected-version='))?.split('=')[1];

const history=async()=>Object.fromEntries(await Promise.all(['proposal_versions','invoices'].map(async table=>{
  const result=await query('SELECT count(*)::int count,md5(string_agg(to_jsonb(t)::text,\'|\' ORDER BY id)) digest FROM '+table+' t');
  return [table,result.rows[0]];
})));

try {
  if(process.env.APP_ENV!=='production')throw Error('Production environment required');
  if(!expectedVersion)throw Error('Explicit reviewed production pricing version required');
  let result;
  try {
    result=await transaction(async client=>{
      await assertDatabaseIdentity(client);
      await query('SELECT pg_advisory_xact_lock(7811051)');
      if((await query('SELECT 1 FROM audit_logs WHERE action=$1',[action])).rowCount)return {alreadyApplied:true};
      const catalog=await currentPricingCatalog();
      if(catalog.id!==expectedVersion)throw Error('Production pricing version changed: stop and review');
      const owner=(await query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.active=true AND r.name='OWNER' ORDER BY u.created_at LIMIT 1")).rows[0];
      if(!owner)throw Error('Active production Owner required');
      const rows=(await query("SELECT * FROM website_channel_records WHERE channel='STAGING' AND status='PUBLISHED' AND (entity_key IN ('redesign.home.hero.title','redesign.hero.home.glam') OR cms_type='experiences')")).rows;
      const findUnique=(name,filter)=>{
        const matches=rows.filter(filter);
        if(matches.length!==1)throw Error('Expected exactly one published '+name+' CMS record, found '+matches.length);
        return matches[0];
      };
      const title=findUnique('home headline',r=>r.entity_key==='redesign.home.hero.title'&&r.cms_type==='pageItems');
      const hero=findUnique('Glam hero',r=>r.entity_key==='redesign.hero.home.glam'&&r.cms_type==='hero');
      const experience=findUnique('360 experience',r=>r.cms_type==='experiences'&&String(r.payload.slug||'').includes('360'));
      const glam=redesignGuestScenes.find(s=>s.key==='glam');
      if(!glam||glam.image!=='/staging-site/assets/owner-updated-glam-hero.png')throw Error('Approved Glam asset mismatch');
      const assetPath=new URL('../../../public/staging-site/assets/owner-updated-glam-hero.png',import.meta.url);
      if(!fs.existsSync(assetPath))throw Error('Approved Glam asset not deployed');
      const updates=[
        [title,{...title.payload,html:'Good People.<br>Better Photos.'}],
        [hero,{...hero.payload,image:glam.image,image_crop:glam.image_crop}],
        [experience,{...experience.payload,website_card_image:'/staging-site/assets/owner-360-guests-event.jpg',website_card_crop:null}]
      ];
      const before=await history();
      const names=updates.map(([row])=>row.entity_key);
      if(!apply)return {dryRun:true,records:3,keys:names,version:catalog.id,historicalCounts:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.count]))};
      const user={...owner,permissions:['*']};
      for(const [row,payload] of updates)await saveStagingRecord(row.cms_type,{entity_key:row.entity_key,payload,status:row.status,display_order:row.display_order},user,row.id);
      const after=await history();
      if(JSON.stringify(after)!==JSON.stringify(before))throw Error('Historical proposals or invoices changed: rollback');
      const summary={updated:3,keys:names,version:catalog.id,historicalCounts:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.count])),historicalDocumentsUnchanged:true};
      await writeAudit({req:{user,headers:{'user-agent':'Owner approved scoped homepage production update'}},action,entity:'website_release',entityId:catalog.id,before:{keys:names},after:summary});
      if(rehearse){const error=Error('Production rehearsal rollback');error.rehearsalResult=summary;throw error;}
      return summary;
    });
  }catch(error){
    if(!error.rehearsalResult)throw error;
    result={rehearsal:true,rolledBack:true,...error.rehearsalResult};
  }
  console.log(JSON.stringify(result));
}finally{await pool.end();}
