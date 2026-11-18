import test from 'node:test';import assert from 'node:assert/strict';
import {liveLobReady,liveBatchBudget} from '../shared/gallery-live-policy.js';
test('live mailing requires production, explicit opt-in and distinct live credentials',()=>{
 const ready={APP_ENV:'production',GALLERY_MAILING_LIVE_ENABLED:'true',LOB_LIVE_API_KEY:'live_synthetic_only',LOB_LIVE_WEBHOOK_SECRET:'synthetic-webhook-secret'};assert.equal(liveLobReady(ready),true);
 for(const change of [{APP_ENV:'development'},{APP_ENV:'staging'},{GALLERY_MAILING_LIVE_ENABLED:'false'},{LOB_LIVE_API_KEY:'test_synthetic'},{LOB_LIVE_API_KEY:'live_pub_synthetic'},{LOB_LIVE_WEBHOOK_SECRET:''}])assert.equal(liveLobReady({...ready,...change}),false);
});
test('live quantity and all-in reservation cannot exceed the approved total',()=>{
 assert.equal(liveBatchBudget({quantity:3,cost_limit_cents:600,unit_cost_cents:200}),true);
 for(const change of [{quantity:0},{quantity:501},{quantity:3.5},{cost_limit_cents:599},{cost_limit_cents:NaN},{unit_cost_cents:0}])assert.equal(liveBatchBudget({quantity:3,cost_limit_cents:600,unit_cost_cents:200,...change}),false);
});

import {lobPrintTestEnabled} from '../shared/postcard-print-policy.js';
test('production TEST mode has an independent opt-in and never follows staging flags',()=>{
 assert.equal(lobPrintTestEnabled({APP_ENV:'production',LOB_PRODUCTION_TEST_ENABLED:'true'}),true);
 assert.equal(lobPrintTestEnabled({APP_ENV:'production',LOB_STAGING_TEST_ENABLED:'true'}),false);
 assert.equal(lobPrintTestEnabled({APP_ENV:'staging',LOB_PRODUCTION_TEST_ENABLED:'true'}),false);
 assert.equal(liveLobReady({APP_ENV:'production',LOB_PRODUCTION_TEST_ENABLED:'true'}),false);
});
