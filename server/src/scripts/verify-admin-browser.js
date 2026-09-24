import {chromium} from 'playwright';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const dashboard=JSON.parse(await fs.readFile('audit-output/platform-hardening/local-dashboard.json','utf8'));
const output='audit-output/platform-hardening';await fs.mkdir(output,{recursive:true});const report=[];
try{for(const viewport of [{width:1440,height:1000},{width:820,height:1180},{width:390,height:844}]){
 const context=await browser.newContext({viewport});let member={id:'member',name:'QA Member',first_name:'QA',last_name:'Member',email:'qa@example.invalid',roles:['ATTENDANT'],permissions:[],active:true,invitation_status:'INVITED'};
 const owner={id:'owner',name:'QA Owner',roles:['OWNER'],permissions:['*']};let calls=[];
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/')){
 const p=u.pathname.slice(4);calls.push(p+u.search);
 if(p==='/dashboard')return route.fulfill({json:dashboard});
 if(p==='/auth/me')return route.fulfill({json:{user:owner}});
 if(p==='/users')return route.fulfill({json:{data:[owner,member]}});
 if(p==='/roles')return route.fulfill({json:{data:[{id:'attendant',name:'ATTENDANT'},{id:'admin',name:'ADMIN'}]}});
 if(p==='/permissions')return route.fulfill({json:{data:[{key:'read:website',description:'View website'}]}});
 if(p==='/users/member'&&route.request().method()==='PATCH'){member={...member,...route.request().postDataJSON()};return route.fulfill({json:member});}
 if(p.endsWith('/pdf'))return route.fulfill({path:'qa-output/LOLA-Invoice-QA.pdf',contentType:'application/pdf'});
 if(p.startsWith('/invoices/'))return route.fulfill({json:{id:'qa',invoice_number:'QA-INVOICE',client_name:'Controlled QA',status:'DRAFT',total:100,items:[],payments:[],due_date:'2026-12-01'}});
 return route.fulfill({json:{data:[],unreadCount:0}});
 }
 let file=path.join('dist',u.pathname);try{if(!(await fs.stat(file)).isFile())file='dist/index.html';}catch{file='dist/index.html';}
 return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css'})[path.extname(file)]});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://admin.test/?range=mtd');await page.getByRole('heading',{name:'Sales pipeline',exact:true}).waitFor();await page.locator('.recharts-surface').first().waitFor();
 if(viewport.width<761){const menu=page.getByRole('button',{name:'Menu',exact:true});assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).isVisible(),false);await menu.click();assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).isVisible(),true);await page.getByRole('button',{name:'Close navigation',exact:true}).click();}
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Dashboard overflow');await page.screenshot({path:`${output}/dashboard-${viewport.width}.png`,fullPage:true});
 await page.locator('.chart-links a').first().click();await page.waitForURL('**/sales/leads?**');assert.ok(new URL(page.url()).searchParams.has('from'));
 await page.goto('https://admin.test/finance/invoices?status=SENT');await page.getByText('All statuses',{exact:true}).waitFor({state:'attached'});await page.getByLabel('Status',{exact:true}).selectOption('');assert.equal(new URL(page.url()).searchParams.has('status'),false);
 await page.goto('https://admin.test/system/users');await page.getByRole('heading',{name:'Users',exact:true}).waitFor();
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('First Name',{exact:true}).fill('Updated');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').waitFor();assert.equal(member.first_name,'Updated');
 await page.screenshot({path:`${output}/users-${viewport.width}.png`,fullPage:true});
 await page.goto('https://admin.test/finance/invoices/qa');await page.locator('.pdf-page-frame canvas').first().waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-page-frame canvas')].length>=2&&[...document.querySelectorAll('.pdf-page-frame canvas')].every(c=>c.width>0));
 const pages=await page.locator('.pdf-page-frame canvas').evaluateAll(cs=>cs.map(c=>{const r=c.getBoundingClientRect();return {width:r.width,height:r.height,center:r.x+r.width/2};}));assert.ok(pages.every(p=>Math.abs(p.center-pages[0].center)<1));assert.ok(pages.every(p=>Math.abs(p.width/p.height-612/792)<.01));
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow){console.log(await page.locator("body *").evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().right>innerWidth+1).map(n=>({tag:n.tagName,cls:n.className,width:n.getBoundingClientRect().width})).slice(0,25)));await page.screenshot({path:`${output}/overflow-${viewport.width}.png`,fullPage:true});}assert.equal(overflow,false,`Admin horizontal overflow at ${viewport.width}`);
 await page.screenshot({path:`${output}/invoice-preview-${viewport.width}.png`,fullPage:true});assert.deepEqual(errors,[]);
 report.push({width:viewport.width,userSave:true,pages,overflow,errors});await context.close();
}await fs.writeFile(output+'/admin-browser-report.json',JSON.stringify({passed:true,report},null,2));console.log('PASS: Users save and actual PDF previews at desktop, tablet and mobile.');}finally{await browser.close();}
