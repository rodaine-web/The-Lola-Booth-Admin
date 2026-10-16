import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import definitions from '../shared/integration-marketplace-catalog.json' with {type:'json'};
import {marketplaceState,marketplaceMetrics} from '../shared/integration-marketplace.js';
test('marketplace responsive visual and functional journey',{skip:process.env.INTEGRATION_MARKETPLACE_BROWSER_TEST!=='true',timeout:180000},async()=>{
 const server=await createServer({configFile:false,cacheDir:'.qa-vite/integrations',plugins:[react()],define:{__BUILD_REVISION__:JSON.stringify('integrations-visual-qa')},server:{host:'127.0.0.1',port:0}});let browser;
 try{await server.listen();const {chromium}=await import('playwright');browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{});const origin='http://127.0.0.1:'+server.httpServer.address().port;
 const apps=definitions.map(d=>({...d,evidence:{status:['MICROSOFT','STRIPE'].includes(d.id)?'CONNECTED':'NOT_CONFIGURED',verified:['MICROSOFT','STRIPE'].includes(d.id),account:d.id==='MICROSOFT'?'info@thelolabooth.com':null},state:marketplaceState(d,{status:['MICROSOFT','STRIPE'].includes(d.id)?'CONNECTED':'NOT_CONFIGURED',verified:['MICROSOFT','STRIPE'].includes(d.id)})}));
 await fs.mkdir('artifacts/integrations',{recursive:true});
 for(const width of [1920,1440,1280,1024,768,390]){
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let writes=0;page.on('pageerror',e=>errors.push(e.message));let fail=false;
 await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
 const path=new URL(route.request().url()).pathname;if(!['GET','HEAD'].includes(route.request().method()))writes++;
 if(path.endsWith('/auth/me'))return route.fulfill({json:{user:{id:'qa',name:'LOLA Owner',roles:['OWNER'],permissions:['*']}}});
 if(path.endsWith('/integrations/marketplace'))return fail?route.fulfill({status:500,json:{error:{message:'QA connection unavailable'}}}):route.fulfill({json:{apps,metrics:marketplaceMetrics(apps),days:30,leadSources:[{provider:'WEBSITE',count:4}],activity:[{id:'qa-job',kind:'Local job',provider:'GA4',operation:'REPORT_REFRESH',status:'FAILED',mode:'DEVELOPMENT',occurred_at:'2026-10-16T12:00:00Z'}]}});
 if(path.endsWith('/crm/outlook'))return route.fulfill({json:{status:'CONNECTED',account:'info@thelolabooth.com',mailbox:'info@thelolabooth.com',aliases:['info@thelolabooth.com','lola@thelolabooth.com'],scopes:['User.Read','Contacts.Read.Shared','Mail.ReadBasic.Shared'],configured:true,sync_enabled:false}});
 if(path.endsWith('/crm/outlook/discoveries'))return route.fulfill({json:{data:[{id:'qa-d',state:'COMPLETED',created_at:'2026-10-15T12:00:00Z',records_discovered:4,new_candidates:3,existing_contacts:1}]}});
 if(path.endsWith('/integrations/overview'))return route.fulfill({json:{leadSources:[],failedInbound:[]}});
 if(path.endsWith('/integrations/connections'))return route.fulfill({json:{data:[]}});
 return route.fulfill({json:[]});
 });
 await page.goto(origin+'/system/integrations');await page.getByRole('heading',{name:'Integration Health',exact:true}).waitFor();await page.getByRole('heading',{name:'Discovery History',exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No overflow at ${width}`);
 await page.screenshot({path:`artifacts/integrations/full-${width}.png`,fullPage:true});
 if(width===1440){await page.screenshot({path:'artifacts/integrations/overview.png'});await page.getByRole('heading',{name:'Booth Software & Event Experience',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/integrations/categories.png'});await page.getByRole('heading',{name:'Microsoft 365 Contact Discovery',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/integrations/discovery.png'});}
 await page.getByRole('textbox',{name:'Search integrations',exact:true}).fill('Snappic');await page.getByRole('button',{name:'Explore Snappic',exact:true}).click();await page.getByRole('heading',{name:'Integration not yet available'}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('textbox',{name:'Search integrations',exact:true}).fill('not-a-provider');await page.getByRole('heading',{name:'No matching integrations'}).waitFor();await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByRole('button',{name:'Connected',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Manage Stripe',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Manage Snappic',exact:true}).count(),0);
 await page.getByRole('button',{name:'All',exact:true}).click();await page.getByText('Advanced Discovery Options',{exact:true}).click();await page.getByLabel('Discovery Sources',{exact:true}).selectOption('SENT');await page.getByLabel('Include CC recipients',{exact:true}).check();assert.equal(writes,0,'Filtering and editing settings must never send or sync');
 if(width===390){await page.getByRole('button',{name:'Manage Stripe',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.keyboard.press('Escape');}
 fail=true;await page.getByRole('button',{name:'Refresh integration status',exact:true}).click();await page.getByText('QA connection unavailable',{exact:true}).waitFor();fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('heading',{name:'Integration Health',exact:true}).waitFor();assert.deepEqual(errors,[]);await page.close();
 }
 }finally{await browser?.close();await server.close();}
});
