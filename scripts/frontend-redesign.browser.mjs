import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const origin=process.env.FRONTEND_PREVIEW_URL || 'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],mutations=[];
page.on('pageerror',e=>errors.push(e.message));
const client={id:'client-1',name:'Jessica Smith',first_name:'Jessica',last_name:'Smith',email:'jessica@example.test',phone:'555-0101',client_type:'INDIVIDUAL',summary:{total_events:2,lifetime_value:3000,outstanding_balance:500},events:[],proposals:[],invoices:[],payments:[],tasks:[],files:[],communications:[],activity:[]};
const event={id:'event-1',client_id:client.id,client_name:client.name,event_name:'Jessica’s Wedding',event_number:'LOLA-EV-1043',event_type:'Wedding',event_date:'2026-10-12',start_time:'17:00',end_time:'21:00',venue_name:'The Laurel',status:'CONFIRMED',operational_status:'PREPARING',staff:[],equipment:[],tasks:[],files:[],payments:[],communications:[],proposals:[],invoices:[],activity:[],operations:{readiness:{score:80,status:'PREPARING',items:[{label:'Creative approval',category:'CREATIVE',status:'PENDING',severity:'NORMAL'}],incomplete:1,critical:0},checklists:[],staff:[],equipment:[],contacts:[],timeline:[],incidents:[],completion:{}}};
const lead={...client,id:'lead-1',event_type:'Wedding',event_date:event.event_date,status:'NEW'};
const metrics=['upcoming_events','new_leads','proposals_sent','collected_revenue'].map(key=>({key,value:4,format:key==='collected_revenue'?'money':'count'}));
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname.replace(/^\/api/,'');
 let data={data:[]};
 if(req.method()!=='GET'){mutations.push({path,method:req.method(),body:req.postDataJSON()});data={id:'proposal-1'};}
 else if(path==='/auth/me')data={user:{name:'Alex Taylor',roles:['OWNER'],permissions:['*']}};
 else if(path==='/dashboard')data={sqlRange:{start:"2026-10-01",end:"2026-11-01"},groups:[{metrics}],trends:[],leadSources:[],todaysEvents:[event],needsAttention:[],metricDefinitions:{booked_revenue:'Booking totals for the selected period.'}};
 else if(path==='/clients/client-1')data=client;
 else if(path==='/events/event-1')data=event;
 else if(path==='/leads/lead-1')data=lead;
 else if(path==='/experiences')data={data:[{id:'experience-1',name:'Glam',base_price:500,description:'Studio portraits for your celebration'}]};
 else if(path==='/packages')data={data:[{id:'package-1',experience_id:'experience-1',name:'Signature',starting_price:1500}]};
 else if(path==='/proposals/proposal-1')data={id:'proposal-1',status:'DRAFT',client_name:client.name,total:1500,versions:[],activity:[]};
 else if(path==='/analytics')data={summary:{booked_revenue:3000,collected_revenue:2500},revenueByMonth:[],bookingsByPackage:[],bookingsByExperience:[],leadSourcePerformance:[]};
 else if(path==='/system/health')data={status:'HEALTHY',generatedAt:new Date().toISOString(),checks:[]};
 else if(path==='/communications/templates')data={data:[],variables:[]};
 else if(path==='/communications/automations')data={data:[],jobs:[],runs:[]};
 else if(path==='/website/staging/hero')data={data:[{id:'hero-1',entity_key:'hero.wedding',display_order:1,status:'DRAFT',channel:'STAGING',payload:{image:'/brand/LOLA_Primary_Dark_Transparent.png',alt_text:'LOLA wedding slide',caption:'Make it a night to remember'}}]};
 else if(path==='/notifications')data={data:[],unread:0};
 else if(path==='/search')data={data:[{id:client.id,type:'client',title:client.name}]};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
