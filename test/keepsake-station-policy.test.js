import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_STATION_POLICY as policy,quoteCelebrationStation as quote,stationEligibility} from '../shared/keepsake-station-policy.js';
const input=(paid={keychain:25,magnet:25},optional={})=>({selections:[{experience:'glam',tier:'SIGNATURE'}],baseCents:89900,complimentary:{keychain:50},paid,optional});
test('Signature reference totals and independent optional quantities are exact cents',()=>{
 const a=quote(input());assert.equal(a.totalCents,167250);assert.equal(a.totalProducts,100);assert.equal(a.purchasable,false);
 const b=quote(input(undefined,{'framed-photo':5,'jacketed-print':10,'acrylic-display':5,postcard:10}));assert.equal(b.totalCents,209220);assert.equal(b.lines.find(l=>l.key==='postcard').fulfillment,'LOB');
});
test('all paid tier boundaries combine keychains and magnets without counting complimentary items',()=>{
 for(const row of policy.paidTiers){for(const n of [row.min,row.min-1].filter(n=>n>0)){const expected=[...policy.paidTiers].reverse().find(t=>n>=t.min);const q=quote(input({keychain:n-1,magnet:1}));assert.equal(q.paidTierMinimum,expected.min);assert.equal(q.lines.find(l=>l.key==='magnet'&&!l.complimentary).unitCents,expected.magnet);}}
});
test('each optional tier boundary uses only that product quantity and retains custom quote nulls',()=>{
 for(const key of ['framed-photo','jacketed-print','acrylic-display','postcard'])for(const n of [1,9,10,24,25,49,50,99,100,249,250,499,500]){
  const expected=[...policy.optionalTiers].reverse().find(t=>n>=t.min)[key],q=quote(input(undefined,{[key]:n})),line=q.lines.find(l=>l.key===key);assert.equal(line.unitCents,expected);assert.equal(q.totalCents===null,expected===null);
 }
 const q=quote(input(undefined,{'framed-photo':5,'jacketed-print':5}));assert.equal(q.lines.find(l=>l.key==='framed-photo').unitCents,2999);
});
test('minimum, approved complimentary choices, shared event entitlement and eligibility',()=>{
 const invalid=quote(input({keychain:20,magnet:20},{'framed-photo':100}));assert.equal(invalid.remaining,10);assert.equal(invalid.minimumSatisfied,false);
 assert.throws(()=>quote({...input(),complimentary:{keychain:25,magnet:25}}),/approved/);
 assert.throws(()=>quote({...input(),selections:[{experience:'360',tier:'LUXE'}]}),/eligible/);
 const multi=quote({...input(),selections:[{experience:'glam',tier:'ESSENTIAL'},{experience:'vogue',tier:'SIGNATURE'}]});assert.equal(multi.stations,1);assert.equal(multi.totalQualifying,100);assert.equal(multi.subtotalCents,77350);
 const luxe=quote({...input({keychain:40,magnet:60}),selections:[{experience:'mirror',tier:'LUXE'}],complimentary:{keychain:50,magnet:50}});assert.equal(luxe.totalQualifying,200);assert.equal(luxe.lines[0].totalCents,64900);assert.equal(luxe.capacityVerified,false);
 assert.throws(()=>quote(input(undefined,{'premium-acrylic':1})),/optional/);
 assert.throws(()=>quote(input({keychain:0.5})),/whole/);
 for(const k of ['edited-photo','edited-strip','edited-package','premium-acrylic','photo-book','metal-print'])assert.equal(stationEligibility(k).station,false);
});
