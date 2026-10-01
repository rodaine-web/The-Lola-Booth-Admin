from pathlib import Path
import urllib.request,hashlib,shutil,json,re,argparse
parser=argparse.ArgumentParser(description="Prepare approved live website candidate; never deploys.")
for arg in ["baseline-dir","admin-dir","output-dir","evidence-dir"]:parser.add_argument("--"+arg,required=True)
args=parser.parse_args()
source=Path(args.baseline_dir)
root=Path(args.output_dir);root.mkdir(parents=True,exist_ok=True)
for folder in ['assets','api','lib']:
 if (source/folder).exists():shutil.copytree(source/folder,root/folder,dirs_exist_ok=True)
for p in source.iterdir():
 if p.is_file() and (p.suffix in ['.html','.js','.css','.png','.ico'] or p.name in ['robots.txt','sitemap.xml','package.json','package-lock.json']):shutil.copy2(p,root/p.name)
manifest=[]
for p in sorted(root.glob('*.html')):
 if p.name=='404.html':
  p.write_text(re.sub(r'<script\b[^>]*>.*?</script>',lambda m:'' if re.search(r'googletagmanager\.com|\bgtag\s*\(|\bfbq\s*\(|\bttq\.',m.group(),re.I) else m.group(),p.read_text(),flags=re.S|re.I));continue
 with urllib.request.urlopen('https://thelolabooth.com/'+p.name,timeout=20) as r:
  if r.status!=200:raise RuntimeError('Baseline unavailable '+p.name)
  data=r.read()
 original=data
 text=data.decode()
 text=re.sub(r'<script\b[^>]*>.*?</script>',lambda m:'' if re.search(r'googletagmanager\.com|\bgtag\s*\(|\bfbq\s*\(|\bttq\.',m.group(),re.I) else m.group(),text,flags=re.S|re.I)
 data=text.encode();p.write_bytes(data)
 digest=hashlib.sha256(data).hexdigest();manifest.append({'page':'/' if p.name=='index.html' else '/'+p.stem,'baselineHash':hashlib.sha256(original).hexdigest(),'candidateHash':digest,'expectedDifference':'analytics bootstrap removed; layout unchanged' if original!=data else 'none'})
config=json.loads((source/'vercel.json').read_text())
config['rewrites']=[{'source':'/'+route,'destination':'/customer-documents/index.html'} for route in ['proposal/:token','invoice/:token','pay','pay/:token','receipt/:token/:id']]
config['headers'].append({'source':'/(proposal|invoice|pay|receipt)/:path*','headers':[{'key':'Cache-Control','value':'no-store'},{'key':'Referrer-Policy','value':'no-referrer'},{'key':'X-Robots-Tag','value':'noindex, nofollow'}]})
for section in config['headers']:
 for header in section['headers']:
  if header['key']=='Content-Security-Policy':header['value']=header['value'].replace("style-src 'self'","style-src 'self' https://fonts.googleapis.com").replace("font-src 'self'","font-src 'self' https://fonts.gstatic.com");header['value']+='; worker-src \'self\' blob:; frame-src \'self\' blob: https://api.thelolabooth.com'
config.update(framework=None,buildCommand='',installCommand='',outputDirectory='.')
(root/'vercel.json').write_text(json.dumps(config,indent=2))
admin=Path(args.admin_dir);docs=root/'customer-documents';docs.mkdir(exist_ok=True)
for name in ['index.html','build-info.json']:shutil.copy2(admin/name,docs/name)
for name in ['assets','brand']:shutil.copytree(admin/name,docs/name,dirs_exist_ok=True)
for p in root.rglob('*'):
 if p.is_file() and p.suffix in ['.html','.js','.css','.json']:
  text=p.read_text(errors='replace')
  if any(x in text for x in ['stagingapi.thelolabooth.com','staging.thelolabooth.com','/api/public/staging/site']):raise RuntimeError('Staging reference in '+str(p))
evidence=Path(args.evidence_dir);evidence.mkdir(parents=True,exist_ok=True)
(evidence/'website-parity.json').write_text(json.dumps(manifest,indent=2))
(root/'release-manifest.json').write_text(json.dumps({'source':'approved production v1.0.0 archive plus current live page bytes','sourceRevision':'10651ae72062fd50fa996a1bc8ac47f37163fc63','adminRevision':json.loads((admin/'build-info.json').read_text())['revision'],'gallery':'DEFERRED','pages':manifest},indent=2))
print(json.dumps({'artifact':str(root),'pagesCompared':len(manifest),'expectedAnalyticsOnlyDifferences':sum(x['baselineHash']!=x['candidateHash'] for x in manifest),'stagingReferences':0}))
