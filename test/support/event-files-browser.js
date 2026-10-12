import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import {env} from '../../server/src/config/env.js';
export async function verifyEventFilesBrowser({origin,eventId,ownerToken,png}){
 const root=fileURLToPath(new URL('../../',import.meta.url)),evidence=new URL('../../artifacts/v12-event-files/',import.meta.url);
 await fs.mkdir(evidence,{recursive:true});
 const vite=await createServer({configFile:false,root,plugins:[react()],define:{__BUILD_REVISION__:JSON.stringify('v12-event-files-qualification')},server:{host:'127.0.0.1',port:0,proxy:{'/api':origin}}});let browser;const previousOrigin=env.clientOrigin;
 try{
 await vite.listen();const base=`http://127.0.0.1:${vite.httpServer.address().port}`;env.clientOrigin=base;
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(token=>localStorage.setItem('lola_access_token',token),ownerToken);
 await page.goto(`${base}/events/events/${eventId}`);await page.getByRole('button',{name:'Files',exact:true}).click();
 await page.getByRole('heading',{name:'Event Files',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Upload File',exact:true}).isDisabled(),true);
 await page.getByLabel('File',{exact:true}).setInputFiles({name:'browser-proof.png',mimeType:'image/png',buffer:png});
 await page.getByLabel('Category',{exact:true}).selectOption('VENUE');
 await page.getByLabel('Team access',{exact:true}).selectOption('PRIVATE');
 const uploadResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/files'));await page.getByRole('button',{name:'Upload File',exact:true}).click();const uploaded=await uploadResponse;assert.equal(uploaded.status(),201,await uploaded.text());await page.getByRole('status').filter({hasText:'Private file saved.'}).waitFor();
 await page.getByRole('button',{name:'Download browser-proof.png',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Download metadata.pdf',exact:true}).isDisabled(),true);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download browser-proof.png',exact:true}).click();const download=await downloadPromise;assert.deepEqual(await fs.readFile(await download.path()),png);
 await page.screenshot({path:fileURLToPath(new URL('event-files-desktop.png',evidence)),fullPage:true});
 await page.reload();await page.getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('button',{name:'Download browser-proof.png',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Private Event Files fits mobile');
 await page.screenshot({path:fileURLToPath(new URL('event-files-mobile.png',evidence)),fullPage:true});
 assert.deepEqual(errors,[],'No browser runtime errors');
 }finally{env.clientOrigin=previousOrigin;if(browser)await browser.close();await vite.close();}
}
