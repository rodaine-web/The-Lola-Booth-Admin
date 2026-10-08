import test from 'node:test';
import assert from 'node:assert/strict';
import {planningRequirements,planningCompletion,validPlanningUpload,BACKDROP_COLLECTION,normalizedPlanningValue} from '../shared/event-planning.js';
import {safeRequestLog} from '../server/src/utils/request-log.js';
test('multi-experience planning collects shared information once and only includes relevant questions',()=>{
 const requirements=planningRequirements([{name:'LOLA Glam'},{name:'LOLA 360'},{name:'Audio Guestbook'}],true);
 assert.equal(requirements.filter(key=>key==='theme').length,1);assert.equal(requirements.filter(key=>key==='assets').length,1);
 for(const key of ['backdrop','print_design','music','greeting','phone_placement'])assert.ok(requirements.includes(key));
 const audio=planningRequirements([{name:'Audio Guestbook'}]);assert.ok(!audio.includes('backdrop'));assert.ok(!audio.includes('print_design'));
 assert.equal(BACKDROP_COLLECTION.length,10);
});
test('readiness denominator excludes irrelevant backdrop/assets; missing applicable items remain incomplete',()=>{
 const brief={event_name:'Demo',event_type:'Wedding',event_date:'2026-11-10',start_time:'18:00',end_time:'22:00',venue_name:'Venue',primary_contact_phone:'5551234567',primary_contact_name:'Client',primary_contact_email:'client@example.com',theme:'Romantic',colors:['#ffffff']};
 const audio=planningCompletion(brief,planningRequirements(['Audio Guestbook']),false,0);assert.equal(audio.length,6);assert.equal(audio.filter(item=>!item.complete).length,3);
 for(const key of ['greeting','phone_placement','signage'])brief[key]='Client instructions';
 assert.ok(planningCompletion(brief,planningRequirements(['Audio Guestbook']),false,0).every(item=>item.complete));
 const glam=planningCompletion(brief,planningRequirements(['LOLA Glam']),false,0);assert.equal(glam.length,5);assert.equal(glam.filter(item=>!item.complete).length,2);
});
test('upload rejects active formats, MIME mismatch, empty and oversized data; accepts supported signatures',()=>{
 assert.equal(validPlanningUpload(Buffer.from('<svg onload="alert(1)"/>'),'image/svg+xml'),false);
 assert.equal(validPlanningUpload(Buffer.from('<html>bad</html>'),'image/png'),false);
 assert.equal(validPlanningUpload(Buffer.alloc(0),'application/pdf'),false);
 assert.equal(validPlanningUpload(Buffer.alloc(8*1024*1024+1),'image/jpeg'),false);
 assert.equal(validPlanningUpload(Buffer.from('%PDF-1.7\nDemo'),'application/pdf'),true);
 assert.equal(validPlanningUpload(Buffer.from([137,80,78,71,13,10,26,10]),'image/png'),true);
 assert.equal(validPlanningUpload(Buffer.from([255,216,255,224]),'image/jpeg'),true);
});
test('planning token and query string are redacted from HTTP logs including file downloads',()=>{
 const token='a'.repeat(64);assert.equal(safeRequestLog({url:'/api/public/planning/'+token+'/assets/demo?secret=token'}).url,'/api/public/planning/[redacted]/assets/demo');
});

test('protected time comparisons normalize database seconds without concealing date or venue changes',()=>{
 assert.equal(normalizedPlanningValue('start_time','18:00:00'),normalizedPlanningValue('start_time','18:00'));
 assert.notEqual(normalizedPlanningValue('event_date','2026-11-10'),normalizedPlanningValue('event_date','2026-11-11'));
 assert.notEqual(normalizedPlanningValue('venue_name','Venue A'),normalizedPlanningValue('venue_name','Venue B'));
});

test('event details cannot be submitted when the venue or booked timing is missing',()=>{
 const brief={event_name:'Demo',primary_contact_name:'Client',primary_contact_email:'client@example.com'};
 assert.equal(planningCompletion(brief,['event_details'],false,0)[0].complete,false);
});
