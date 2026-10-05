import test from 'node:test';
import assert from 'node:assert/strict';
import {contractsEnabled, signingDecision, CONTRACT_CONSENT, contractDocument, proposalAllowsAgreement} from '../shared/contracts.js';
import crypto from 'node:crypto';
const contract={status:'ISSUED',document_hash:'original',snapshot:{client_email:'client@example.com'}};
const input={name:'Demo Client',email:'CLIENT@example.com',consent:true,documentHash:'original'};
test('V1.1 contracts are staging/local only, including production with an accidental feature flag',()=>{
 assert.equal(contractsEnabled({APP_ENV:'staging',NODE_ENV:'production'}),true);
 assert.equal(contractsEnabled({NODE_ENV:'test'}),true);
 assert.equal(contractsEnabled({APP_ENV:'production',CONTRACTS_ENABLED:'true'}),false);
 assert.equal(contractsEnabled({NODE_ENV:'production'}),false);
 assert.equal(contractsEnabled({APP_ENV:'unknown'}),false);
});
test('signing requires explicit consent, correct recipient and current document',()=>{
 assert.deepEqual(signingDecision(contract,input),{replay:false});
 assert.equal(signingDecision(contract,{...input,consent:false}).error,'CONSENT_REQUIRED');
 assert.equal(signingDecision(contract,{...input,documentHash:'changed'}).error,'CONTRACT_CHANGED');
 assert.equal(signingDecision(contract,{...input,email:'someone@example.com'}).error,'SIGNER_EMAIL_MISMATCH');
 for(const status of ['DRAFT','REVOKED']) assert.equal(signingDecision({...contract,status},input).error,'CONTRACT_STATE');
});
test('same signed submission replays safely; another signer cannot overwrite signature',()=>{
 const signed={...contract,status:'SIGNED',signer_name:input.name,signer_email:'client@example.com'};
 assert.deepEqual(signingDecision(signed,input),{replay:true});
 assert.equal(signingDecision(signed,{...input,name:'Other Client'}).error,'CONTRACT_STATE');
 assert.equal(signingDecision(signed,{...input,documentHash:'changed'}).error,'CONTRACT_CHANGED');
});
test('document fingerprint includes exact terms and selected event/services',()=>{
 const hash=(terms,snapshot)=>crypto.createHash('sha256').update(contractDocument('Agreement',terms,snapshot)).digest('hex');
 const snapshot={event_name:'Wedding',items:[{description:'360 Signature',quantity:1,unit_price:1099}]};
 assert.equal(hash('Original',snapshot),hash('Original',{items:[{unit_price:1099,quantity:1,description:'360 Signature'}],event_name:'Wedding'}));
 assert.notEqual(hash('Original',snapshot),hash('Revised',snapshot));
 assert.notEqual(hash('Original',snapshot),hash('Original',{...snapshot,event_name:'Corporate'}));
 assert.notEqual(hash('Original',snapshot),hash('Original',{...snapshot,items:[]}));
 assert.match(CONTRACT_CONSENT,/intend my typed name to be my signature/);
});
test('production rollout gate leaves existing admin endpoints reachable',async()=>{
 const {contractsRouter,publicContractsRouter}=await import('../server/src/routes/contracts.js');
 const original=process.env.APP_ENV;process.env.APP_ENV='production';
 async function dispatch(router,url){return new Promise(resolve=>router.handle({method:'GET',url,headers:{}},{set(){}},error=>resolve(error)));}
 try{
  assert.equal(await dispatch(contractsRouter,'/health'),undefined);
  assert.equal(await dispatch(contractsRouter,'/proposals/demo'),undefined);
  assert.equal((await dispatch(contractsRouter,'/proposals/demo/workspace')).statusCode,404);
  assert.equal((await dispatch(contractsRouter,'/proposals/demo/contracts')).statusCode,404);
  assert.equal((await dispatch(publicContractsRouter,'/a-token')).statusCode,404);
 }finally{if(original===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=original;}
});
test('signed agreement PDF preserves long service terms and signature across pages',async()=>{
 const {contractPdf}=await import('../server/src/services/contract-service.js');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const pdf=await contractPdf({title:'Demo Agreement',revision:1,status:'SIGNED',terms:'Service responsibilities and cancellation details.\n'.repeat(150),snapshot:{proposal_number:'V11-DEMO',client_name:'Demo Client',total:'1099',items:[{description:'360 Signature',quantity:1,unit_price:1099}]},document_hash:'a'.repeat(64),signed_at:'2026-10-05T12:00:00Z',signer_name:'Demo Client',signer_email:'client@example.com',consent_text:CONTRACT_CONSENT});
 const loadingTask=getDocument({data:new Uint8Array(pdf),useSystemFonts:true});const document=await loadingTask.promise;
 let text='';for(let i=1;i<=document.numPages;i++){text+=(await (await document.getPage(i)).getTextContent()).items.map(item=>item.str).join(' ');}
 assert.ok(document.numPages>1);assert.match(text,/360 Signature/);assert.match(text,/Electronic signature/);assert.match(text,/client@example.com/);assert.match(text,/Document SHA-256/);await loadingTask.destroy();
});
test('contract delivery and workspace access enforce sales permissions before reading any data',async()=>{
 const {contractsRouter}=await import('../server/src/routes/contracts.js');
 const original=process.env.APP_ENV;process.env.APP_ENV='staging';
 const id='5f91bf0a-701f-4712-a2ca-19c1ebd71c05';
 try{
  for(const [method,url] of [['GET',`/contracts/${id}/pdf`],['POST',`/contracts/${id}/access`],['POST',`/contracts/${id}/send`],['POST',`/proposals/${id}/workspace`],['POST',`/proposals/${id}/workspace/revoke`]]){
   const error=await new Promise(resolve=>contractsRouter.handle({method,url,headers:{},user:{permissions:[]}}, {set(){}},resolve));
   assert.equal(error.statusCode,403,`${method} ${url} must reject unprivileged users`);
  }
 }finally{if(original===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=original;}
});

test('agreements remain available after an accepted proposal becomes an invoice',()=>{
 for(const status of ['ACCEPTED','CONVERTED']) assert.equal(proposalAllowsAgreement(status),true);
 for(const status of ['DRAFT','READY','SENT','VIEWED','DECLINED','EXPIRED','ARCHIVED',undefined]) assert.equal(proposalAllowsAgreement(status),false);
});
