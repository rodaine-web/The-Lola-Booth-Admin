import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
test('guided postcard workspace supports drilldowns, address review, test separation and reports on desktop/mobile',{skip:process.env.POSTCARD_BROWSER_TEST!=='true',timeout:90000},async()=>{
 const app=express(),dist=path.resolve('dist');app.use('/customer-documents',express.static(dist));app.use(express.static(dist));app.get(/.*/,(_req,res)=>res.sendFile(path.join(dist,'index.html'),{dotfiles:'allow'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
 try{for(const width of [1600,768,390]){
  const page=await browser.newPage({viewport:{width,height:1050}}),errors=[],mutations=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const album={id:'11111111-1111-4111-8111-111111111111',event_id:'22222222-2222-4222-8222-222222222222',title:'Synthetic Brand Activation',event_date:'2035-11-18',status:'PUBLISHED'};
  const rows=Array.from({length:100},(_,i)=>({id:`row-${i}`,survey_row_id:`survey-${i}`,media_id:`media-${i}`,recipient_id:`recipient-${i}`,filename:`QA_${String(i+1).padStart(4,'0')}.jpg`,recipient:{name:`Synthetic Guest ${i+1}`,address_line1:'100 Sample St',address_city:'Sample City',address_state:'MN',address_zip:'01234',address_country:'US'},email:`qa-${i}@example.invalid`,consent:i<80,permissionSource:'Guest survey',match_status:'MATCHED',issues:[],result:{status:i<80?'READY':'EXCLUDED',reason:i<80?'Ready for preparation.':'Mailing permission declined.'}}));
  let reports=[];
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;if(p.startsWith('/api/')){
    if(req.method()!=='GET')mutations.push(p);
    let json={data:[]};
    if(p==='/api/auth/me')json={user:{id:'qa',name:'QA Admin',roles:['ADMIN'],permissions:['*']}};
    else if(p.endsWith('/postcard-workspace'))json={album,rows,summary:{images:100,combinations:100,matched:100,ready:80,held:0,successful:0,excluded:20,pending:0,failed:0},reports,notifications:[]};
    else if(p.match(/\/albums\/[^/]+$/))json={album,media:[],people:[],keys:[],activity:[],storage:{configured:true}};
    else if(p.endsWith('/postcard-reports')&&req.method()==='POST'){reports=[{id:'report-1',created_at:'2035-11-18T18:00:00Z'}];json=reports[0];}
    else if(p.includes('/fiesta-survey-review/')&&p.endsWith('/address'))json={address:rows[0].recipient};
    else if(p.endsWith('/mailing/live'))json={batches:[],jobs:[],connection:{production:false,liveKey:false,liveEnabled:false,worker:false}};
    else if(p.endsWith('/mailing'))json={connection:{},allowance:100,requests:[],jobs:[],history:[]};
    else if(p.match(/\/media\/[^/]+$/))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64')});
    return route.fulfill({json});
   }if(url.origin!==origin)return route.abort();return route.continue();
  });
  await page.goto(origin+`/operations/galleries/${album.id}?tab=Postcards`);
  await page.getByRole('heading',{name:'Postcard Fulfillment',exact:true}).waitFor();await page.getByRole('button',{name:/Ready to prepare/}).click();
  await page.getByText('Recipients & Validation',{exact:true}).waitFor();assert.equal(await page.getByLabel('Filter postcard status').inputValue(),'READY');
  await page.getByLabel('Search postcard records').fill('QA_0001.jpg');await page.getByRole('button',{name:'Review',exact:true}).click();
  await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Edit mailing address',exact:true}).click();await page.getByLabel('ZIP code',{exact:true}).waitFor();assert.equal(await page.getByLabel('ZIP code',{exact:true}).inputValue(),'01234');await page.getByRole('button',{name:'Cancel address edit'}).click();await page.getByRole('button',{name:'Close recipient details'}).click();
  await page.getByRole('navigation',{name:'Postcard workflow'}).getByRole('button',{name:'Lob Test',exact:false}).click();await page.getByRole('heading',{name:'Lob Test & Validation',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Push selected to Lob Test'}).isDisabled(),true);
  await page.getByRole('navigation',{name:'Postcard workflow'}).getByRole('button',{name:'Tracking & Reports',exact:false}).click();await page.getByRole('button',{name:'Generate latest report'}).click();await page.getByRole('button',{name:'Download Excel'}).waitFor();assert.ok(mutations.some(p=>p.endsWith('/postcard-reports')));assert.ok(!mutations.some(p=>p.includes('/authorize')));
  await page.getByRole('navigation',{name:'Postcard workflow'}).getByRole('button',{name:'Overview',exact:false}).click();await page.getByRole('heading',{name:'Recipient readiness'}).waitFor();await page.evaluate(()=>document.fonts.ready);await fs.mkdir('/private/tmp/lola-postcard-redesign/screens',{recursive:true});await page.screenshot({path:`/private/tmp/lola-postcard-redesign/screens/overview-${width}.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
