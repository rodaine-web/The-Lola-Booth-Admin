import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
test('album, photo, reset and Dropbox controls work on desktop and mobile',{skip:process.env.GALLERY_CONTROLS_BROWSER_TEST!=='true',timeout:60000},async()=>{
 const app=express(),dist=path.resolve('dist');app.use('/customer-documents',express.static(dist));app.use(express.static(dist));app.get(/.*/,(_req,res)=>res.sendFile(path.join(dist,'index.html'),{dotfiles:'allow'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
 try{for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  page.setDefaultTimeout(10000);
  let album={id:'11111111-1111-4111-8111-111111111111',event_id:'22222222-2222-4222-8222-222222222222',title:'Synthetic QA Gallery',event_date:'2035-11-18',status:'DRAFT',allow_download:true,allow_zip:true,allow_personal_download:true,allow_personal_zip:true};
  let media=[1,2].map(n=>({id:`33333333-3333-4333-8333-33333333333${n}`,mime_type:'image/png',status:'VISIBLE',person_ids:[]}));
  let source={folder_path:'/fiesta/old',enabled:true,imported:2},deleted=[],reset=false;
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   if(p.startsWith('/api/')){
    let json={data:[]};
    if(p==='/api/auth/me')json={user:{id:'qa',name:'Synthetic QA',roles:['ADMIN'],permissions:['*']}};
    else if(p==='/api/gallery-admin/albums')json={data:[{...album,photos:media.length,people:0}]};
    else if(p.endsWith('/media/delete')){const ids=req.postDataJSON().media_ids;deleted.push(...ids);media=media.filter(m=>!ids.includes(m.id));json={deleted:ids.length};}
    else if(p.endsWith('/reset')){reset=true;album={...album,id:'44444444-4444-4444-8444-444444444444'};media=[];json={album};}
    else if(p.endsWith('/dropbox')){if(req.method()==='POST')source={...source,folder_path:req.postDataJSON().folderPath,enabled:false};json={configured:true,active:true,connection:{appConfigured:true},source};}
    else if(p.match(/\/albums\/[^/]+$/))json={album,media,people:[],keys:[],activity:[],storage:{configured:true}};
    else if(p.match(/\/media\/[^/]+$/))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64')});
    return route.fulfill({json});
   }
   if(url.origin!==origin)return route.abort();return route.continue();
  });
  await page.goto(origin+'/operations/galleries');await page.getByRole('button',{name:'Delete album Synthetic QA Gallery',exact:true}).waitFor();
  await page.getByRole('link',{name:/Synthetic QA Gallery/}).click();await page.getByRole('button',{name:'Photos',exact:true}).click();
  await page.getByRole('button',{name:'Delete photo 1',exact:true}).click();await page.getByRole('status').filter({hasText:'Photos deleted'}).waitFor();assert.equal(deleted.length,1);
  await page.getByRole('button',{name:'Select all photos',exact:true}).click();await page.getByRole('button',{name:'Delete selected photos',exact:true}).click();await page.getByRole('heading',{name:'A blank canvas for a great night.'}).waitFor();assert.equal(deleted.length,2);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Event delivery folder').fill('/fiesta/real');await page.getByRole('button',{name:'Save Dropbox folder',exact:true}).click();await page.getByText('Dropbox folder saved.',{exact:false}).waitFor();assert.equal(source.folder_path,'/fiesta/real');assert.equal(source.enabled,false);
  await page.getByRole('button',{name:'Reset and recreate gallery',exact:true}).click();await page.waitForURL('**/44444444-4444-4444-8444-444444444444');assert.equal(reset,true);
  await fs.mkdir(os.tmpdir()+'/lola-gallery-controls-browser',{recursive:true});await page.screenshot({path:`${os.tmpdir()}/lola-gallery-controls-browser/${width}.png`,fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
