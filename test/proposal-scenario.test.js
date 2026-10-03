import test from 'node:test';
import assert from 'node:assert/strict';
import {composeProposal,proposalEventTypes,proposalDefaults,mergeVariables} from '../shared/proposal-scenario.js';
import {generateProposalPdf,proposalHtml} from '../server/src/services/document-service.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pool} from '../server/src/db/pool.js';
import {buildProposalSnapshot} from '../server/src/services/proposal-service.js';
import {proposalEditInput} from '../server/src/services/proposal-edit-input.js';
const catalog=[['glam','Glam Photo Booth'],['360','360 Video Booth'],['vogue','Vogue Booth'],['audio','Audio Guestbook']].map(([key,name],i)=>({key,name,experience_id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),description:'Catalog description',price:100*(i+1),packages:[{package_id:'00000000-0000-4000-9000-'+String(i+1).padStart(12,'0'),name:'Essential',price:100*(i+1),included_hours:2,features:['Digital delivery'],description:'Digital-only configuration'}]}));
function model(type,experiences=catalog,input={},config={}){return composeProposal({input:{event_type:type,proposal_title:'QA celebration',event_details:{event_name:'QA celebration',event_date:'2026-12-12'},...input},experiences,config,pricing:{subtotal:1000,discount:0,tax:80,tax_rate:8,total:1080,deposit_amount:324,deposit_value:30,deposit_type:'PERCENTAGE',balance:756},lines:[{description:'Selected package',detail:'Two hours',line_total:1000}]});}
for(const type of proposalEventTypes)for(let mask=1;mask<16;mask++)test(`${type}: selection ${mask} composes catalog inclusions and dynamic ordered pages`,()=>{
 const selected=catalog.filter((_,i)=>mask&(1<<i));const result=model(type,selected);
 assert.deepEqual(result.experiences.map(e=>e.name),selected.map(e=>e.name));
 assert.equal(result.sections.length,selected.length+5);
 assert.equal(result.imageryCategory,type);
 assert.ok(!JSON.stringify(result).includes('{{'));
 assert.ok(result.experiences.every(e=>e.features.length===1&&e.features[0]==='Digital delivery'));
 assert.ok(!JSON.stringify(result).includes('On-site photo printing'));
});
test('proposal overrides are isolated; layer defaults and variables compose without mutation',()=>{
 const before=JSON.stringify(proposalDefaults);const result=model('Wedding',[catalog[0]],{scenario_overrides:{copy:{intro:'For {{client_name}}: {{event_name}} / {{unknown}}',close_body:''},experiences:{[catalog[0].experience_id]:{description:'{{experience_name}} with {{package_name}} costs {{package_price}}',features:['Approved custom inclusion']}},optional_sections:[{title:'Scope',body:'{{event_name}}'}]}});
 assert.equal(result.copy.close_body,'');assert.ok(result.copy.intro.includes('To be confirmed'));assert.ok(result.experiences[0].description.includes('Glam Photo Booth with Essential costs $100.00'));assert.deepEqual(result.experiences[0].features,['Approved custom inclusion']);assert.equal(JSON.stringify(proposalDefaults),before);
 const edited=proposalEditInput({content:{scenario:result,scenario_overrides:{copy:{intro:'For {{event_name}}'}}},selected_experiences:[catalog[0]]});assert.equal(edited.scenario_enabled,true);assert.equal(edited.event_type,'Wedding');assert.equal(edited.introduction,undefined);
});
test('custom event wording, ordering, optional scope and empty media remain safe',()=>{
 const result=model('Other',[catalog[3],catalog[1]],{event_details:{event_type:'Awards Gala'},scenario_overrides:{optional_sections:[{title:'Brand Integration',body:'Only the selected overlay'}]}});
 assert.equal(result.variables.event_type,'Awards Gala');assert.equal(result.experiences[0].key,'audio');assert.equal(result.sections.filter(s=>s.kind==='optional').length,1);assert.match(proposalHtml({content:{scenario:result}}),/neutral-photo/);assert.equal(mergeVariables('{{proposal_number}}',{}),'To be confirmed');
});
async function pdfPages(record){const buffer=await generateProposalPdf(record);const loading=getDocument({data:new Uint8Array(buffer),useSystemFonts:true,verbosity:0});const pdf=await loading.promise;const pages=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);const c=await p.getTextContent();pages.push(c.items);}await loading.destroy();return pages;}
test('PDF and public preview share all scenario text and financials, with correct page totals',async()=>{
 const result=model('Brand Activation',catalog,{scenario_overrides:{copy:{intro:'PARITY_INTRO',why_us_intro:'PARITY_WHY',close_body:'PARITY_CLOSE',terms_intro:'PARITY_TERMS'},optional_sections:[{title:'Activation Goals',body:'PARITY_GOALS'}]}});const record={content:{scenario:result},proposal_number:'QA-100'};
 const html=proposalHtml(record),pages=await pdfPages(record),txt=pages.flat().map(i=>i.str).join(' ');
 for(const marker of ['PARITY_INTRO','PARITY_WHY','PARITY_CLOSE','PARITY_TERMS','PARITY_GOALS']){assert.ok(html.includes(marker));assert.ok(txt.includes(marker));}
 assert.equal(pages.length,10);for(const [i,page]of pages.entries())assert.ok(page.some(item=>item.str===`Page ${i+1} of ${pages.length}`));assert.ok(txt.includes('$324.00'));assert.ok(txt.includes('$756.00'));
});
test('long proposal prose continues without truncating the tail or overwriting footers',async()=>{
 const result=model('Wedding',[catalog[0]],{scenario_overrides:{copy:{intro:'Long introduction. '.repeat(350)+'INTRO_TAIL',terms_intro:'Extended terms. '.repeat(500)+'TERMS_TAIL'},experiences:{[catalog[0].experience_id]:{features:Array.from({length:80},(_,i)=>`Feature ${i}`)}}}});
 const pages=await pdfPages({content:{scenario:result}}),txt=pages.flat().map(i=>i.str).join(' ');assert.ok(txt.includes('INTRO_TAIL'));assert.ok(txt.includes('TERMS_TAIL'));assert.ok(txt.includes('Feature 79'));assert.ok(pages.length>6);
 for(const page of pages)assert.ok(page.filter(i=>/Long introduction|Extended terms|Feature/.test(i.str)).every(i=>i.transform[5]>=80),'text entered footer');
});
test('server financial snapshot covers custom pricing, add-ons, travel, discounts, tax and both deposit types',async()=>{
 const original=pool.query;pool.query=async(sql,args=[])=>{
 if(sql.includes('business_settings'))return{rows:[{sales_tax_percent:10,default_deposit_percent:30}]};
 if(sql.includes("key='scenario_composer'"))return{rows:[{config:proposalDefaults,version:3}]};
 if(sql.includes('proposal_document_templates'))return{rows:[]};
 if(sql.includes('experiences'))return{rows:catalog.map(e=>({id:e.experience_id,name:e.name,active:true}))};
 if(sql.includes('packages'))return{rows:catalog.map(e=>({id:e.packages[0].package_id,experience_id:e.experience_id,name:'Custom',pricing_mode:'CUSTOM',active:true,items:['Agreed service']})).filter(p=>Array.isArray(args[0])?args[0].includes(p.id):args[0]===p.id)};
 if(sql.includes('addons'))return{rows:[{id:'addon',name:'Branding',price:50}]};return{rows:[]};
 };
 try{const input={scenario_enabled:true,event_type:'Brand Activation',selected_experiences:[{...catalog[0],packages:[{...catalog[0].packages[0],price:800}]}],addons:[{addon_id:'addon',quantity:2,unit_price:50}],travel:100,discount:50,tax_rate:10,custom_line_items:[{description:'Creative',quantity:2,unit_price:25}],deposit_type:'FIXED',deposit_value:250};
 const fixed=await buildProposalSnapshot(input);assert.equal(fixed.pricing.subtotal,1050);assert.equal(fixed.pricing.total,1100);assert.equal(fixed.pricing.deposit_amount,250);assert.equal(fixed.pricing.balance,850);assert.equal(fixed.content.scenario.templateVersion,3);
 const percentage=await buildProposalSnapshot({...input,deposit_type:'PERCENTAGE',deposit_value:30});assert.equal(percentage.pricing.deposit_amount,330);assert.equal(percentage.pricing.balance,770);
 await assert.rejects(buildProposalSnapshot({...input,selected_experiences:[{...catalog[0],packages:[{...catalog[0].packages[0],price:0}]}]}),/agreed custom package price/);
 await assert.rejects(buildProposalSnapshot({...input,deposit_type:'PERCENTAGE',deposit_value:101}),/cannot exceed/);
 const frozen=structuredClone(fixed.content.scenario);proposalDefaults.events['Brand Activation'].intro='Temporary edit';assert.deepEqual(fixed.content.scenario,frozen);
 }finally{proposalDefaults.events['Brand Activation'].intro='Thank you for considering The Lola Booth for {{event_name}}. We’re excited about the opportunity to create a high-energy, immersive photo and video experience designed to engage your audience, generate branded content and extend the reach of your activation.';pool.query=original;}
});