try{
 await page.goto(origin+'/');
 await page.getByRole('heading',{name:'Good morning, Alex!'}).waitFor();
 assert.equal(await page.locator('vite-error-overlay').count(),0);
 console.log('PASS: local preview loads, dashboard renders, no framework overlay');
 await page.goto(origin+'/events/events/event-1');
 await page.getByRole('heading',{name:event.event_name,exact:true}).waitFor();
 const sections=page.getByRole('navigation',{name:'Event command center',exact:true});
 for(const [name,heading] of [['Timeline','Operational Status'],['Checklist','Checklist'],['Creative','Creative'],['Team & Equipment','Assigned Staff'],['Finance','Finance'],['Communications','Communications'],['Activity','Activity']]){
  await sections.getByRole('button',{name,exact:true}).click();
  await page.getByRole('heading',{name:heading,exact:true}).waitFor();
 }
 await sections.getByRole('button',{name:'Creative',exact:true}).click();
 await page.getByPlaceholder('Backdrop selection').fill('Gold shimmer');
 await page.getByRole('button',{name:'Save Creative'}).click();
 await page.getByText('Creative updated.',{exact:true}).waitFor();
 assert.equal(mutations.at(-1).path,'/events/event-1/creative');
 assert.equal(mutations.at(-1).body.backdrop_selection,'Gold shimmer');
 await sections.getByRole('button',{name:'Team & Equipment',exact:true}).click();
 await page.getByRole('navigation',{name:'Team & Equipment sections'}).getByRole('button',{name:'Equipment',exact:true}).click();
 await page.getByRole('heading',{name:'Assigned Equipment',exact:true}).waitFor();
 if(process.env.SCREENSHOT_DIR){await sections.getByRole('button',{name:'Overview',exact:true}).click();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:process.env.SCREENSHOT_DIR+'/event-command-center.png',fullPage:true});}
 console.log('PASS: event sections, team subsection and unchanged creative API payload');
 await page.goto(origin+'/sales/proposals/new?eventId=event-1');
 await page.getByText('Contact details',{exact:true}).click();
 await page.getByRole('textbox',{name:'First name',exact:false}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'First name',exact:false}).inputValue(),'Jessica');
 await page.getByRole('button',{name:'Continue to Services'}).click();
 await page.getByRole('button',{name:/Glam/}).click();
 await page.getByRole('button',{name:/Signature/}).click();
 await page.getByRole('button',{name:'Continue to Review'}).click();
 await page.getByRole('button',{name:'Create as Draft'}).click();
 await page.waitForURL('**/sales/proposals/proposal-1');
 const proposal=mutations.find(m=>m.path==='/proposals');
 assert.equal(proposal.body.client_id,client.id);
 assert.equal(proposal.body.event_id,event.id);
 assert.equal(proposal.body.selected_experiences[0].packages[0].package_id,'package-1');
 assert.equal(mutations.filter(m=>['/clients','/events','/leads'].includes(m.path)).length,0);
 console.log('PASS: three-step proposal draft preserves linked event/client without duplicate creation');
 await page.goto(origin+'/website/hero-slides');
 await page.getByRole('heading',{name:'Hero Slides',exact:true}).waitFor();
 await page.getByRole('img',{name:'LOLA wedding slide'}).waitFor();
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await page.getByRole('dialog',{name:'Edit staging record'}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Caption',exact:true}).inputValue(),'Make it a night to remember');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 if(process.env.SCREENSHOT_DIR){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:process.env.SCREENSHOT_DIR+'/cms-hero-slides.png',fullPage:true});}
 console.log('PASS: CMS visual record preview and unchanged editor fields');
 for(const [path,heading] of [['/sales/leads','Leads'],['/sales/clients','Clients'],['/events/events','Events'],['/sales/proposals','Proposals'],['/finance/invoices','Invoices'],['/finance/payments','Payments'],['/sales/communications','Communications'],['/operations/galleries','Gallery'],['/events/staff','Staff'],['/events/equipment','Equipment'],['/insights/analytics','Reports & Analytics'],['/system/settings','Settings'],['/system/health','System Health']]){
   await page.goto(origin+path);
   await page.getByRole('heading',{name:heading,exact:true}).waitFor();
 }
 console.log('PASS: all priority workspaces render with fixture data');
 await page.setViewportSize({width:390,height:844});
 await page.goto(origin+'/events/events/event-1');
 await page.getByRole('heading',{name:event.event_name,exact:true}).waitFor();
 if(process.env.SCREENSHOT_DIR){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:process.env.SCREENSHOT_DIR+'/mobile-event.png',fullPage:true});}
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 await page.getByRole('link',{name:'Clients',exact:true}).click();
 await page.getByRole('heading',{name:'Clients',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'false');
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'false');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile content should not overflow horizontally');
 console.log('PASS: mobile menu reachable, navigation closes on route change and Escape, no page overflow');
 await page.getByRole('button',{name:'Create a record'}).click();
 await page.getByRole('button',{name:'New Lead',exact:true}).click();
 await page.getByRole('heading',{name:'Leads',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Create a record'}).getAttribute('aria-expanded'),'false');
 console.log('PASS: create menu closes after same-page/query navigation');
 assert.deepEqual(errors,[]);
 console.log('PASS: no browser runtime errors');
}catch(error){console.error('Browser errors:',errors);console.error('Current page:',await page.locator('body').innerText());throw error;}finally{await browser.close();}
