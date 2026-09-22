import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { getStorageProvider } from '../services/storage-service.js';
import { importWebsiteContent } from '../services/website-content-import.js';
const args=process.argv.slice(2);
if(args.some(x=>!['--dry-run'].includes(x)))throw new Error('Supported option: --dry-run');
const dryRun=args.includes('--dry-run');
const manifest=JSON.parse(await fs.readFile(fileURLToPath(new URL('../../import-data/live-website.json',import.meta.url)),'utf8'));
let client;
try {
  client=await pool.connect();
  await client.query(dryRun?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL SERIALIZABLE');
  if(!dryRun)await client.query("SELECT pg_advisory_xact_lock(hashtext('lola-live-website-import'))");
  const report=await importWebsiteContent(client,manifest,{dryRun,storage:getStorageProvider(),readAsset:async asset=>{
    const url=new URL(asset.url);
    if(url.origin!==manifest.source || !url.pathname.startsWith('/assets/'))throw new Error('Asset URL outside approved website.');
    const response=await fetch(url,{redirect:'error'});
    if(!response.ok)throw new Error(`Asset unavailable: ${asset.path}`);
    return Buffer.from(await response.arrayBuffer());
  }});
  await client.query(dryRun?'ROLLBACK':'COMMIT');
  for(const item of report)console.log(`${item.action} ${item.area}: ${item.key}${item.reason?' — '+item.reason:''}`);
  console.log(JSON.stringify({dryRun,totals:report.reduce((s,x)=>(s[x.action]=(s[x.action]||0)+1,s),{})},null,2));
  if(report.some(x=>x.action==='CONFLICT'))process.exitCode=2;
} catch(error) {
  if(client)await client.query('ROLLBACK');
  console.error(error.message);
  if(error.report)console.error(JSON.stringify(error.report,null,2));
  process.exitCode=1;
} finally {client?.release();await pool.end();}
