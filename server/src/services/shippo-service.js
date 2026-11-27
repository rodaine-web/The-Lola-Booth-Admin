import {AppError} from '../utils/errors.js';
import {keepsakesStaging} from '../../../shared/keepsakes.js';
const fail=(message='Shipping is temporarily unavailable. Please try again shortly.',code='SHIPPO_UNAVAILABLE')=>new AppError(message,503,code);
export function shippoReadiness(){return {mode:'TEST',configured:keepsakesStaging()&&/^shippo_test_\S+$/.test(process.env.SHIPPO_TEST_API_KEY||'')};}
export async function shippoRequest(path,body,request=fetch){
 if(!shippoReadiness().configured)throw fail('Add a Shippo test token to the staging service.','SHIPPO_NOT_CONFIGURED');
 if(!/^\/(?:shipments\/|transactions\/(?:[\w-]+\/)?|refunds\/[\w-]+\/|tracks\/shippo\/SHIPPO_(?:TRANSIT|DELIVERED|FAILURE)\/)$/.test(path))throw fail();
 let response,data;try{response=await request('https://api.goshippo.com'+path,{method:body?'POST':'GET',headers:{Authorization:`ShippoToken ${process.env.SHIPPO_TEST_API_KEY}`,'Content-Type':'application/json','Shippo-API-Version':'2018-02-08'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});data=await response.json();}catch{throw fail();}
 if(!response.ok)throw fail();
 // Never trust a misconfigured account or response to perform live operations.
 if(data.test!==true)throw fail('Shippo did not confirm test mode.','SHIPPO_MODE_MISMATCH');
 return data;
}
export function shippoCents(amount){if(typeof amount!=='string'||!/^\d{1,6}(\.\d{1,2})?$/.test(amount))throw fail();const [whole,fraction='']=amount.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(cents>100000)throw fail();return cents;}
export const shippoAddress=a=>({name:a.name,street1:a.address1,street2:a.address2||'',city:a.city,state:a.state,zip:a.zip,country:a.country,...(a.email?{email:a.email}:{}),...(a.phone?{phone:a.phone}:{})});
export async function shippoRate(payload,services,request){
 const shipment=await shippoRequest('/shipments/',{...payload,async:false},request);
 if(!shipment.object_id||[shipment.address_from,shipment.address_to].some(a=>a?.validation_results?.is_valid===false))throw fail('Check the shipping address before requesting a rate.','SHIPPO_ADDRESS_INVALID');
 const rates=(shipment.rates||[]).filter(r=>r.currency==='USD'&&r.object_id&&r.servicelevel?.token&&(!services.length||services.includes(r.servicelevel.token))).flatMap(r=>{try{return [{id:r.object_id,shipmentId:shipment.object_id,cents:shippoCents(r.amount),carrier:String(r.provider||'Carrier').slice(0,80),service:String(r.servicelevel.name||r.servicelevel.token).slice(0,100),serviceToken:r.servicelevel.token,estimatedDays:Number.isInteger(r.estimated_days)&&r.estimated_days>=0?r.estimated_days:null}];}catch{return [];}}).sort((a,b)=>a.cents-b.cents||a.id.localeCompare(b.id));
 if(!rates.length)throw fail('No supported shipping rate is available for this address.','SHIPPO_NO_RATES');
 return rates[0];
}
export const shippoHttps=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
