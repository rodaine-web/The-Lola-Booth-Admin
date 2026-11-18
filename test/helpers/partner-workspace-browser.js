import os from 'node:os';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

export async function qualifyPartnerBrowser(origin,invitation){
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(`${origin}/partner-workspace#token=${invitation}`);
  try{await page.getByRole('heading',{name:'Authorized events',exact:true}).waitFor({timeout:10000});}
  catch(error){throw new Error('Partner browser failed: '+JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(0,2000)}),{cause:error});}
  assert.equal(new URL(page.url()).hash,'','invitation removed from browser URL');
  await page.getByText('QA ONLY',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Open event',exact:true}).click();await page.getByRole('heading',{name:'QA ONLY',exact:true}).waitFor();
  await page.getByRole('link',{name:'QA-venue.txt',exact:true}).waitFor();
  await page.getByLabel('Message',{exact:true}).fill('Synthetic partner event request');await page.getByRole('button',{name:'Send event request',exact:true}).click();await page.getByText('Synthetic partner event request · open',{exact:true}).waitFor();
  const cookie=(await page.context().cookies()).find(c=>c.name==='lola_partner_workspace_invite');
  assert.ok(cookie?.httpOnly);assert.equal(cookie.path,'/api/partner-workspaces');
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>/partner|invite/i.test(key))),false);
  await page.reload();await page.getByRole('heading',{name:'Authorized events',exact:true}).waitFor();
  await mkdir(os.tmpdir()+'/lola-workspace-browser-20261112',{recursive:true});
  await page.screenshot({path:os.tmpdir()+'/lola-workspace-browser-20261112/partner-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'partner workspace fits mobile');
  await page.screenshot({path:os.tmpdir()+'/lola-workspace-browser-20261112/partner-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'Authorized events',exact:true}).count(),0);
  assert.equal((await page.context().cookies()).some(c=>c.name==='lola_partner_workspace_invite'&&c.value),false,'sign-out clears reentry cookie');
  await page.reload();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('heading',{name:'Authorized events',exact:true}).count(),0);
  assert.deepEqual(errors,[],'no unhandled browser errors');
 }finally{await browser.close();}
}
