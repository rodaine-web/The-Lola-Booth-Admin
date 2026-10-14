import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import {env} from '../../server/src/config/env.js';
export async function verifyEventFilesBrowser({origin,eventId,ownerToken,png,customerCookie}){
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
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:fileURLToPath(new URL('event-files-mobile.png',evidence)),fullPage:true});
 const mobile=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>window.innerWidth+1}).map(e=>({tag:e.tagName,class:e.className,right:Math.round(e.getBoundingClientRect().right),width:Math.round(e.getBoundingClientRect().width)})).slice(0,12)}));assert.ok(mobile.scroll<=mobile.width,'Private Event Files fits mobile: '+JSON.stringify(mobile));
 await page.screenshot({path:fileURLToPath(new URL('event-files-mobile.png',evidence)),fullPage:true});
 // Explicit share and removal through Admin, then real customer cookie sessions.
 await page.getByRole('button',{name:'Share browser-proof.png',exact:true}).click();
 await page.getByRole('button',{name:'Confirm sharing',exact:true}).click();
 await page.getByRole('button',{name:'Stop sharing browser-proof.png',exact:true}).waitFor();
 const customerContext=await browser.newContext({viewport:{width:1440,height:1000}});
 const [cookieName,cookieValue]=customerCookie.split('=');await customerContext.addCookies([{name:cookieName,value:cookieValue,url:base,httpOnly:true,sameSite:'Strict'}]);
 const customerPage=await customerContext.newPage();customerPage.on('pageerror',error=>errors.push(error.message));
 await customerPage.goto(`${base}/client/events/${eventId}`);
 await customerPage.getByRole('region',{name:'Shared event files',exact:true}).waitFor();
 const customerDownload=customerPage.waitForEvent('download');await customerPage.getByRole('button',{name:'Download browser-proof.png',exact:true}).click();
 const original=await customerDownload;assert.equal(original.suggestedFilename(),'browser-proof.png');assert.deepEqual(await fs.readFile(await original.path()),png);
 await customerPage.screenshot({path:fileURLToPath(new URL('customer-files-desktop.png',evidence)),fullPage:true});
 await customerPage.setViewportSize({width:390,height:844});await customerPage.reload();await customerPage.getByRole('button',{name:'Download browser-proof.png',exact:true}).waitFor();
 assert.ok(await customerPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Customer files fit mobile');
 await customerPage.screenshot({path:fileURLToPath(new URL('customer-files-mobile.png',evidence)),fullPage:true});
 await page.getByRole('button',{name:'Stop sharing browser-proof.png',exact:true}).click();await page.getByRole('button',{name:'Remove customer access',exact:true}).click();
 await page.getByRole('button',{name:'Share browser-proof.png',exact:true}).waitFor();await customerPage.reload();
 await customerPage.getByRole('region',{name:'Shared event files',exact:true}).waitFor();
 await customerPage.getByRole('button',{name:'Download client-reference.png',exact:true}).waitFor();
 assert.equal(await customerPage.getByRole('button',{name:'Download browser-proof.png',exact:true}).count(),0);
 await customerContext.close();
 assert.deepEqual(errors,[],'No browser runtime errors');
 }finally{env.clientOrigin=previousOrigin;if(browser)await browser.close();await vite.close();}
}