test('accepted snapshots remain frozen despite current relational and template changes',async()=>{
 const {getProposal}=await import('../server/src/services/proposal-service.js');const saved=model('Wedding',[catalog[0]]);const original=pool.query;
 pool.query=async()=>({rows:[{id:'p',status:'ACCEPTED',content:{scenario:model('Brand Activation')},proposal_snapshot:{content:{scenario:saved},pricing_snapshot:saved.pricing,line_items_snapshot:saved.lines,selected_experiences:saved.experiences},client_name:'Changed client',event_name:'Changed event'}]});
 try{const result=await getProposal('token',{publicView:true});assert.deepEqual(result.content.scenario,saved);assert.equal(result.content.scenario.variables.event_name,'QA celebration');assert.equal(result.content.scenario.eventType,'Wedding');}finally{pool.query=original;}
});
test('composed invoice handoff inherits agreed totals, discounts, tax, deposit and line amounts',async()=>{
 const {proposalInvoiceSnapshot}=await import('../shared/proposal-invoice-snapshot.js');
 const pricing={subtotal:1000,discount:75,tax_rate:8.75,tax:80.94,total:1005.94,deposit_type:'FIXED',deposit_amount:250,balance:755.94};
 const result=proposalInvoiceSnapshot({content:{scenario:{pricing,lines:[{description:'Glam',quantity:1,line_total:333.33},{description:'360',quantity:1,line_total:333.33},{description:'Travel',quantity:1,line_total:333.34}]}}});
 assert.equal(result.total,pricing.total);assert.equal(result.deposit_amount,250);assert.equal(result.balance,755.94);assert.equal(Math.round(result.items.reduce((s,i)=>s+i.line_total,0)*100),100594);assert.equal(Math.round(result.items.reduce((s,i)=>s+i.discount,0)*100),7500);assert.equal(result.items[1].description,'360');assert.equal(proposalInvoiceSnapshot({}),null);
});

