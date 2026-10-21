"""Private Azure PostgreSQL backups. Never migrate or mutate the source database."""
import os, json, base64, hashlib, pathlib, tempfile, subprocess, datetime, uuid, re, shutil
import urllib.request, urllib.parse, urllib.error, xml.etree.ElementTree as ET
import time, socket, ssl, http.client
import psycopg2
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

os.umask(0o077)
PREFIX = 'production/postgresql/daily/'
CONTAINER = os.environ['AZURE_DOCUMENTS_CONTAINER']
assert re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',CONTAINER) and not CONTAINER.endswith('-staging')
NOW = datetime.datetime.now(datetime.timezone.utc)
TRANSFER_BLOCK_BYTES = 4 * 1024 * 1024
TRANSFER_ATTEMPTS = 4

def transfer_retry(operation, action):
    for attempt in range(1, TRANSFER_ATTEMPTS + 1):
        try:
            return action()
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as error:
            status = error.code if isinstance(error, urllib.error.HTTPError) else None
            reason = getattr(error, 'reason', error)
            category = ('HTTP' if status else 'TIMEOUT' if isinstance(reason, TimeoutError)
                else 'DNS' if isinstance(reason, socket.gaierror)
                else 'TLS' if isinstance(reason, ssl.SSLError) else 'CONNECTION')
            retryable = status in (408, 429, 500, 502, 503, 504) if status else category != 'TLS'
            headers = getattr(error, 'headers', {}) or {}
            code = headers.get('x-ms-error-code', '')
            request_id = headers.get('x-ms-request-id', '')
            if isinstance(error, urllib.error.HTTPError):
                error.close()
            # Never log provider bodies, URLs, authorization headers or exception messages.
            print('BACKUP_TRANSFER_DIAGNOSTIC', json.dumps({'operation':operation,'attempt':attempt,
                'category':category,'status':status,
                'azureCode':code if re.fullmatch(r'[A-Za-z0-9_]{1,80}', code) else '',
                'requestId':request_id if re.fullmatch(r'[A-Fa-f0-9-]{1,80}', request_id) else '',
                'retrying':retryable and attempt < TRANSFER_ATTEMPTS}), flush=True)
            if not retryable or attempt == TRANSFER_ATTEMPTS:
                raise
            time.sleep(min(2 ** attempt, 8))

def run(args, **kwargs):
    # Never echo source URLs, provider error bodies, or credentials.
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        diagnostic=result.stderr.decode(errors='replace').lower()
        category=next((word for word in ['permission denied','directory exists','root','server version','could not connect','no such file','could not access','invalid'] if word in diagnostic),'unclassified')
        print('BACKUP_SUBPROCESS_FAILURE',pathlib.Path(args[0]).name,category,flush=True)
        raise RuntimeError('Backup subprocess failed')
    return result.stdout

def oauth(scope, prefix):
    body = urllib.parse.urlencode({'grant_type':'client_credentials', 'client_id':os.environ[prefix+'CLIENT_ID'],
        'client_secret':os.environ[prefix+'CLIENT_SECRET'], 'scope':scope}).encode()
    url = 'https://login.microsoftonline.com/'+os.environ[prefix+'TENANT_ID']+'/oauth2/v2.0/token'
    with urllib.request.urlopen(urllib.request.Request(url,data=body),timeout=45) as response:
        return json.load(response)['access_token']

def alert(subject, text):
    token = oauth('https://graph.microsoft.com/.default', 'MICROSOFT_')
    sender = os.environ['MICROSOFT_SENDER_EMAIL']
    recipient = os.environ.get('BACKUP_ALERT_EMAIL','info@thelolabooth.com')
    assert recipient == 'info@thelolabooth.com'
    message = {'message':{'subject':subject, 'body':{'contentType':'Text','content':text},
        'toRecipients':[{'emailAddress':{'address':recipient}}]},'saveToSentItems':True}
    url = 'https://graph.microsoft.com/v1.0/users/'+urllib.parse.quote(sender,safe='')+'/sendMail'
    with urllib.request.urlopen(urllib.request.Request(url,data=json.dumps(message).encode(),
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}),timeout=45) as response:
        assert response.status == 202

