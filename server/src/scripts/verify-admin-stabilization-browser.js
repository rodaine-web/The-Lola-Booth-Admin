// Isolated browser and synthetic HTTP responses; every request is intercepted.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];const baseline=process.argv.includes('--baseline');
const dashboard=JSON.parse(await fs.readFile('audit-output/platform-hardening/local-dashboard.json','utf8'));
for(const g of dashboard.groups)for(const m of g.metrics)if(m.format==='money')m.value=2877.6;
async function check(defect,fn){try{await fn();results.push({defect,status:'PASS'});}catch(e){results.push({defect,status:'FAIL',message:e.message});}}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Chicago'});
 let communicationFailure=true;
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/')){
 const p=u.pathname.slice(4);
 if(p==='/auth/me')return route.fulfill({json:{user:{id:'owner',name:'QA Owner',roles:['OWNER'],permissions:['*']}}});
 if(p==='/dashboard')return route.fulfill({json:dashboard});
 if(p==='/communications')return route.fulfill(communicationFailure?{status:500,json:{error:{message:'Unable to load communications.',requestId:'qa-request-1'}}}:{json:{data:[]}});
 if(p==='/leads')return route.fulfill({json:{data:[{id:'qa',first_name:'December',last_name:'Customer',event_date:'2027-12-16',event_type:'Wedding',status:'NEW'}],pagination:{total:1,page:1,pageSize:25}}});
 if(p==='/analytics')return route.fulfill({json:{summary:{average_booking_value:'999.2000000000000000'},revenueByMonth:[],bookingsByPackage:[],bookingsByExperience:[],leadSourcePerformance:[]}});
 if(p==='/calendar')return route.fulfill({json:{events:[],range:{startDate:'2027-12-01',endDate:'2028-01-01'}}});
 return route.fulfill({json:{data:[],unreadCount:0}});
 }
 if(u.hostname!=='admin.test')return route.abort();
 let file=path.join('dist',u.pathname);try{if(!(await fs.stat(file)).isFile())file='dist/index.html';}catch{file='dist/index.html';}
 return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css'})[path.extname(file)]});});
 const page=await context.newPage();
 await check('Communications error visible with retry',async()=>{await page.goto('https://admin.test/sales/communications');await page.getByRole('alert').waitFor({timeout:2000});assert.ok(await page.getByRole('button',{name:/retry/i}).count());communicationFailure=false;await page.getByRole('button',{name:/retry/i}).click();await page.getByText('No communications match this view.').waitFor({timeout:2000});});
 await check('Dashboard money fixed to cents',async()=>{await page.goto('https://admin.test/?range=mtd');await page.getByRole('heading',{name:'Sales pipeline',exact:true}).waitFor();assert.ok((await page.locator('main').innerText()).includes('$2,877.60'));});
 await check('Date-only remains December 16 in Chicago',async()=>{await page.goto('https://admin.test/sales/leads');await page.getByText('December').first().waitFor();await page.getByRole('button',{name:'Kanban',exact:true}).click();const text=await page.locator('main').innerText();assert.match(text,/(Dec(?:ember)? 16,? 2027|12\/16\/2027)/);assert.doesNotMatch(text,/12\/15\/2027/);});
 await check('Analytics precise currency',async()=>{await page.goto('https://admin.test/insights/analytics');await page.getByRole('heading',{name:'Analytics',exact:true}).waitFor();await page.getByText('average booking value',{exact:true}).waitFor({timeout:2000});assert.ok((await page.locator('main').innerText()).includes('$999.20'));});
 await check('No one-option decorative generic filters',async()=>{await page.goto('https://admin.test/sales/clients');await page.getByRole('heading',{name:'Clients',exact:true}).waitFor();assert.equal(await page.locator('.toolbar select').evaluateAll(ss=>ss.filter(s=>s.options.length===1).length),0);});
 await check('Calendar no raw ID entry fields',async()=>{await page.goto('https://admin.test/events/calendar');await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor();assert.equal(await page.locator('input[placeholder$=" ID"]').count(),0);});
 await context.close();
 await fs.mkdir('audit-output/admin-stabilization',{recursive:true});await fs.writeFile(`audit-output/admin-stabilization/browser-${baseline?'before':'after'}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
}finally{await browser.close();}
