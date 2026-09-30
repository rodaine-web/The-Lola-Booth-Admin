import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { documentAccessState, secureDocumentUrl } from '../shared/document-access.js';
import { galleryEnabled } from '../shared/features.js';

if (process.env.GALLERY_TEST_DATABASE_URL) process.env.DATABASE_URL=process.env.GALLERY_TEST_DATABASE_URL;
const origin='https://thelolabooth.com';
for (const [label,record,state] of [
  ['valid',{secure_token:'a'.repeat(48)},'AVAILABLE'],
  ['missing',{secure_token:null},'MISSING'],
  ['literal null',{secure_token:'null'},'MISSING'],
  ['blank',{secure_token:'  '},'MISSING'],
  ['revoked',{secure_token:'b'.repeat(48),token_revoked_at:'2026-01-01'},'REVOKED'],
  ['expired',{secure_token:'c'.repeat(48),token_expires_at:'2000-01-01'},'EXPIRED'],
]) test(`document capability: ${label}`,()=>{
  assert.equal(documentAccessState(record),state);
  for(const kind of ['pay','invoice','proposal','receipt']) {
    const url=secureDocumentUrl(origin,kind,record);
    assert.equal(url,state==='AVAILABLE'?`${origin}/${kind}/${record.secure_token}`:null);
  }
});
test('Gallery production exclusion and explicit staging flag',()=>{
  assert.equal(galleryEnabled({APP_ENV:'production',GALLERY_ENABLED:'true'}),false);
  assert.equal(galleryEnabled({APP_ENV:'staging',GALLERY_ENABLED:'false'}),false);
  assert.equal(galleryEnabled({APP_ENV:'staging',GALLERY_ENABLED:'true'}),true);
  assert.equal(galleryEnabled({VITE_APP_ENV:'production',VITE_GALLERY_ENABLED:'false'}),false);
});

test('missing and revoked invoice PDFs contain no public link or payment QR',async()=>{
  process.env.APP_ENV='test';process.env.NODE_ENV='test';
  const {generateInvoicePdf,proposalHtml}=await import('../server/src/services/document-service.js');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  for(const record of [{secure_token:null},{secure_token:'revoked-token',token_revoked_at:'2026-01-01'},{secure_token:'expired-token',token_expires_at:'2000-01-01'}]){
    const buffer=await generateInvoicePdf({...record,invoice_number:'TOKEN-QA',client_name:'Synthetic QA',items:[],total:100,amount_outstanding:100});
    const pdf=await getDocument({data:new Uint8Array(buffer),useSystemFonts:true}).promise;
    let text='';
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n);text+=(await page.getTextContent()).items.map(x=>x.str).join(' ');
      assert.equal((await page.getAnnotations()).filter(x=>x.url&&/\/(pay|invoice)\//.test(x.url)).length,0);
    }
    assert.match(text,/Public access not available/);assert.doesNotMatch(text,/SCAN TO PAY|PAY ONLINE/);
    assert.doesNotMatch(proposalHtml({...record,proposal_source:'UPLOADED',proposal_number:'QA'}),/href="[^"]*\/(null|undefined)(?:\/|"|\?)/);
    await pdf.cleanup();
  }
});

test('token recovery is atomic, audited and preserves valid access', {skip:!process.env.GALLERY_TEST_DATABASE_URL},async()=>{
  const database=process.env.GALLERY_TEST_DATABASE_URL;const url=new URL(database);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname.endsWith('_qa'));
  Object.assign(process.env,{DATABASE_URL:database,APP_ENV:'test',NODE_ENV:'test'});
  const {query,pool}=await import('../server/src/db/pool.js');
  const {recoverDocumentAccess}=await import('../server/src/services/document-access-service.js');
  const records=[];
  try {
    for(const kind of ['invoices','proposals']){
      const number=kind==='invoices'?'invoice_number':'proposal_number';
      const row=(await query(`INSERT INTO ${kind}(${number},secure_token,status) VALUES($1,NULL,'DRAFT') RETURNING id`,['ACCESS-QA-'+crypto.randomUUID()])).rows[0];records.push([kind,row.id]);
      const request={user:{},headers:{},ip:'127.0.0.1'};
      const results=await Promise.all([recoverDocumentAccess(kind,row.id,request),recoverDocumentAccess(kind,row.id,request)]);
      assert.equal(results.filter(r=>r.changed).length,1);
      const token=(await query(`SELECT secure_token FROM ${kind} WHERE id=$1`,[row.id])).rows[0].secure_token;
      assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(token,row.id);
      const again=await recoverDocumentAccess(kind,row.id,request);assert.equal(again.changed,false);
      assert.equal((await query(`SELECT secure_token FROM ${kind} WHERE id=$1`,[row.id])).rows[0].secure_token,token);
      const audits=(await query("SELECT * FROM audit_logs WHERE entity_id=$1 AND action='document_access_generated'",[row.id])).rows;
      assert.equal(audits.length,1);assert.ok(!JSON.stringify(audits).includes(token));
    }
  } finally {
    for(const [kind,id] of records){await query('DELETE FROM audit_logs WHERE entity_id=$1',[id]);await query(`DELETE FROM ${kind} WHERE id=$1`,[id]);}
    await pool.end();
  }
});
