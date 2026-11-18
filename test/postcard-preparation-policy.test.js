import test from 'node:test';
import assert from 'node:assert/strict';
import {postcardPreparationEnabled,lobPrintTestEnabled} from '../shared/postcard-print-policy.js';
test('production private artwork preparation is separately enabled from dispatch',()=>{
 const config={APP_ENV:'production',GALLERY_ENABLED:'true',GALLERY_POSTCARD_PREPARATION_ENABLED:'true',LOB_PRODUCTION_TEST_ENABLED:'false',GALLERY_MAILING_LIVE_ENABLED:'false',GALLERY_MAILING_LIVE_WORKER_ENABLED:'false'};
 assert.equal(postcardPreparationEnabled(config),true);assert.equal(lobPrintTestEnabled(config),false);
 assert.equal(postcardPreparationEnabled({...config,GALLERY_POSTCARD_PREPARATION_ENABLED:'false'}),false);
 assert.equal(postcardPreparationEnabled({...config,GALLERY_ENABLED:'false'}),false);
 assert.equal(postcardPreparationEnabled({APP_ENV:'production',NODE_ENV:'test'}),false);
 assert.equal(postcardPreparationEnabled({APP_ENV:'production',LOB_PRODUCTION_TEST_ENABLED:'true'}),true);
 for(const APP_ENV of ['development','test','staging'])assert.equal(postcardPreparationEnabled({APP_ENV}),true);
 assert.equal(postcardPreparationEnabled({APP_ENV:'unknown'}),false);
});
