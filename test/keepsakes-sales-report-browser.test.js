import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {summarizeKeepsakesSales} from '../shared/keepsakes-sales-report.js';
test('sales and inventory report remains readable on desktop and mobile',{skip:process.env.KEEPSAKES_BROWSER_TEST!=='true',timeout:120000},async()=>{
 const vite=await createServer({configFile:false,plugins:[react()],define:{__BUILD_REVISION__:JSON.stringify('sales-report-qa'),'import.meta.env.VITE_GALLERY_ENABLED':JSON.stringify('true')},server:{host:'127.0.0.1',port:0}});let browser;
 try{await vite.listen();const {chromium}=await import('playwright');browser=await chromium.launch();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 const summary=summarizeKeepsakesSales([{paid_at:'2035-01-01',status:'PAID',subtotal_cents:1000,discount_cents:100,shipping_cents:500,tax_cents:90,total_cents:1490,refunded_cents:0,items:[{key:'magnet',title:'Photo Magnet',units:2}]}]);
 for(const width of [1440,390]){const page=await browser.newPage({viewport:{width,height:1100}}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
 await page.route(url=>url.pathname.startsWith('/api/'),route=>{const pathname=new URL(route.request().url()).pathname;
 if(pathname.endsWith('/auth/me'))return route.fulfill({json:{user:{id:'qa-owner',name:'QA Owner',roles:['OWNER'],permissions:['read:analytics','read:finance','read:admin']}}});
 if(pathname.endsWith('/keepsakes-admin'))return route.fulfill({json:{orders:[],products:[],metrics:{}}});
 if(pathname.endsWith('/analytics'))return route.fulfill({json:{summary:{collected_revenue:20},range:{start:'2035-01-01',end:'2035-02-01'},commerce:{available:true,mode:'TEST',...summary,combinedCollectedPreviewCents:3490,inventory:[{id:'magnet',key:'magnet',title:'Photo Magnet',available_units:7,committed_units:2,supply_confirmed:true,active:true},{id:'keychain',key:'keychain',title:'Photo Keychain',available_units:null,committed_units:0,supply_confirmed:true,active:true}]}}});
 return route.fulfill({json:[]});});
 await page.goto(origin+'/insights/analytics');await page.getByText('Combined collected preview',{exact:true}).waitFor().catch(async error=>{console.error(await page.locator('body').innerText());throw error;});assert.equal(await page.getByText('$34.90',{exact:true}).count(),1);
 await page.getByRole('button',{name:'Keepsakes & Inventory',exact:true}).click();await page.getByText('Quantity not tracked',{exact:true}).waitFor();assert.equal(await page.getByText('Photo Magnet',{exact:true}).count(),2);
 assert.equal(await page.locator('.ksr-inventory').getByRole('link',{name:'View all →'}).getAttribute('href'),'/sales/keepsakes?tab=products');
 if(width===1440){await page.getByRole('button',{name:'Sales',exact:true}).click();assert.equal(await page.locator('[id="nav-Sales"]').getByRole('link',{name:'Keepsakes & Orders',exact:true}).getAttribute('href'),'/sales/keepsakes');}
 await fs.mkdir('/private/tmp/lola-sales-report-browser',{recursive:true});await page.screenshot({path:`/private/tmp/lola-sales-report-browser/inventory-${width}.png`,fullPage:true});await page.goto(origin+'/operations/keepsakes?tab=orders&source=legacy#queue');await page.waitForURL('**/sales/keepsakes?tab=orders&source=legacy#queue');await page.getByRole('heading',{name:'Keepsakes & Orders',exact:true}).waitFor();assert.deepEqual(errors,[]);await page.close();}
 }finally{await browser?.close();await vite.close();}
});
