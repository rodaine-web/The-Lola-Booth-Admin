import test from 'node:test';
import assert from 'node:assert/strict';
import {leadRequestFingerprint,hasCurrentAvailability} from '../server/src/services/lead-availability-service.js';
const lead={event_date:'2030-12-01',event_start_time:'18:00:00',event_end_time:'22:00:00',venue_address:'QA venue',email:'qa@example.invalid',status:'NEW',source_details:{bookingInquiry:{selections:[{pricingMode:'FIXED',packageId:'standard'},{pricingMode:'CUSTOM',packageId:'custom'}],addons:[]}}};
test('availability approval is bound to current request, staff and active lead',()=>{
 assert.equal(hasCurrentAvailability(lead),false);
 const approved={...lead,availability_confirmed_at:'2030-01-01',availability_confirmed_by:'staff',availability_fingerprint:leadRequestFingerprint(lead)};
 assert.equal(hasCurrentAvailability(approved),true);
 for(const patch of [{event_date:'2030-12-02'},{event_start_time:'19:00:00'},{email:'other@example.invalid'},{venue_address:'other'},{status:'LOST'},{deleted_at:'2030-01-01'},{availability_confirmed_by:null}])assert.equal(hasCurrentAvailability({...approved,...patch}),false);
 assert.equal(hasCurrentAvailability({...approved,notes:'Staff note',updated_at:'now'}),true);
 assert.equal(hasCurrentAvailability(approved,'old-job'),false);
});
