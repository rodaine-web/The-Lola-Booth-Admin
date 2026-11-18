import os from 'node:os';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import {once} from 'node:events';
import path from 'node:path';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {adminRouter} from '../../server/src/routes/admin.js';
import {authRouter} from '../../server/src/routes/auth.js';
import {galleryAdminRouter} from '../../server/src/routes/gallery.js';
import {clientSessionRouter} from '../../server/src/routes/client-session.js';
import {errorHandler} from '../../server/src/middleware/error-handler.js';
import {env} from '../../server/src/config/env.js';
import {encryptSecretJson} from '../../server/src/services/integration-secrets.js';
export async function qualifyReleaseBrowser({db,user,client,event,album,grant,photo,root}){
 const oldOrigin=env.clientOrigin,oldStorage=env.localStorageRoot,oldProvider=env.storageProvider;
 env.localStorageRoot=path.join(root,'documents');env.storageProvider='local';
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 await db.query("INSERT INTO permissions(key) VALUES('*') ON CONFLICT DO NOTHING");await db.query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*' ON CONFLICT DO NOTHING",[user.id]);
 await db.query("INSERT INTO roles(name) VALUES('OWNER') ON CONFLICT DO NOTHING");await db.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='OWNER' ON CONFLICT DO NOTHING",[user.id]);
 const invitation=crypto.randomBytes(32).toString('hex');await db.query('INSERT INTO client_workspace_invitations(grant_id,token_hash,token_ciphertext,recipient_email) VALUES($1,$2,$3,$4)',[grant.id,crypto.createHash('sha256').update(invitation).digest('hex'),encryptSecretJson({token:invitation}),client.email]);
 const app=express();app.use((req,res,next)=>{const entry={path:req.path,started:Date.now()};requests.push(entry);res.on('finish',()=>{entry.status=res.statusCode;entry.ms=Date.now()-entry.started;});next();});app.use(express.json({limit:'14mb'}));app.use('/api/auth',authRouter);app.use('/api/gallery-admin',galleryAdminRouter);app.use('/api/public/client',clientSessionRouter);app.use('/api',adminRouter);
 const directory=path.resolve(process.env.LOLA_QA_FRONTEND_DIR);assert.ok(['/private/tmp/lola-',os.tmpdir()+'/lola-'].some(prefix=>directory.startsWith(prefix)));
 app.use('/customer-documents',express.static(directory));app.use(express.static(directory));app.get(/^(?!\/api\/).*/,(_req,res)=>res.sendFile(path.join(directory,'index.html')));app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;env.clientOrigin=origin;
 let browser;const errors=[],pages=[],requests=[];const evidence=os.tmpdir()+'/lola-complete-browser-20261113';await fs.mkdir(evidence,{recursive:true});
 try{
 browser=await chromium.launch();const staff=await browser.newContext({viewport:{width:1440,height:1000}}),customer=await browser.newContext({viewport:{width:1440,height:1000}});
 for(const context of [staff,customer]){await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());context.on('page',page=>{pages.push(page);page.on('pageerror',e=>errors.push(e.message));});}
 const token=jwt.sign({sub:user.id},process.env.JWT_SECRET,{expiresIn:'10m'});await staff.addInitScript(value=>{if(window===window.top&&location.origin!=='null')localStorage.setItem('lola_access_token',value);},token);
 const page=await staff.newPage();page.setDefaultTimeout(30000);
 await page.goto(`${origin}/sales/clients/${client.id}/workspace`);await page.getByRole('heading',{name:client.name,exact:true}).waitFor();
 const navigation=page.getByRole('navigation',{name:'Client workspace sections'});
 for(const label of ['Overview','Events','Event Readiness','Planning & Creative','Agreements & Signatures','Staff & Equipment','Files','Communications','Finance','Gallery']){await navigation.getByRole('button',{name:label,exact:true}).click();await page.locator('main.c360-page').waitFor();}
 await navigation.getByRole('button',{name:'Files',exact:true}).click();await page.getByLabel('Choose document').setInputFiles({name:'QA-private.png',mimeType:'image/png',buffer:photo});await page.getByRole('button',{name:'Upload privately',exact:true}).click();await page.getByText('QA-private.png',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Share with client',exact:true}).click();await page.getByRole('button',{name:'Remove client access',exact:true}).waitFor();await page.getByText('Shared with client',{exact:true}).waitFor();
 await page.screenshot({path:path.join(evidence,'client360-files-desktop.png'),fullPage:true,animations:'disabled'});
 const file=await one('SELECT id FROM files WHERE event_id=$1 AND filename=$2',[event.id,'QA-private.png']);
 const clientPage=await customer.newPage();clientPage.setDefaultTimeout(30000);
 await clientPage.goto(`${origin}/client/access#${invitation}`);await clientPage.getByRole('button',{name:'Open The Client Workspace →',exact:true}).click();
 await clientPage.getByRole('heading',{name:event.event_name,exact:true}).waitFor();await clientPage.getByRole('button',{name:'Download QA-private.png',exact:true}).waitFor();
 const download=clientPage.waitForEvent('download');await clientPage.getByRole('button',{name:'Download QA-private.png',exact:true}).click();assert.equal((await download).suggestedFilename(),'QA-private.png');
 assert.equal(await clientPage.getByLabel('Return street address',{exact:true}).inputValue(),'1935 S Wabash Ave');
 await clientPage.getByLabel('Requested quantity').fill('2');await clientPage.getByLabel('Mailing notes').fill('Client browser mailing request');await clientPage.getByRole('button',{name:'Request postcard mailing',exact:true}).click();await clientPage.getByText(/Request: requested · 2 postcards/).waitFor();
 const csrf=await clientPage.evaluate(async id=>(await fetch('/api/public/client/events/'+id+'/postcards',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({quantity:2,notes:'No CSRF',return_address:{name:'Mailing QA Client',address_line1:'1935 S Wabash Ave',address_line2:'#301',address_city:'Chicago',address_state:'IL',address_zip:'60616',address_country:'US'}})})).status,event.id);assert.equal(csrf,403,'mutations require client CSRF');
 const wrong=await clientPage.evaluate(async id=>(await fetch('/api/public/client/events/'+id+'/postcards',{credentials:'include'})).status,crypto.randomUUID());assert.equal(wrong,404,'knowing another event ID cannot expose its mailing request');
 await clientPage.setViewportSize({width:390,height:844});assert.equal(await clientPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'client workspace fits mobile');await clientPage.screenshot({path:path.join(evidence,'client-workspace-mobile.png'),fullPage:true,animations:'disabled'});
 await clientPage.reload();await clientPage.getByRole('heading',{name:event.event_name,exact:true}).waitFor();await clientPage.getByText(/Request: requested · 2 postcards/).waitFor();
 // Removing file access takes effect for subsequent downloads without public storage URLs.
 await page.getByRole('button',{name:'Remove client access',exact:true}).click();await page.getByRole('button',{name:'Share with client',exact:true}).waitFor();
 assert.equal(await clientPage.evaluate(async({eventId,fileId})=>(await fetch(`/api/public/client/events/${eventId}/files/${fileId}/download`,{credentials:'include'})).status,{eventId:event.id,fileId:file.id}),404);
 await page.goto(`${origin}/operations/galleries/${album.id}`);await page.getByRole('heading',{name:album.title,exact:true}).waitFor();await page.getByRole('button',{name:'Postcards',exact:true}).click();
 await page.getByRole('heading',{name:'Mailing authorization & test queue',exact:true}).waitFor();await page.getByRole('button',{name:'Approve request',exact:true}).click();await page.getByRole('status').filter({hasText:'Client request approved.'}).waitFor();
 await page.getByRole('button',{name:'Preview front and back',exact:true}).first().click();await page.getByAltText('back print-ready postcard preview',{exact:true}).waitFor();
 const source=page.waitForEvent('download');await page.getByRole('button',{name:'Download original import',exact:true}).first().click();assert.equal((await source).suggestedFilename(),'fiesta-original-survey.txt');
 await page.screenshot({path:path.join(evidence,'gallery-mailing-desktop.png'),fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await page.locator('.lola-mobile-nav-toggle').waitFor();assert.equal(await page.locator('.lola-mobile-nav-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'gallery mailing workbench fits mobile');await page.screenshot({path:path.join(evidence,'gallery-mailing-mobile.png'),fullPage:true,animations:'disabled'});await page.screenshot({path:path.join(evidence,'gallery-mailing-mobile-viewport.png'),animations:'disabled'});
 await clientPage.locator('.workspace-account summary').click();await clientPage.getByRole('button',{name:'Sign out',exact:true}).click();await clientPage.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();
 assert.deepEqual(errors,[],'no unhandled browser errors across Client 360, client workspace and gallery');
 }catch(error){await fs.writeFile(path.join(evidence,'failure.txt'),JSON.stringify({message:error.message,errors,pool:{total:db.pool.totalCount,waiting:db.pool.waitingCount,idle:db.pool.idleCount},requests:requests.slice(-25),pages:await Promise.all(pages.filter(p=>!p.isClosed()).map(async page=>({path:new URL(page.url()).pathname,body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,4000)})))},null,2));throw error;}
 finally{await browser?.close();await new Promise(resolve=>server.close(resolve));env.clientOrigin=oldOrigin;env.localStorageRoot=oldStorage;env.storageProvider=oldProvider;}
}
