// Staging read-only snapshot, encrypted local recovery copy, isolated local restore.
// Credentials stay in process memory/environment; never print CLI variable output.
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createReadStream,createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(process.cwd()+'/package.json'),{Pool}=require('pg');
const project='e2c4de11-8494-4f12-8112-5f1b696f9ae4',environment='df5a961b-5e13-4102-a9b0-97244773b857';
function variables(service){return JSON.parse(execFileSync('railway',['variable','list','-p',project,'-e',environment,'-s',service,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
function run(command,args,env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{env:{...process.env,...env},stdio:['ignore','ignore','pipe']});child.stderr.resume();child.on('error',()=>reject(Error(command+' unavailable')));child.on('exit',code=>code===0?resolve():reject(Error(command+' failed with status '+code)));});}
let source,target,local,temp,restoreDb,step="CONFIGURATION";
try{
 const api=variables('48ec36e9-924b-4dc6-a8d9-1e3fb2bf3b36');
 if(api.APP_ENV!=='staging'||!api.EXPECTED_DATABASE_SYSTEM_ID||!/^(sk|rk)_test_/.test(api.STRIPE_SECRET_KEY||''))throw Error('Staging identity/payment preflight failed');
 const sshArgs=['ssh','-p',project,'-e',environment,'-s','68289f07-f2b2-4ea5-9637-2acc2dca16d9'];
 function remote(command){return execFileSync('railway',[...sshArgs,...command],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:256*1024*1024});}
 const sql=statement=>remote(['psql','-X','--no-password','-At','-c',statement]).trim();
 step="SOURCE_IDENTITY";
 const identity=sql('SELECT system_identifier::text FROM pg_control_system()');
 if(identity!==api.EXPECTED_DATABASE_SYSTEM_ID)throw Error('Staging database identity mismatch');
 const tables=JSON.parse(sql("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"));
 if(tables.some(table=>!(/^[a-z0-9_]+$/).test(table)))throw Error('Unexpected table identifier');
 const countSql="SELECT json_object_agg(name,n) FROM ("+tables.map(table=>"SELECT '"+table+"'::text name,count(*)::text n FROM public.\""+table+"\"").join(' UNION ALL ')+") counts";
 const counts=JSON.parse(sql(countSql));
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'lola-pricing-rehearsal-'));await fs.chmod(temp,0o700);
 const dump=path.join(temp,'staging.dump');
 step="SNAPSHOT_DUMP";
 const encoded=remote(['sh','-c','pg_dump --format=custom --no-owner --no-acl | base64']);
 const dumped=Buffer.from(encoded.replace(/\s/g,''),'base64');
 if(dumped.subarray(0,5).toString()!=='PGDMP')throw Error('Remote snapshot was not a valid PostgreSQL archive');
 await fs.writeFile(dump,dumped,{mode:0o600});
 const after=JSON.parse(sql(countSql));
 if(JSON.stringify(counts)!==JSON.stringify(after))throw Error('Staging changed during snapshot; repeat rehearsal');
 step="ENCRYPTION_READBACK";const backupRoot=path.join('/Users/wande/Documents/ChatGPT/LOLA BOOTHS','.private-pricing-backups',new Date().toISOString().replaceAll(':','-'));await fs.mkdir(backupRoot,{recursive:true,mode:0o700});
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),encrypted=path.join(backupRoot,'staging.dump.enc');
 await pipeline(createReadStream(dump),cipher,createWriteStream(encrypted,{mode:0o600}));
 await fs.writeFile(path.join(backupRoot,'recovery-key.json'),JSON.stringify({key:key.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')}),{mode:0o600});
 const readback=path.join(temp,'readback.dump'),decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(cipher.getAuthTag());await pipeline(createReadStream(encrypted),decipher,createWriteStream(readback,{mode:0o600}));
 const digest=async file=>{const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
 if(await digest(dump)!==await digest(readback))throw Error('Backup decryption readback differs');
 step="LOCAL_RESTORE";local=new Pool({connectionString:'postgres://postgres@127.0.0.1:55441/postgres'});restoreDb='lola_pricing_restore_'+crypto.randomBytes(5).toString('hex');await local.query('CREATE DATABASE '+restoreDb);
 const restoreUrl='postgres://postgres@127.0.0.1:55441/'+restoreDb;
 await run('pg_restore',['--exit-on-error','--no-owner','--no-acl','--dbname',restoreUrl,readback]);target=new Pool({connectionString:restoreUrl});
 for(const table of tables){const actual=(await target.query('SELECT count(*)::text n FROM public."'+table.replaceAll('"','""')+'"')).rows[0].n;if(actual!==counts[table])throw Error('Restore row counts differ');}
 step="MIGRATION_REHEARSAL";const rehearsal=await target.connect();await rehearsal.query('BEGIN');await rehearsal.query(await fs.readFile('server/migrations/072_versioned_pricing_catalog.sql','utf8'));for(const table of tables){const actual=(await rehearsal.query('SELECT count(*)::text n FROM public."'+table.replaceAll('"','""')+'"')).rows[0].n;if(actual!==counts[table])throw Error('Migration changed existing row counts');}await rehearsal.query('ROLLBACK');rehearsal.release();
 const proof={stagingIdentityVerified:true,stripeMode:'TEST',tablesVerified:tables.length,encryptedBytes:(await fs.stat(encrypted)).size,encryptedSha256:await digest(encrypted),decryptReadbackVerified:true,isolatedRestoreVerified:true,migrationRehearsed:'072_versioned_pricing_catalog.sql',existingRowCountsUnchanged:true,backupPath:encrypted,checkedAt:new Date().toISOString()};
 await fs.writeFile(path.join(backupRoot,'verified.json'),JSON.stringify(proof,null,2),{mode:0o600});console.log(JSON.stringify(proof));
}catch(error){console.error(JSON.stringify({status:'REHEARSAL_FAILED',step,errorType:error.name,code:error.code||null}));process.exitCode=1;}
finally{await source?.end();await target?.end();if(restoreDb)await local?.query('DROP DATABASE '+restoreDb);await local?.end();if(temp)await fs.rm(temp,{recursive:true,force:true});}
