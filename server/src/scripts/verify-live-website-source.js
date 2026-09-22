import fs from 'node:fs/promises';
import { checksum } from '../services/website-content-import.js';
const m=JSON.parse(await fs.readFile('server/import-data/live-website.json','utf8'));
const assets=[];
for(const asset of m.media){
 const r=await fetch(asset.url,{cache:'no-store',signal:AbortSignal.timeout(30000)});
 const hash=r.ok?checksum(Buffer.from(await r.arrayBuffer())):null;
 assets.push({path:asset.path,status:r.status,expected:asset.sha256,actual:hash,match:hash===asset.sha256});
}
const r=await fetch('https://api.thelolabooth.com/api/public/site',{cache:'no-store',signal:AbortSignal.timeout(30000)});
const current=await r.json();
await fs.writeFile('audit-output/website-cms/live-source-check.json',JSON.stringify({checkedAt:new Date().toISOString(),assets,packages:current.packages,experiences:current.experiences.map(e=>({id:e.id,name:e.name,base_price:e.base_price})),settings:current.settings},null,2));
console.log(JSON.stringify({assetsVerified:assets.filter(a=>a.match).length,assetsChanged:assets.filter(a=>!a.match),publishedPackages:current.packages.map(p=>({name:p.name,price:p.starting_price}))},null,2));
if(assets.some(a=>!a.match))process.exitCode=2;
