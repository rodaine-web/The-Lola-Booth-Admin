import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRunSheetPdf} from '../server/src/services/run-sheet-pdf.js';
const fixture=()=>({event:{event_name:'Database event',status:'CONFIRMED',event_date:'2026-11-22',client_name:'Stored client',venue_address:'Stored address'},staff:[{name:'Stored attendant',assignment_role:'ATTENDANT'}],equipment:[{name:'Stored camera',lifecycle_status:'RESERVED',asset_uid:'DB-EQUIPMENT-1'}],contacts:[],timeline:[],experiences:[{name:'Stored experience'}],packages:[{name:'Stored package'}],addons:[{name:'Stored add-on',quantity:2}],approvals:[],notes:[],creative:{},checklists:[]});
// PDFKit emits its actual page text as hex string operands; decode those for
// content-loss checks without adding a production PDF parser dependency.
function pdfText(pdf){return [...pdf.toString('latin1').matchAll(/<([0-9a-f]+)>/gi)].map(m=>Buffer.from(m[1],'hex').toString('latin1')).join('');}
function pages(pdf){return Number(pdf.toString('latin1').match(/\/Type \/Pages[\s\S]*?\/Count (\d+)/)[1]);}
test('run sheet carries persisted records, clear missing fields and authenticated QR URL',async()=>{
  const pdf=await renderRunSheetPdf(fixture(),{compress:false,eventUrl:'https://example.test/my-events/event-id'}),text=pdfText(pdf);
  assert.equal(pages(pdf),2);
  for(const stored of ['Stored client','Stored attendant','Stored camera','DB-EQUIPMENT-1','Stored address','Stored experience','Stored package','Stored add-on','Not specified','Not recorded'])assert.ok(text.includes(stored),stored);
  assert.ok(pdf.toString('latin1').includes('https://example.test/my-events/event-id'));
  assert.ok(!text.includes('Sade'));assert.ok(!text.includes('Guac'));assert.ok(!text.includes('312.555'));
});
test('oversized notes and equipment lists preserve their last records on continuation pages',async()=>{
  const ops=fixture();ops.event.client_notes='NOTE-START '+('Long recorded note. '.repeat(1000))+' NOTE-END';
  ops.equipment=Array.from({length:60},(_,i)=>({name:`Inventory item ${i}`,lifecycle_status:'RESERVED'}));
  const pdf=await renderRunSheetPdf(ops,{compress:false}),text=pdfText(pdf);
  assert.ok(pages(pdf)>2);assert.ok(text.includes('NOTE-END'));assert.ok(text.includes('Inventory item 59'));
  assert.ok(text.includes(`Page ${pages(pdf)} of ${pages(pdf)}`));
});
test('renderer does not invent payments, staff, creative approvals or checklist tasks',async()=>{
  const ops=fixture();ops.staff=[];ops.equipment=[];
  const text=pdfText(await renderRunSheetPdf(ops,{compress:false}));
  assert.ok(text.includes('Not assigned'));assert.ok(!text.includes('Payment'));assert.ok(!text.includes('AgreementSIGNED'));
  assert.ok(!text.includes('Arrive on time'));assert.ok(!text.includes('Approved by client'));
});
