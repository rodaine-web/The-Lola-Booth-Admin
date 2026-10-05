import test from 'node:test';
import assert from 'node:assert/strict';
import {contractDeliveryDecision,contractDeliveryFailure} from '../shared/contract-delivery.js';
import {contractEmailMessage} from '../server/src/services/contract-delivery-service.js';
import {stagingEmailPolicy} from '../server/src/config/staging-safety.js';

test('delivery repeats accepted sends without re-sending and holds ambiguous attempts',()=>{
 assert.equal(contractDeliveryDecision(null),'SEND');
 assert.equal(contractDeliveryDecision({status:'SENT_TO_PROVIDER'}),'COMPLETE');
 for(const status of ['PROCESSING','UNKNOWN'])assert.equal(contractDeliveryDecision({status}),'REVIEW');
 assert.equal(contractDeliveryDecision({status:'FAILED',attempt_count:2}),'SEND');
 assert.equal(contractDeliveryDecision({status:'FAILED',attempt_count:3}),'EXHAUSTED');
 assert.equal(contractDeliveryDecision({status:'DEVELOPMENT_ONLY',attempt_count:10}),'SEND');
});
test('provider timeouts and server errors are held even when a general error code resembles rejection',()=>{
 for(const error of [{code:'MICROSOFT_REQUEST_TIMEOUT'},{code:'MICROSOFT_SEND_FAILED',details:{outcomeUnknown:true,status:408}},{code:'MICROSOFT_TEMPORARY_FAILURE',details:{outcomeUnknown:true,status:503}},{code:'ECONNRESET'}])assert.equal(contractDeliveryFailure(error).status,'UNKNOWN');
 for(const code of ['MICROSOFT_RATE_LIMITED','MICROSOFT_TOKEN_FAILED','MICROSOFT_SEND_FORBIDDEN','STAGING_RECIPIENT_BLOCKED','CONTRACT_CHANGED'])assert.equal(contractDeliveryFailure({code}).status,'FAILED');
});
test('agreement email uses recorded client email, HTML links and no PDF attachment',()=>{
 const contract={status:'ISSUED',title:'Event agreement',snapshot:{client_name:'Demo Client',client_email:'demo@example.com',event_name:'Wedding',proposal_number:'P-1'}};
 const url='https://stagingadmin.thelolabooth.com/contract/secure-demo';
 const message=contractEmailMessage(contract,url);
 assert.equal(message.to,'demo@example.com');assert.match(message.html,/Review &amp; Sign Agreement|Review & Sign Agreement/);assert.ok(message.html.includes(url));assert.deepEqual(message.attachments,[]);assert.ok(message.html.includes('?download=pdf'));
 assert.match(contractEmailMessage({...contract,status:'SIGNED'},url).subject,/signed agreement/);
 const config={APP_ENV:'staging',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_ALLOWLIST:'approved@example.com'};
 assert.throws(()=>stagingEmailPolicy(message,config),error=>error.code==='STAGING_RECIPIENT_BLOCKED');
});
