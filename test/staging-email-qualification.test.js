import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedQualificationJobs} from '../server/src/services/staging-email-qualification-service.js';
import {MicrosoftEmailProvider} from '../server/src/services/email-service.js';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
test('qualification worker fails closed without enablement and explicit bounded IDs',()=>{
 assert.deepEqual(selectedQualificationJobs({APP_ENV:'staging',STAGING_EMAIL_ENABLED:'false',STAGING_EMAIL_JOB_IDS:id}),[]);
 assert.deepEqual(selectedQualificationJobs({APP_ENV:'staging',STAGING_EMAIL_ENABLED:'true'}),[]);
 assert.deepEqual(selectedQualificationJobs({APP_ENV:'production',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_JOB_IDS:id}),[]);
 assert.deepEqual(selectedQualificationJobs({APP_ENV:'staging',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_JOB_IDS:id}),[id]);
 assert.throws(()=>selectedQualificationJobs({APP_ENV:'staging',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_JOB_IDS:'all'}));
 assert.throws(()=>selectedQualificationJobs({APP_ENV:'staging',STAGING_EMAIL_ENABLED:'true',STAGING_EMAIL_JOB_IDS:Array(9).fill(id).join(',')}));
});
test('network interruption while sending is ambiguous; token failure is safe to retry',async()=>{
 const provider=new MicrosoftEmailProvider({fetchImpl:async()=>{throw Error('disconnected');}});
 await assert.rejects(()=>provider.fetchWithTimeout('https://graph.microsoft.com/v1.0/users/qa/sendMail',{}),e=>e.details.outcomeUnknown===true&&e.details.retryable===false);
 await assert.rejects(()=>provider.fetchWithTimeout('https://login.microsoftonline.com/tenant/token',{}),e=>e.details.outcomeUnknown===false&&e.details.retryable===true);
});
