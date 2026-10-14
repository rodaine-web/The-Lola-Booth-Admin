import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';

test('final review: desktop/mobile recipients, consent gate and explicit update send',{skip:process.env.PROPOSAL_REVIEW_BROWSER_TEST!=='true'},async()=>{
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','8794','--strictPort','--configLoader','runner'],{env:{...process.env,VITE_API_URL:'/api'},stdio:'pipe'});let browser;
 try{
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:8794')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const {chromium}=await import('playwright');browser=await chromium.launch();
  const id='6a2ad7c5-6133-46dd-a02b-f28ae15e25b9',version='6a2ad7c5-6133-46dd-a02b-f28ae15e25b8';
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000}});let sends=0;
   await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const proposal={id,proposal_number:'QA-ONLY',status:'SENT',total:800,client_email:'primary@qa.invalid',client_name:'QA Client',secure_token:'qa-only',has_unsent_revision:true,review_version_id:version,versions:[],email_preview:{subject:'There is an update to your Proposal from The Lola Booth.',body:'QA review email'}};
    if(path.endsWith('/send')){sends++;assert.deepEqual(route.request().postDataJSON().recipients,['primary@qa.invalid','copy@qa.invalid']);return route.fulfill({json:{status:'COMPLETE'}});}
    if(path.endsWith('/auth/me'))return route.fulfill({json:{user:{id:'qa',name:'QA Owner',permissions:['*']}}});
    if(path.endsWith('/preview'))return route.fulfill({contentType:'text/html',body:'<h1>Reviewed negotiated price $800</h1>'});
    if(path===`/api/proposals/${id}`)return route.fulfill({json:proposal});
    return route.fulfill({json:[]});
   });
   await page.goto(`http://127.0.0.1:8794/sales/proposals/${id}`);
   await page.getByRole('button',{name:'Review & Send',exact:true}).click();
   await page.getByRole('heading',{name:'Final proposal review'}).waitFor();assert.equal(sends,0,'Review & Send only navigates');
   const send=page.getByRole('button',{name:'Send Updated Proposal',exact:true});assert.equal(await send.isDisabled(),true);
   await page.getByRole('textbox',{name:'Additional recipient 1',exact:true}).fill('copy@qa.invalid');
   await page.getByRole('checkbox',{name:'I have reviewed the proposal, pricing and recipient addresses.'}).check();assert.equal(sends,0);
   await send.click();await page.getByRole('status').filter({hasText:'All proposal emails'}).waitFor();assert.equal(sends,1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Final review must fit mobile width');
   await fs.mkdir('artifacts/proposal-review',{recursive:true});await page.screenshot({path:`artifacts/proposal-review/review-${width}.png`,fullPage:true});await page.close();
  }
 }finally{await browser?.close();server.kill();}
});
