// Produces a temporary, self-contained runner for the existing API container.
// It contains approved website content, never credentials; credentials stay in Railway.
import fs from 'node:fs/promises';
const source=await fs.readFile('server/src/services/website-content-import.js','utf8');
const manifest=JSON.parse(await fs.readFile('server/import-data/live-website.json','utf8'));
const migration=await fs.readFile('server/migrations/021_website_content_import.sql','utf8');
const script=`const pg=require('pg'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const mode=process.argv[2]||'--dry-run';
 if(!['--dry-run','--migrate-only','--apply'].includes(mode))throw new Error('Unsupported mode');
 if(process.env.RAILWAY_PROJECT_ID!=='e2c4de11-8494-4f12-8112-5f1b696f9ae4')throw new Error('Wrong Railway project');
 const manifest=${JSON.stringify(manifest)};
 const {importWebsiteContent}=await import('data:text/javascript;base64,${Buffer.from(source).toString('base64')}');
 const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
 try{
  await db.connect();await db.query(mode==='--dry-run'?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL SERIALIZABLE');
  await db.query("SET LOCAL lock_timeout='5s'");
  if(mode!=='--dry-run')await db.query("SELECT pg_advisory_xact_lock(hashtext('lola-live-website-import'))");
  if(mode==='--migrate-only'){
   const done=await db.query("SELECT 1 FROM schema_migrations WHERE filename='021_website_content_import.sql'");
   if(!done.rows.length){await db.query(${JSON.stringify(migration)});await db.query("INSERT INTO schema_migrations(filename) VALUES('021_website_content_import.sql')");}
   await db.query('COMMIT');console.log(JSON.stringify({migration:'021_website_content_import.sql',action:done.rows.length?'SKIP':'APPLIED'}));return;
  }
  if((process.env.STORAGE_PROVIDER||'local')!=='local')throw new Error('Storage provider requires review');
  const root=process.env.LOCAL_STORAGE_ROOT||'/app/storage/uploads';
  const storage={get:key=>fs.readFile(path.join(root,key)),putAt:async({buffer,storageKey})=>{
   if(!/^website-import\\/[a-f0-9]{64}\\/[a-zA-Z0-9_.-]+$/.test(storageKey))throw new Error('Invalid media key');
   const target=path.join(root,storageKey);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,buffer);
  }};
  const report=await importWebsiteContent(db,manifest,{dryRun:mode==='--dry-run',storage,readAsset:async asset=>{
   const url=new URL(asset.url);if(url.origin!==manifest.source||!url.pathname.startsWith('/assets/'))throw new Error('Unapproved asset origin');
   const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Asset unavailable: '+asset.path);return Buffer.from(await r.arrayBuffer());
  }});
  await db.query(mode==='--dry-run'?'ROLLBACK':'COMMIT');
  console.log(JSON.stringify({mode,checkedAt:new Date().toISOString(),totals:report.reduce((s,x)=>(s[x.action]=(s[x.action]||0)+1,s),{}),report}));
  if(report.some(x=>x.action==='CONFLICT'))process.exitCode=2;
 }catch(e){await db.query('ROLLBACK');console.error(e.message);if(e.report)console.error(JSON.stringify(e.report));process.exitCode=1;}finally{await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});\n`;
await fs.writeFile('/private/tmp/lola-cms-remote-runner.cjs',script,{mode:0o600});
console.log('Prepared temporary remote CMS runner. No credentials included.');