class Azure:
    def __init__(self):
        endpoint = os.environ['AZURE_STORAGE_ACCOUNT_URL'].rstrip('/')
        assert re.fullmatch(r'https://[a-z0-9]{3,24}\.blob\.core\.windows\.net',endpoint)
        self.url = endpoint+'/'+CONTAINER
        self.headers = {'Authorization':'Bearer '+oauth('https://storage.azure.com/.default','AZURE_STORAGE_'),
            'x-ms-version':'2023-11-03'}
    def request(self, suffix='', method='GET', data=None, headers=None):
        req = urllib.request.Request(self.url+suffix,method=method,data=data,headers={**self.headers,**(headers or {})})
        # Conditional retention deletes keep their existing fail-closed behavior.
        if method not in ('GET','HEAD','PUT'):
            return urllib.request.urlopen(req,timeout=120)
        operation = 'UPLOAD_BLOCK' if 'comp=block&' in suffix else 'COMMIT_BLOCKS' if 'comp=blocklist' in suffix else method
        return transfer_retry(operation, lambda: urllib.request.urlopen(req,timeout=120))
    def prepare(self):
        with self.request('?restype=container') as response:
            assert not response.headers.get('x-ms-blob-public-access'), 'Backup container must be private'
    def put(self, name, data):
        assert name.startswith(PREFIX)
        suffix = '/'+name
        headers = {'If-None-Match':'*'}
        body = data
        if len(data) > TRANSFER_BLOCK_BYTES:
            blocks = []
            for index, offset in enumerate(range(0, len(data), TRANSFER_BLOCK_BYTES)):
                block = data[offset:offset + TRANSFER_BLOCK_BYTES]
                block_id = base64.b64encode(f'{index:08d}'.encode()).decode()
                query = urllib.parse.urlencode({'comp':'block','blockid':block_id})
                with self.request('/'+name+'?'+query,'PUT',block,
                        {'Content-MD5':base64.b64encode(hashlib.md5(block).digest()).decode()}) as response:
                    assert response.status == 201
                blocks.append(block_id)
                print('BACKUP_UPLOAD_BLOCK_PASS', index + 1, flush=True)
            body = ('<?xml version="1.0" encoding="utf-8"?><BlockList>' +
                ''.join('<Latest>'+value+'</Latest>' for value in blocks) + '</BlockList>').encode()
            suffix += '?comp=blocklist'
            headers['Content-Type'] = 'application/xml'
        else:
            headers['x-ms-blob-type'] = 'BlockBlob'
        try:
            with self.request(suffix,'PUT',body,headers) as response:
                assert response.status == 201
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as error:
            # A lost success response can yield 412 on retry. Reconcile exact bytes;
            # never overwrite another object or assume an uncertain PUT succeeded.
            if isinstance(error, urllib.error.HTTPError) and error.code != 412:
                raise
            try:
                recovered = self.get(name)
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead):
                raise error
            assert recovered == data, 'Existing backup object differs; overwrite refused'
            print('BACKUP_UPLOAD_RECONCILED', flush=True)
    def get(self, name):
        def read():
            req=urllib.request.Request(self.url+'/'+name,headers=self.headers)
            with urllib.request.urlopen(req,timeout=120) as response: return response.read()
        return transfer_retry('READBACK',read)
    def private(self,name):
        try:
            with urllib.request.urlopen(self.url+'/'+name,timeout=45):
                raise AssertionError('Anonymous backup access must fail')
        except urllib.error.HTTPError as error:
            code=error.headers.get('x-ms-error-code','')
            if not code:
                try: code=ET.fromstring(error.read()).findtext('Code','')
                except ET.ParseError: pass
            print('BACKUP_ANONYMOUS_STATUS',error.code,code,flush=True)
            assert (error.code,code) in [(409,'PublicAccessNotPermitted'),(403,'AuthorizationFailure'),
                (404,'ResourceNotFound'),(401,'NoAuthenticationInformation')], 'Unexpected anonymous response'
    def retention(self):
        # Delete only this job's complete, named backup triplets, after a new verified upload.
        marker=''; groups={}
        while True:
            query=urllib.parse.urlencode({'restype':'container','comp':'list','prefix':PREFIX,'marker':marker})
            with self.request('?'+query) as response: tree=ET.fromstring(response.read())
            for blob in tree.findall('./Blobs/Blob'):
                name=blob.findtext('Name','')
                match=re.fullmatch(re.escape(PREFIX)+r'(\d{8}T\d{6}Z-[0-9a-f-]{36})\.(dump\.gcm|key\.rsa|manifest\.json)',name)
                if match:
                    groups.setdefault(match[1],[]).append((name,blob.findtext('Properties/Etag')))
            marker=tree.findtext('NextMarker') or ''
            if not marker: break
        expired=0
        for stem,items in groups.items():
            created=datetime.datetime.strptime(stem[:16],'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
            if NOW-created > datetime.timedelta(days=30) and len(items)==3:
                for name,etag in items:
                    with self.request('/'+name,'DELETE',headers={'If-Match':etag}) as response: assert response.status==202
                expired+=1
        return expired

def counts(conn):
    with conn.cursor() as cursor:
        cursor.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        tables=[row[0] for row in cursor.fetchall()]
        result={}
        for table in tables:
            assert re.fullmatch(r'[a-zA-Z0-9_]+',table)
            cursor.execute('SELECT count(*) FROM public."'+table+'"')
            result[table]=cursor.fetchone()[0]
        return result

def restore_check(dump, expected, root):
    # Disposable local-only cluster; never connects pg_restore to DATABASE_URL.
    root.mkdir(exist_ok=True)
    cluster=str(root/'pg'); socket=str(root/'socket'); pathlib.Path(socket).mkdir()
    run(['chown','postgres:postgres',str(root),socket])
    run(['runuser','-u','postgres','--',shutil.which('initdb') or '/usr/lib/postgresql/18/bin/initdb','-D',cluster,'-A','trust','--encoding=UTF8'])
    run(['runuser','-u','postgres','--',shutil.which('pg_ctl') or '/usr/lib/postgresql/18/bin/pg_ctl','-D',cluster,'-l',str(root/'postgres.log'),'-o','-k '+socket+" -p 5433 -c listen_addresses=''",'-w','start'])
    try:
        run(['createdb','-h',socket,'-p','5433','-U','postgres','lola_backup_restore'])
        url='postgresql://postgres@/lola_backup_restore?host='+socket+'&port=5433'
        run(['pg_restore','--dbname',url,'--exit-on-error','--no-owner','--no-acl',str(dump)])
        conn=psycopg2.connect(url)
        try: assert counts(conn)==expected, 'Restored row counts differ'
        finally: conn.close()
    finally: run(['runuser','-u','postgres','--',shutil.which('pg_ctl') or '/usr/lib/postgresql/18/bin/pg_ctl','-D',cluster,'-m','fast','-w','stop'])

def backup():
    assert os.environ['BACKUP_TARGET_ENV']=='production' and os.environ['AZURE_STORAGE_ENV']=='production'
    expected_id=os.environ['EXPECTED_DATABASE_SYSTEM_ID']
    assert expected_id and expected_id!='7685003242386444353'
    public=serialization.load_pem_public_key(base64.b64decode(os.environ['BACKUP_PUBLIC_KEY_B64']))
    assert public.key_size>=3072
    azure=Azure(); print('BACKUP_STAGE_PRIVATE_CONTAINER',flush=True); azure.prepare()
    with tempfile.TemporaryDirectory(prefix='lola-backup-',dir='/backup') as temp:
        root=pathlib.Path(temp); dump=root/'production.dump'
        conn=psycopg2.connect(os.environ['DATABASE_URL'])
        try:
            conn.set_session(readonly=True,isolation_level='REPEATABLE READ')
            with conn.cursor() as cursor:
                cursor.execute('SELECT system_identifier::text FROM pg_control_system()')
                assert cursor.fetchone()[0]==expected_id, 'Wrong source database'
                cursor.execute('SELECT pg_export_snapshot()'); snapshot=cursor.fetchone()[0]
            expected=counts(conn)
            run(['pg_dump','--dbname',os.environ['DATABASE_URL'],'--format=custom','--no-owner','--no-acl',
                '--snapshot',snapshot,'--file',str(dump)])
        finally: conn.close()
        assert dump.stat().st_size < 512*1024*1024, 'Review capacity above 512MiB'
        print('BACKUP_STAGE_LOCAL_RESTORE',flush=True)
        restore_check(dump,expected,root)
        print('BACKUP_STAGE_LOCAL_RESTORE_PASS',flush=True)
        data=dump.read_bytes(); key=os.urandom(32); nonce=os.urandom(12)
        stem=PREFIX+NOW.strftime('%Y%m%dT%H%M%SZ')+'-'+str(uuid.uuid4())
        encryptor=Cipher(algorithms.AES(key),modes.GCM(nonce)).encryptor()
        encryptor.authenticate_additional_data(stem.encode())
        ciphertext=encryptor.update(data)+encryptor.finalize()
        wrapped=public.encrypt(key,padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
        manifest={'format':'lola-postgresql-aes256gcm-rsaoaep-sha256-v1','createdAt':NOW.isoformat(),
            'sourceSystemId':expected_id,'aad':stem,'nonce':base64.b64encode(nonce).decode(),
            'tag':base64.b64encode(encryptor.tag).decode(),'plaintextSha256':hashlib.sha256(data).hexdigest(),
            'ciphertextSha256':hashlib.sha256(ciphertext).hexdigest(),'bytes':len(data),
            'tableCounts':expected,'publicKeySha256':hashlib.sha256(base64.b64decode(os.environ['BACKUP_PUBLIC_KEY_B64'])).hexdigest()}
        print('BACKUP_STAGE_UPLOAD',flush=True)
        azure.put(stem+'.dump.gcm',ciphertext); azure.put(stem+'.key.rsa',wrapped)
        azure.put(stem+'.manifest.json',json.dumps(manifest,sort_keys=True).encode())
        recovered=azure.get(stem+'.dump.gcm'); assert recovered==ciphertext
        assert azure.get(stem+'.key.rsa')==wrapped
        assert json.loads(azure.get(stem+'.manifest.json'))==manifest
        print('BACKUP_STAGE_UPLOAD_READBACK_PASS',flush=True)
        azure.private(stem+'.dump.gcm')
        print('BACKUP_STAGE_ANONYMOUS_DENIED',flush=True)
        private_b64=os.environ.get('BACKUP_VERIFY_PRIVATE_KEY_B64','')
        if private_b64:
            private=serialization.load_pem_private_key(base64.b64decode(private_b64),password=None)
            recovered_key=private.decrypt(azure.get(stem+'.key.rsa'),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
            decryptor=Cipher(algorithms.AES(recovered_key),modes.GCM(nonce,encryptor.tag)).decryptor()
            decryptor.authenticate_additional_data(stem.encode())
            plaintext=decryptor.update(recovered)+decryptor.finalize()
            assert plaintext==data
            dump.write_bytes(plaintext)
            restore_check(dump,expected,root/'azure-restore')
            print('AZURE_DOWNLOADED_DECRYPTED_DATABASE_RESTORE_PASS',flush=True)
        expired=azure.retention()
        pathlib.Path('/backup/daily-last-success.json').write_text(json.dumps({'createdAt':NOW.isoformat(),'blob':stem,'bytes':len(data)}))
        print('DAILY_PRIVATE_AZURE_ENCRYPTED_POSTGRESQL_BACKUP_PASS',json.dumps({'blob':stem,'bytes':len(data),'tables':len(expected),'expiredBackupsRemoved':expired}),flush=True)
        if private_b64:
            alert('LOLA daily backup qualification passed','Daily encrypted PostgreSQL backup was uploaded to private Azure storage, downloaded, decrypted and restored successfully. The daily schedule runs at 08:00 UTC with 30-day retention. This is an operational test notification; no customer booking was changed.')
            print('BACKUP_ALERT_PROVIDER_ACCEPTED',flush=True)

if __name__=='__main__':
    try: backup()
    except Exception as error:
        print('DAILY_PRODUCTION_BACKUP_FAILED',type(error).__name__,str(error) if isinstance(error,AssertionError) else '',getattr(error,'code',''),getattr(error,'headers',{}).get('x-ms-error-code',''),flush=True)
        try:
            failure_stamp=pathlib.Path('/backup/daily-failure-alert-'+NOW.strftime('%Y%m%d'))
            if failure_stamp.exists(): raise RuntimeError('Failure alert already sent today')
            alert('LOLA production database backup FAILED','The daily production database backup did not complete. Existing backups were preserved. Please inspect the phase1-production-backup-verification Railway service before relying on today’s recovery copy.')
            failure_stamp.write_text('Provider accepted operational alert')
            print('BACKUP_FAILURE_ALERT_PROVIDER_ACCEPTED',flush=True)
        except Exception: print('BACKUP_FAILURE_ALERT_FAILED_OPERATOR_REVIEW_REQUIRED',flush=True)
        raise SystemExit(1)
