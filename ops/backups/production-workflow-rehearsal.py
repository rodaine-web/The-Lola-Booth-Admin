"""Run the existing production backup, then rehearse migrations only in its isolated restore.
No SQL writes to DATABASE_URL. Use on the existing backup helper with its exact identity guard.
"""
import os, json, base64, pathlib, runpy, shutil
backup=runpy.run_path('/tmp/daily-production-backup.py',run_name='workflow_rehearsal')
original=backup['restore_check']
run=backup['run']

def rehearse(dump,expected,root):
    original(dump,expected,root)
    cluster=str(root/'pg');socket=str(root/'socket')
    run(['runuser','-u','postgres','--',shutil.which('pg_ctl') or '/usr/lib/postgresql/18/bin/pg_ctl','-D',cluster,'-l',str(root/'migration.log'),'-o','-k '+socket+" -p 5433 -c listen_addresses=''",'-w','start'])
    try:
        url='postgresql://postgres@/lola_backup_restore?host='+socket+'&port=5433'
        conn=backup['psycopg2'].connect(url)
        try:
            with conn.cursor() as cursor:
                cursor.execute('SELECT filename FROM schema_migrations');applied={row[0] for row in cursor.fetchall()}
                pending=[]
                for name,sql in sorted(json.loads(base64.b64decode(os.environ['WORKFLOW_REHEARSAL_MIGRATIONS'])).items()):
                    if name in applied:continue
                    cursor.execute(sql);cursor.execute('INSERT INTO schema_migrations(filename) VALUES(%s)',[name]);pending.append(name)
                cursor.execute("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tasks' AND column_name='assignment_version'")
                assert cursor.fetchone()[0]==1
            conn.commit()
            print('PRODUCTION_ISOLATED_WORKFLOW_MIGRATION_REHEARSAL_PASS',json.dumps({'migrations':pending,'sourceTablesVerified':len(expected)}),flush=True)
        finally:conn.close()
    finally:
        run(['runuser','-u','postgres','--',shutil.which('pg_ctl') or '/usr/lib/postgresql/18/bin/pg_ctl','-D',cluster,'-m','fast','-w','stop'])

backup['backup'].__globals__['restore_check']=rehearse
try:backup['backup']()
except Exception as error:
    print('PRODUCTION_WORKFLOW_REHEARSAL_FAILED',type(error).__name__,getattr(error,'pgcode',None),flush=True)
    raise SystemExit(1)
