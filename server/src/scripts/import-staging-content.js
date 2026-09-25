import fs from 'node:fs/promises';
import {pool,transaction} from '../db/pool.js';
import {validateStagingRecord} from '../services/staging-cms-service.js';
const file=process.argv[2]||'server/import-data/staging-website.json';
const apply=process.argv.includes('--apply');
const manifest=JSON.parse(await fs.readFile(file,'utf8'));
if(manifest.channel!=='STAGING')throw Error('Only a STAGING manifest is accepted.');
const seen=new Set();
for(const row of manifest.records){validateStagingRecord(row.cms_type,row);const key=row.cms_type+':'+row.entity_key;if(seen.has(key))throw Error('Duplicate record '+key);seen.add(key);}
try{
 if(!apply){console.log(JSON.stringify({mode:'validation-only',records:seen.size}));}
 else {
  if(process.env.APP_ENV!=='staging'&&process.env.APP_ENV!=='test')throw Error('Import requires APP_ENV=staging or test.');
  const result=await transaction(async client=>{
   let created=0,existing=0;
   for(const row of manifest.records){const value=validateStagingRecord(row.cms_type,row);const r=await client.query("INSERT INTO website_channel_records(channel,cms_type,entity_key,payload,status,display_order,source_url) VALUES('STAGING',$1,$2,$3,$4,$5,$6) ON CONFLICT(channel,cms_type,entity_key) DO NOTHING RETURNING id",[row.cms_type,value.entity_key,JSON.stringify(value.payload),value.status,value.display_order,row.source_url]);r.rowCount?created++:existing++;}
   return {created,existing,updated:0};
  });console.log(JSON.stringify(result));
 }
}finally{await pool.end();}
