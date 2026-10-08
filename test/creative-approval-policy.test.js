import test from 'node:test';
import assert from 'node:assert/strict';
import {creativeAccess,creativeResponseError,publicCreativeView} from '../shared/creative-approval-policy.js';
const now=Date.now(), proof={status:'VIEWED',version:2,expires_at:new Date(now+86400000).toISOString(),client_id:'client',public_token:'secret',proof_document_id:'private-file',metadata:{internal:'private'}};
const input={action:'approve',version:2,name:'Demo Client',email:'client@example.com'};
test('expired, revoked, cancelled, draft and deleted proofs cannot be accessed or approved',()=>{
 for(const status of ['DRAFT','REVOKED','CANCELLED','EXPIRED','SUPERSEDED'])assert.equal(creativeAccess({...proof,status},now),false);
 for(const expires_at of [null,'invalid',new Date(now-1).toISOString()])assert.equal(creativeAccess({...proof,expires_at},now),false);
 assert.equal(creativeAccess({...proof,deleted_at:new Date()},now),false);
 assert.equal(creativeResponseError({...proof,status:'DRAFT'},input,now),'APPROVAL_ACCESS_UNAVAILABLE');
});
test('stale or omitted reviewed version is rejected; draft replacement cannot be approved',()=>{
 assert.equal(creativeResponseError(proof,{...input,version:1},now),'APPROVAL_VERSION_CHANGED');
 assert.equal(creativeResponseError(proof,{...input,version:undefined},now),'APPROVAL_VERSION_CHANGED');
 assert.equal(creativeResponseError({...proof,version:3,status:'DRAFT'},input,now),'APPROVAL_ACCESS_UNAVAILABLE');
 assert.equal(creativeResponseError(proof,input,now),null);
});
test('change request requires comments and prevents reapproval until a new revision is issued',()=>{
 assert.equal(creativeResponseError(proof,{...input,action:'request_changes',notes:' '},now),'APPROVAL_COMMENTS_REQUIRED');
 assert.equal(creativeResponseError(proof,{...input,action:'request_changes',notes:'Please adjust logo'},now),null);
 assert.equal(creativeResponseError({...proof,status:'CHANGES_REQUESTED'},input,now),'APPROVAL_REVISION_REQUIRED');
 assert.equal(creativeResponseError({...proof,status:'APPROVED'},{...input,action:'request_changes',notes:'late change'},now),'APPROVAL_LOCKED');
 assert.equal(creativeResponseError({...proof,status:'APPROVED'},input,now),null);
});
test('public response strips capability tokens, internal metadata and file ownership identifiers',()=>{
 const view=publicCreativeView(proof);
 for(const key of ['public_token','metadata','client_id','event_id','proof_document_id','created_by','approval_snapshot'])assert.equal(key in view,false);
 assert.equal(view.hasDocument,true);assert.equal(view.version,2);
});
