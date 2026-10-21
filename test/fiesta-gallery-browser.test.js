import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
test('Fiesta guest gallery desktop/mobile isolates assigned media and supports video',{skip:process.env.FIESTA_GALLERY_BROWSER_TEST!=='true'},async()=>{
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react()],define:{__BUILD_REVISION__:JSON.stringify('fiesta-browser-qa'),'import.meta.env.VITE_APP_ENV':JSON.stringify('test')},server:{host:'127.0.0.1',port:0}});let browser,page;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port,{chromium}=await import('playwright');browser=await chromium.launch();
  for(const width of [1440,390]){
   page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname.includes('/access/'))return route.fulfill({json:{title:'Your Photos',eventName:'QA ONLY',eventDate:'2035-10-15',type:'PERSON',allowDownload:true,allowZip:true,expiresAt:'2035-11-15',media:[{id:'qa-photo',mediaType:'IMAGE',mimeType:'image/png',url:'/api/gallery/media/photo'},{id:'qa-video',mediaType:'VIDEO',mimeType:'video/mp4',url:'/api/gallery/media/video'}]}});
    if(pathname.endsWith('/photo'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64')});
    return route.fulfill({json:[]});
   });
   await page.goto(`${origin}/gallery/p/${'a'.repeat(43)}`);await page.getByRole('heading',{name:'Your Photos',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Open photo',exact:false}).count(),2);assert.equal(await page.locator('video').count(),1);
   assert.equal(await page.getByText('View all captures',{exact:false}).count(),0);await page.getByRole('button',{name:'Open photo 2',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('video[controls]').count(),1);
   await page.getByRole('button',{name:'Close photo',exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
   await fs.mkdir('artifacts/fiesta-gallery',{recursive:true});await page.screenshot({path:`artifacts/fiesta-gallery/guest-${width}.png`,fullPage:true});await page.close();
  }
 }finally{await browser?.close();await server.close();}
});
