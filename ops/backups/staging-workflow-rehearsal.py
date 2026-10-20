"""Read-only staging snapshot and isolated restore/migration rehearsal. No source writes."""
import os, pathlib, tempfile, subprocess, datetime, uuid, hashlib, json, base64, shutil
import psycopg2
os.umask(0o077)
def run(args):
 result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if result.returncode:raise RuntimeError('Staging rehearsal subprocess failed: '+pathlib.Path(args[0]).name)
 return result.stdout
def counts(conn):
 with conn.cursor() as c:
  c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  names=[r[0] for r in c.fetchall()];result={}
  from psycopg2 import sql
  for name in names:
   c.execute(sql.SQL('SELECT count(*) FROM public.{}').format(sql.Identifier(name)));result[name]=c.fetchone()[0]
  return result
def main():
 source=psycopg2.connect(os.environ['DATABASE_URL'])
 source.set_session(readonly=True,isolation_level='REPEATABLE READ')
 with source.cursor() as c:
  c.execute('SELECT system_identifier::text FROM pg_control_system()')
  assert c.fetchone()[0]=='7685003242386444353','Wrong database: staging only'
  c.execute('SELECT pg_export_snapshot()');snapshot=c.fetchone()[0]
 expected=counts(source)
 root=pathlib.Path('/backup/workflow-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(uuid.uuid4()))
 root.mkdir()
 with tempfile.TemporaryDirectory(prefix='workflow-rehearsal-') as temp:
  temp=pathlib.Path(temp);dump=temp/'staging.dump';restored=temp/'readback.dump'
  run(['pg_dump',os.environ['DATABASE_URL'],'--format=custom','--no-owner','--no-acl','--snapshot',snapshot,'-f',str(dump)])
  source.close()
  key=root/'encryption.key';key.write_bytes(os.urandom(64))
  encrypted=root/'staging.dump.enc'
  run(['openssl','enc','-aes-256-cbc','-pbkdf2','-iter','200000','-in',str(dump),'-out',str(encrypted),'-pass','file:'+str(key)])
  run(['openssl','enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-in',str(encrypted),'-out',str(restored),'-pass','file:'+str(key)])
  assert dump.read_bytes()==restored.read_bytes()
  cluster=temp/'cluster';socket=temp/'socket';cluster.mkdir();socket.mkdir()
  run(['chown','postgres:postgres',str(temp),str(cluster),str(socket)])
  run(['runuser','-u','postgres','--',shutil.which('initdb') or '/usr/lib/postgresql/18/bin/initdb','-D',str(cluster),'-A','trust','--encoding=UTF8'])
  run(['runuser','-u','postgres','--',shutil.which('pg_ctl') or '/usr/lib/postgresql/18/bin/pg_ctl','-D',str(cluster),'-l',str(temp/'restore.log'),'-o',f"-k {socket} -p 5433 -c listen_addresses=''",'-w','start'])
  try:
   run(['createdb','-h',str(socket),'-p','5433','-U','postgres','lola_staging_workflow_rehearsal'])
   url=f'postgresql://postgres@/lola_staging_workflow_rehearsal?host={socket}&port=5433'
   run(['pg_restore','--dbname',url,'--exit-on-error','--no-owner','--no-acl',str(restored)])
   target=psycopg2.connect(url)
   assert counts(target)==expected,'Restore counts differ'
   print('STAGING_BACKUP_DECRYPT_RESTORE_PASS',flush=True)
   with target.cursor() as c:
    c.execute('SELECT filename FROM schema_migrations');applied={row[0] for row in c.fetchall()}
    migrations=json.loads(base64.b64decode(os.environ['WORKFLOW_REHEARSAL_MIGRATIONS']))
    pending=[]
    for name,sql in sorted(migrations.items()):
     if name in applied:continue
     c.execute(sql);c.execute('INSERT INTO schema_migrations(filename) VALUES(%s)',[name]);pending.append(name)
    c.execute("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tasks' AND column_name='assignment_version'");assert c.fetchone()[0]==1
   target.commit();target.close()
   proof={'path':str(encrypted),'sha256':hashlib.sha256(encrypted.read_bytes()).hexdigest(),'tables':len(expected),'bytes':dump.stat().st_size,'migrationsRehearsed':pending}
   (root/'verified.json').write_text(json.dumps(proof));print('STAGING_WORKFLOW_MIGRATION_REHEARSAL_PASS',json.dumps(proof),flush=True)
  finally:
   run(['runuser','-u','postgres','--',shutil.which('pg_ctl') or '/usr/lib/postgresql/18/bin/pg_ctl','-D',str(cluster),'-m','fast','-w','stop'])

if __name__=='__main__':
 try: main()
 except Exception as error:
  print('STAGING_WORKFLOW_REHEARSAL_FAILED',type(error).__name__,getattr(error,'pgcode',None),flush=True)
  raise SystemExit(1)
