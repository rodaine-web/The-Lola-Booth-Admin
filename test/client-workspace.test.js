import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceView} from '../shared/client-workspace.js';
const proposal={id:'mine',proposal_number:'P-1',status:'ACCEPTED',total:1099,client_name:'Demo Client',event_name:'Wedding',secure_token:'proposal-secret',internal_notes:'Never expose',owner_user_id:'staff-private'};
const invoice={id:'invoice',proposal_id:'mine',invoice_number:'INV-1',status:'PARTIALLY_PAID',total:1099,amount_outstanding:769.3,secure_token:'invoice-secret'};
const base={proposal,documentOrigin:'https://staging.thelolabooth.com',invoices:[invoice]};
test('workspace exposes only issued records from its own proposal',()=>{
 const view=workspaceView({...base,invoices:[invoice,{...invoice,id:'other',proposal_id:'someone-else'},{...invoice,id:'draft',status:'DRAFT'},{...invoice,id:'void',status:'VOID'},{...invoice,id:'deleted',deleted_at:'2026-10-05'}],contracts:[{id:'signed',proposal_id:'mine',status:'SIGNED',title:'Agreement',revision:1,url:'https://stagingadmin.thelolabooth.com/contract/token'},{id:'private',proposal_id:'mine',status:'DRAFT',terms:'Draft private terms'},{id:'cross',proposal_id:'other',status:'SIGNED'},{id:'revoked',proposal_id:'mine',status:'REVOKED'},{id:'expired',proposal_id:'mine',status:'ISSUED',expires_at:'2000-01-01'}]});
 assert.deepEqual(view.invoices.map(i=>i.id),['invoice']);assert.deepEqual(view.agreements.map(c=>c.id),['signed']);
 assert.equal(view.invoices[0].balance,769.3);assert.match(view.proposal.url,/proposal\/proposal-secret$/);
 const serialized=JSON.stringify(view);assert.ok(!serialized.includes('Never expose'));assert.ok(!serialized.includes('owner_user_id'));assert.ok(!serialized.includes('Draft private terms'));assert.ok(!serialized.includes('someone-else'));
});
test('workspace never links pending or unrelated payment receipts',()=>{
 const view=workspaceView({...base,payments:[{id:'paid',invoice_id:'invoice',status:'SUCCEEDED',amount:329.7},{id:'pending',invoice_id:'invoice',status:'PENDING'},{id:'cross',invoice_id:'other',status:'SUCCEEDED'},{id:'deleted',invoice_id:'invoice',status:'SUCCEEDED',deleted_at:'2026-10-05'}]});
 assert.deepEqual(view.receipts.map(r=>r.id),['paid']);assert.match(view.receipts[0].url,/receipt\/invoice-secret\/paid$/);
});
test('revoked document links cannot be recovered through a workspace',()=>{
 const view=workspaceView({...base,proposal:{...proposal,token_revoked_at:'2026-10-05'},invoices:[{...invoice,token_revoked_at:'2026-10-05'}],payments:[{id:'paid',invoice_id:'invoice',status:'SUCCEEDED'}]});
 assert.equal(view.proposal.url,null);assert.equal(view.invoices[0].url,null);assert.equal(view.receipts.length,0);
});
test('zero authoritative balance stays zero despite legacy balance',()=>{
 assert.equal(workspaceView({...base,invoices:[{...invoice,amount_outstanding:0,balance_due:1099}]}).invoices[0].balance,0);
});

test('planning workspace includes event agreements without exposing another event or client',()=>{
 const agreement={id:'signed',proposal_id:'accepted-proposal',event_id:'event',client_id:'client',status:'SIGNED',title:'Signed event agreement',revision:2,url:'https://example.com/contract/token',terms:'Private terms',signer_ip:'Private IP'};
 const view=workspaceView({proposal:{...proposal,id:null},eventScope:{eventId:'event',clientId:'client'},documentOrigin:base.documentOrigin,contracts:[agreement,{...agreement,id:'different-event',event_id:'other'},{...agreement,id:'different-client',client_id:'other'},{...agreement,id:'draft',status:'DRAFT'},{...agreement,id:'revoked',status:'REVOKED'},{...agreement,id:'expired',status:'ISSUED',expires_at:'2000-01-01'},{...agreement,id:'issued',status:'ISSUED',expires_at:'2099-01-01'}]});
 assert.deepEqual(view.agreements.map(row=>row.id),['signed','issued']);
 assert.equal(view.agreements[0].url,agreement.url);
 const serialized=JSON.stringify(view);
 assert.ok(!serialized.includes('Private terms'));assert.ok(!serialized.includes('Private IP'));
 assert.ok(!serialized.includes('different-client'));assert.ok(!serialized.includes('different-event'));
});
