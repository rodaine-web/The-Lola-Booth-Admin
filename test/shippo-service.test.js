import test from 'node:test';
import assert from 'node:assert/strict';
import {shippoRequest,shippoRate,shippoCents,shippoAddress} from '../server/src/services/shippo-service.js';
const response=json=>new Response(JSON.stringify(json),{status:200});

test('Shippo rejects live keys, production and non-test responses before using shipping data',async()=>{
 const saved={APP_ENV:process.env.APP_ENV,SHIPPO_TEST_API_KEY:process.env.SHIPPO_TEST_API_KEY};
 try{
  process.env.APP_ENV='staging';process.env.SHIPPO_TEST_API_KEY='shippo_live_fake';let calls=0;
  await assert.rejects(shippoRequest('/shipments/',{},async()=>{calls++;}),{code:'SHIPPO_NOT_CONFIGURED'});assert.equal(calls,0);
  process.env.SHIPPO_TEST_API_KEY='shippo_test_synthetic';process.env.APP_ENV='production';await assert.rejects(shippoRequest('/shipments/',{},async()=>{calls++;}),{code:'SHIPPO_NOT_CONFIGURED'});assert.equal(calls,0);
  process.env.APP_ENV='staging';await assert.rejects(shippoRequest('/shipments/',{},async()=>response({test:false})),{code:'SHIPPO_MODE_MISMATCH'});
  await assert.rejects(shippoRequest('/transactions/',{},async()=>{throw Error('private upstream failure');}),{code:'SHIPPO_UNAVAILABLE'});
 }finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('Shippo compares validated USD rates with exact cents and respects allowed services',async()=>{
 const saved={APP_ENV:process.env.APP_ENV,SHIPPO_TEST_API_KEY:process.env.SHIPPO_TEST_API_KEY};
 try{process.env.APP_ENV='staging';process.env.SHIPPO_TEST_API_KEY='shippo_test_synthetic';
  const rates=[['usps_ground','5.01','USD'],['usps_priority','7.00','USD'],['invalid','-2','USD'],['foreign','1.00','EUR']].map(([token,amount,currency])=>({object_id:token,amount,currency,provider:'USPS',servicelevel:{token,name:token},estimated_days:3}));
  const request=async(url,options)=>{assert.equal(url,'https://api.goshippo.com/shipments/');assert.equal(options.headers.Authorization,'ShippoToken shippo_test_synthetic');assert.equal(options.headers['Shippo-API-Version'],'2018-02-08');assert.equal(JSON.parse(options.body).async,false);return response({object_id:'shipment',test:true,rates});};
  assert.equal((await shippoRate({parcels:[]},[],request)).cents,501);assert.equal((await shippoRate({},['usps_priority'],request)).cents,700);
  await assert.rejects(shippoRate({},['missing'],request),{code:'SHIPPO_NO_RATES'});
  await assert.rejects(shippoRate({},[],async()=>response({test:true,object_id:'bad',address_to:{validation_results:{is_valid:false}},rates})),{code:'SHIPPO_ADDRESS_INVALID'});
  assert.equal(shippoCents('0.29'),29);for(const bad of ['1e2','1.001','-1','NaN','1001.00'])assert.throws(()=>shippoCents(bad));
 }finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('Shippo retains supplied shipper contacts without inventing recipient contacts',()=>{const address={name:'Synthetic',address1:'1 Test Street',city:'Chicago',state:'IL',zip:'60601',country:'US'};assert.equal(shippoAddress(address).email,undefined);assert.equal(shippoAddress(address).phone,undefined);const mapped=shippoAddress({...address,email:'sender@example.invalid',phone:'+14155550100'});assert.equal(mapped.email,'sender@example.invalid');assert.equal(mapped.phone,'+14155550100');});
