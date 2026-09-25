// Export the staging repository only into the existing Admin hosting project.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(process.argv[2]||'/private/tmp/lola-staging');
const remote=execFileSync('git',['-C',root,'remote','get-url','origin'],{encoding:'utf8'}).trim();
if(!/rodaine-web\/staging(?:\.git)?$/.test(remote))throw Error('Export must originate from the staging repository.');
const config=await fs.readFile(path.join(root,'config.js'),'utf8');
if(!config.includes('cmsChannel: "STAGING"')||!config.includes('environment: "staging"'))throw Error('Explicit staging configuration required.');
const target=path.resolve('public/staging-site');await fs.mkdir(target,{recursive:true});
const files=(await fs.readdir(root)).filter(f=>/\.(html|css|js|png)$/.test(f)&&f!=='404.html');
for(const file of files)await fs.copyFile(path.join(root,file),path.join(target,file));
await fs.cp(path.join(root,'assets'),path.join(target,'assets'),{recursive:true});
await fs.writeFile(path.join(target,'source.json'),JSON.stringify({repository:remote,revision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),channel:'STAGING',workingTree:execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim()?'modified':'clean'},null,2));
console.log('Exported '+files.length+' staging site files plus approved assets.');
