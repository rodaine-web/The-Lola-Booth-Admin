const named=value=>new RegExp('^'+RegExp.escape(value)+'$','i');
import assert from 'node:assert/strict';
export async function verifyPreStagingAccessibility({page,context,base,report,records}){
 const cases=[['Dashboard','/'],['Lead form','/sales/leads'],['Proposal editor','/sales/proposals/new'],['Invoice','/finance/invoices/new'],['Communications','/sales/communications'],['User dialog','/system/users'],['Integrations','/system/integrations'],['Settings','/system/settings'],['Payment page','/pay']];
 for(const [name,url] of cases){
  await page.goto(base+url);await page.locator('main h1').waitFor();await page.waitForLoadState('networkidle');
  if(name==='Lead form')await page.getByRole('button',{name:'New Lead',exact:true}).click();
  if(name==='User dialog')await page.getByRole('button',{name:'Create User',exact:true}).click();
  const labels=await page.locator('main input,main select,main textarea').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length&&e.type!=='hidden'&&!(e.labels?.length||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby'))).map(e=>({tag:e.tagName,placeholder:e.placeholder,type:e.type})));
  report.accessibility.push({name,unlabelledFields:labels});assert.deepEqual(labels,[],name+' unlabeled controls');
  await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body),name+' keyboard focus');
  if(['Lead form','User dialog'].includes(name)){const dialog=page.getByRole('dialog');assert.ok(await dialog.evaluate(d=>d.contains(document.activeElement)));await page.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(d=>d.contains(document.activeElement)));await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});}
 }
 let fail=true;await context.route('**/api/integrations/catalog',route=>fail?route.fulfill({status:500,json:{error:{message:'Synthetic integration failure'}}}):route.fallback());await page.goto(base+'/system/integrations');await page.getByText('Synthetic integration failure',{exact:false}).first().waitFor();fail=false;await page.getByRole('button',{name:/try again|retry/i}).first().click();await page.getByRole('heading',{name:'Google Analytics'}).waitFor();await context.unroute('**/api/integrations/catalog');report.failures.push({case:'Integrations 500 and retry recovery',status:'PASS'});
 let offline=true;await context.route('**/api/settings',route=>offline?route.abort('internetdisconnected'):route.fallback());await page.goto(base+'/system/settings');await page.getByRole('alert').waitFor();offline=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByLabel(named('Business Name')).waitFor();await context.unroute('**/api/settings');report.failures.push({case:'Settings network outage and UI retry',status:'PASS'});
 await context.route('**/api/auth/me',route=>route.fulfill({status:401,json:{error:{message:'Your session has expired.'}}}));await page.goto(base+'/system/settings');await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();await context.unroute('**/api/auth/me');await page.goto(base+'/system/integrations');await page.getByRole('heading',{name:'Google Analytics'}).waitFor();report.failures.push({case:'Stale session returns to sign-in without blank screen',status:'PASS'});
 for(const provider of ['GA4','Meta','TikTok']){await page.getByRole('button',{name:`Test ${provider} Payload`,exact:true}).click();await page.getByRole('status').filter({hasText:'Payload validated'}).waitFor();}
}
