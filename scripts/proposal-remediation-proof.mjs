import fs from 'node:fs/promises';
import path from 'node:path';
import {composeProposal} from '../shared/proposal-scenario.js';
import {freezeDefaultProposalMedia} from '../server/src/services/proposal-default-media.js';
import {generateProposalPdf,proposalHtml} from '../server/src/services/document-service.js';
const output=process.env.LOLA_QA_OUTPUT_DIR;
if(!output)throw new Error('Set LOLA_QA_OUTPUT_DIR to the review output folder.');
await fs.mkdir(output,{recursive:true});
const experiences=[['360','360 Video Booth',1099],['glam','Glam Photo Booth',899],['vogue','Vogue Booth',699],['audio','Audio Guestbook',499]].map(([key,name,price],i)=>({key,name,experience_id:String(i),price,packages:[{name:'Signature Package',price,included_hours:2,features:['2 hours of service','Unlimited sessions','Custom overlay','Instant digital sharing','Professional attendant','Delivery, setup and breakdown']}]}));
for(const [name,type,items] of [['wedding-360','Wedding',[experiences[0]]],['wedding-four','Wedding',experiences],['brand-photo-360','Brand Activation',experiences.slice(0,2)]]){
 const subtotal=items.reduce((n,item)=>n+item.price,0),total=subtotal;
 const scenario=freezeDefaultProposalMedia(composeProposal({input:{proposal_title:type==='Wedding'?"Sarah & Michael’s Wedding":'Nova Pulse Summer Launch',proposal_date:'2026-10-04',valid_through:'2026-10-18',event_type:type,event_details:{event_name:type==='Wedding'?"Sarah & Michael’s Wedding":'Nova Pulse Summer Launch',event_date:'2027-06-12',start_time:'17:00:00',end_time:'22:00:00',guest_count:120,venue_name:'The Laurel',city:'Chicago',state:'IL',special_requests:'Ivory and gold overlay. A welcoming experience for every guest.'},customer_notes:'Please coordinate setup with the venue team.'},client:{name:'Sarah & Michael'},experiences:items,pricing:{subtotal,discount:0,tax:0,tax_rate:0,total,deposit_amount:Math.round(total*30)/100,deposit_type:'PERCENTAGE',deposit_value:30,balance:Math.round(total*70)/100},lines:items.map(item=>({description:item.name,detail:'Signature Package · 2 hours',line_total:item.price}))}));
 const record={proposal_number:'DESIGN-PROOF',public_url:'https://staging.thelolabooth.com/',content:{scenario}};
 await fs.writeFile(path.join(output,name+'.pdf'),await generateProposalPdf(record));
 await fs.writeFile(path.join(output,name+'.html'),proposalHtml(record));
}
console.log('Three composable proposal design proofs generated. These are synthetic design fixtures, not sent proposals.');
