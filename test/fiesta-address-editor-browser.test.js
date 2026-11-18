import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
test('address editor restores ZIP zero, accepts state correction and sends a reviewed edit on desktop/mobile',{skip:process.env.FIESTA_ADDRESS_BROWSER_TEST!=='true',timeout:60000},async()=>{
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),cacheDir:os.tmpdir()+'/lola-address-vite-cache',plugins:[react(),{name:'address-qa',configureServer(s){s.middlewares.use('/address-editor-qa',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/address-editor-qa','<html><head><style>body{font:16px Arial;margin:16px}label{display:block;margin:12px 0}input,textarea{box-sizing:border-box;width:100%;padding:8px}button{margin:8px;padding:8px}</style></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import Editor from"/src/components/FiestaAddressEditor.jsx";createRoot(document.getElementById("root")).render(React.createElement(Editor,{albumId:"qa-album",rowId:"qa-row",onSaved:r=>{window.qaSaved=r},onCancel:()=>{}}));</script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});let browser;
 try{
  console.log('starting QA server');await server.listen();console.log('QA server ready');const {chromium}=await import('playwright');browser=await chromium.launch();console.log('QA browser ready');
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],writes=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
   await page.route('**/api/gallery-admin/**',route=>{const request=route.request();if(request.method()==='PATCH'){writes.push(request.postDataJSON());return route.fulfill({json:{updated:true,requiresFreshApproval:true}});}return route.fulfill({json:{address:{name:'Synthetic Guest',address_line1:'12 Test Street',address_line2:'',address_city:'Boston',address_state:'Man',address_zip:'2134',address_country:'US'}}});});
   console.log('opening form',width);await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/address-editor-qa');
   await page.getByRole('button',{name:'Restore leading zero: 02134'}).click();assert.equal(await page.getByLabel('ZIP code',{exact:true}).inputValue(),'02134');
   await page.getByLabel('State',{exact:true}).fill('MA');assert.equal(await page.getByRole('button',{name:'Save and revalidate address'}).isEnabled(),false);
   await page.getByLabel('Correction reason',{exact:true}).fill('Confirmed state and leading ZIP zero from corrected spreadsheet.');await page.getByRole('button',{name:'Save and revalidate address'}).click();await page.waitForFunction(()=>window.qaSaved?.updated===true);
   assert.equal(writes.length,1);assert.equal(writes[0].address.address_zip,'02134');assert.equal(writes[0].address.address_state,'MA');assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await fs.mkdir(os.tmpdir()+'/lola-address-editor-qa',{recursive:true});await page.screenshot({path:`${os.tmpdir()}/lola-address-editor-qa/editor-${width}.png`,fullPage:true});await page.close();
  }
 }finally{await browser?.close();await server.close();}
});
