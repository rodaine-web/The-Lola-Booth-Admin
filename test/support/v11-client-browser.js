import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import {env} from '../../server/src/config/env.js';

// Runs only with the disposable database API fixture. No hosted credentials or
// external email/payment adapters are used by this browser qualification.
export async function verifyClientBrowser({api,origin,proposalId,workspaceToken}){
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const vite=await createServer({configFile:false,root,plugins:[react()],define:{__BUILD_REVISION__:JSON.stringify('v11-browser-qualification')},server:{host:'127.0.0.1',port:0,proxy:{'/api':origin}}});
 let browser;const previousOrigin=env.clientOrigin;
 const evidence=new URL('../../artifacts/v11-browser/',import.meta.url);await fs.mkdir(evidence,{recursive:true});
 try{
  await vite.listen();const base=`http://127.0.0.1:${vite.httpServer.address().port}`;env.clientOrigin=base;
  const draft=await api(`/proposals/${proposalId}/contracts`,{method:'POST',body:{title:'Browser demo agreement',terms:'Approved demo terms for browser verification only. A deposit confirms the booking.'}});assert.equal(draft.status,201);
  const issued=await api(`/contracts/${draft.data.id}/issue`,{method:'POST'});assert.equal(issued.status,200);
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(issued.data.signing_url);
  await page.getByRole('heading',{name:'Browser demo agreement',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Sign agreement',exact:true}).isDisabled(),true);
  await page.getByLabel('Full name',{exact:true}).fill('Demo Client');
  await page.getByLabel('Client email',{exact:true}).fill('wrong@example.com');
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Sign agreement',exact:true}).click();
  await page.getByRole('alert').waitFor();assert.ok((await page.getByRole('alert').innerText()).length>0);
  await page.getByLabel('Client email',{exact:true}).fill('demo@example.com');await page.getByRole('button',{name:'Sign agreement',exact:true}).click();
  await page.getByRole('heading',{name:'Agreement signed',exact:true}).waitFor();
  await page.screenshot({path:fileURLToPath(new URL('signed-desktop.png',evidence)),fullPage:true});
  const pdfLink=await page.getByRole('link',{name:'Download signed copy PDF',exact:true}).getAttribute('href');
  const pdf=await page.request.get(new URL(pdfLink,base).href);assert.equal(pdf.status(),200);assert.equal((await pdf.body()).subarray(0,4).toString(),'%PDF');
  await page.reload();await page.getByRole('heading',{name:'Agreement signed',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Agreement must fit mobile width');
  await page.screenshot({path:fileURLToPath(new URL('signed-mobile.png',evidence)),fullPage:true});
  await page.goto(`${base}/client/${workspaceToken}`);await page.getByRole('heading',{name:'Your agreements',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Browser demo agreement',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'View signed agreement',exact:true}).count(),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Workspace must fit mobile width');
  await page.screenshot({path:fileURLToPath(new URL('workspace-mobile.png',evidence)),fullPage:true});
  await api(`/proposals/${proposalId}/workspace/revoke`,{method:'POST'});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('heading',{name:'Your agreements',exact:true}).count(),0,'Revoked workspace clears customer records');
  assert.deepEqual(pageErrors,[],'No uncaught browser errors');
  await fs.writeFile(new URL('result.json',evidence),JSON.stringify({status:'passed',checks:['wrong-email rejected','explicit consent','browser signing','PDF download','reload persistence','desktop/mobile layout','workspace agreements','workspace revocation','no uncaught browser errors']},null,2));
 }finally{env.clientOrigin=previousOrigin;if(browser)await browser.close();await vite.close();}
}