test('schema validates editable defaults and rejects malformed copy, features and media',async()=>{
 const {scenarioConfigSchema,scenarioOverridesSchema}=await import('../server/src/services/proposal-scenario-schema.js');
 assert.equal(scenarioConfigSchema.safeParse(proposalDefaults).success,true);
 assert.equal(scenarioOverridesSchema.safeParse({copy:{next_steps:'not an array'}}).success,false);
 assert.equal(scenarioOverridesSchema.safeParse({media:{cover:['https://unapproved.example/photo.jpg']}}).success,false);
 assert.equal(scenarioOverridesSchema.safeParse({experiences:{glam:{features:['Approved scope']}}}).success,true);
});
test('public scenario excludes internal client and event fields',()=>{
 const result=composeProposal({input:{event_type:'Wedding',notes:'PRIVATE_NOTE'},client:{name:'Public Client',email:'private@example.com',notes:'PRIVATE_CLIENT_NOTE'},event:{event_name:'Public Event',internal_notes:'PRIVATE_EVENT_NOTE',owner_user_id:'PRIVATE_OWNER'},experiences:[catalog[0]],pricing:{},lines:[]});
 const serialized=JSON.stringify(result);assert.doesNotMatch(serialized,/PRIVATE_|private@example/);assert.equal(result.variables.client_name,'Public Client');
});

test('editorial renderer embeds fonts, vector icons and preserves all event details',()=>{
 const result=model('Wedding',[catalog[0]],{event_details:{event_name:'QA celebration',event_date:'2026-12-12',start_time:'17:00',end_time:'22:00',venue_name:'The Laurel',venue_address:'123 Main Street',city:'Austin',state:'TX',zip:'78701',special_requests:'Gold backdrop'}});
 const html=proposalHtml({content:{scenario:result}});
 assert.match(html,/font-family:LolaEditorial/);
 assert.match(html,/font-family:LolaSignature/);
 assert.match(html,/data:font\/ttf;base64/);
 assert.match(html,/<svg viewBox="0 0 24 24"/);
 assert.match(html,/December 12, 2026/);
 assert.match(html,/5:00 PM/);
 assert.match(html,/78701/);
 assert.match(html,/Gold backdrop/);
 assert.match(html,/data-kind="cover"/);
});
test('event imagery never falls back to a selected booth hero',async()=>{
 const {scenarioImage}=await import('../server/src/services/proposal-scenario-document.js');
 const hero='data:image/jpeg;base64,Ym9vdGg=';
 const result=model('Wedding',[{...catalog[0],visuals:{hero}}]);
 assert.equal(scenarioImage(result,'cover'),null);
 assert.equal(scenarioImage(result,'event'),null);
 assert.equal(scenarioImage(result,'experience:glam',result.experiences[0]),hero);
 result.mediaImages={event:[{dataUri:'data:image/jpeg;base64,ZXZlbnQ='}]};
 assert.equal(scenarioImage(result,'cover'),'data:image/jpeg;base64,ZXZlbnQ=');
});
