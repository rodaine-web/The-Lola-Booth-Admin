import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import PDFDocument from 'pdfkit';
import {createCanvas} from '@napi-rs/canvas';
import {validDrawnSignature} from '../../../shared/signature.js';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/brand');
const colors = {ink:'#151515',muted:'#66615a',gold:'#9c7133',line:'#dfd6c9',ivory:'#faf8f4'};
const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value || 0));
const date = value => {
  if (!value) return 'To be confirmed';
  const parsed = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? 'To be confirmed' : parsed.toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'});
};
const time = value => { const match=String(value || '').match(/^(\d{2}):(\d{2})/); return match ? `${Number(match[1])%12||12}:${match[2]} ${Number(match[1])>=12?'PM':'AM'}` : 'To be confirmed'; };

// Presentation only: the signed snapshot, terms, signature and document hash remain unchanged.
export function renderContractPdf(row) {
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'LETTER',margins:{top:122,bottom:76,left:48,right:48},bufferPages:true,info:{Title:row.title,Author:'The LOLA Booth',Subject:`Agreement ${row.snapshot.proposal_number} - revision ${row.revision}`}});
  const chunks=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  const serif=path.join(assets,'fonts/CormorantGaramond.ttf'),script=path.join(assets,'fonts/GreatVibes-Regular.ttf');
  if(fs.existsSync(serif))doc.registerFont('LOLA Serif',serif);
  if(fs.existsSync(script))doc.registerFont('LOLA Signature',script);
  const heading=fs.existsSync(serif)?'LOLA Serif':'Times-Roman';
  const signature=fs.existsSync(script)?'LOLA Signature':'Times-Italic';
  const logo=path.join(assets,'LOLA_Primary_Dark_Transparent.png');
  function decorate(){
   doc.save().rect(0,0,612,105).fill(colors.ivory);
   if(fs.existsSync(logo))doc.image(logo,48,22,{fit:[116,65]});
   else doc.fillColor(colors.ink).font('Times-Roman').fontSize(28).text('LOLA',48,30,{lineBreak:false});
   doc.fillColor(colors.gold).font('Helvetica').fontSize(9).text('PHOTO BOOTH SERVICES AGREEMENT',250,35,{width:314,align:'right',lineBreak:false});
   doc.fillColor(colors.muted).fontSize(8).text(`${row.snapshot.proposal_number}  |  Revision ${row.revision}  |  ${row.status}`,250,56,{width:314,align:'right',lineBreak:false});
   doc.moveTo(48,105).lineTo(564,105).strokeColor(colors.line).stroke().restore();doc.x=48;doc.y=126;
  }
  doc.on('pageAdded',decorate);decorate();
  function room(height){if(doc.y+height>doc.page.height-76)doc.addPage();}
  function section(title){room(64);doc.x=48;doc.moveDown(.45).fillColor(colors.ink).font(heading).fontSize(21).text(title,{width:516});doc.moveDown(.25);}
  function body(value,{size=10.5,color=colors.ink,font='Helvetica'}={}){doc.x=48;doc.fillColor(color).font(font).fontSize(size).text(String(value),{width:516,lineGap:3,paragraphGap:5});doc.moveDown(.35);}
  doc.fillColor(colors.gold).font('Helvetica').fontSize(9).text('THE LOLA BOOTH');doc.moveDown(.6);
  doc.fillColor(colors.ink).font(heading).fontSize(33).text(row.title,{width:516});doc.moveDown(.4);
  body(`Agreement ${row.snapshot.proposal_number}  |  Version ${row.revision}${row.issued_at?`  |  Issued ${date(row.issued_at)}`:''}`,{size:9,color:colors.muted});
  section('Your Event');
  const snapshot=row.snapshot;
  const facts=[['Client',snapshot.client_name],['Email',snapshot.client_email],['Event',snapshot.event_name],['Event type',snapshot.event_type],['Event date',snapshot.event_date?date(snapshot.event_date):null],['Service time',snapshot.start_time||snapshot.end_time?`${time(snapshot.start_time)} - ${time(snapshot.end_time)}`:null],['Venue',snapshot.venue_name],['Total investment',snapshot.total!=null?money(snapshot.total):null]];
  for(const [label,value] of facts){
   if(value==null)continue;
   doc.font('Helvetica').fontSize(10);const h=Math.max(25,doc.heightOfString(String(value),{width:364,lineGap:3})+10);room(h);
   const y=doc.y;doc.fillColor(colors.muted).text(label,48,y,{width:140});doc.fillColor(colors.ink).text(String(value),200,y,{width:364,lineGap:3});doc.y=y+h;
   doc.moveTo(48,doc.y-5).lineTo(564,doc.y-5).strokeColor(colors.line).stroke();
  }
  if(Array.isArray(snapshot.items)&&snapshot.items.length){
   section('Selected Services');
   for(const item of snapshot.items){room(40);body(`${item.description||item.label||'Service'}  |  Quantity ${item.quantity??1}${item.unit_price!=null||item.amount!=null?`  |  ${money(item.unit_price??item.amount)}`:''}`);}
  }
  section('Terms and Conditions');
  // Canonical numbered headings are separated from numbered lists by blank lines.
  for(const block of String(row.terms||'').replace(/\r\n/g,'\n').split(/\n\s*\n/)){
   const value=block.trim();if(!value)continue;
   if(/^\d+\. [^\n]+$/.test(value)&&value.length<110&&!/[.!?]$/.test(value))section(value);
   else body(value);
  }
  if(row.status==='SIGNED'){
   room(230);section('Electronic signature');
   const y=doc.y;doc.save().roundedRect(48,y,516,88,7).fill(colors.ivory).restore();
   if(row.signature_method==='DRAWN'&&validDrawnSignature(row.signature_strokes)){
    const canvas=createCanvas(600,160),ctx=canvas.getContext('2d');ctx.strokeStyle=colors.ink;ctx.lineWidth=2.5;ctx.lineCap='round';
    for(const stroke of row.signature_strokes){ctx.beginPath();stroke.forEach(([x,y],i)=>i?ctx.lineTo(x*600,y*160):ctx.moveTo(x*600,y*160));ctx.stroke();}
    doc.image(canvas.toBuffer('image/png'),62,y+8,{fit:[300,70]});
   }else doc.fillColor(colors.ink).font(signature).fontSize(32).text(row.signer_name,64,y+22,{width:484});
   doc.y=y+103;body(`Signed by ${row.signer_name} (${row.signer_email})`,{size:9});
   body(`Signed at ${new Date(row.signed_at).toISOString()}`,{size:9,color:colors.muted});
   body(row.consent_text||'',{size:9,color:colors.muted});
  }
  room(50);body(`Document SHA-256: ${row.document_hash||'Draft - not issued'}`,{size:7,color:colors.muted});
  const pages=doc.bufferedPageRange();
  for(let i=pages.start;i<pages.start+pages.count;i++){
   doc.switchToPage(i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.save().moveTo(48,731).lineTo(564,731).strokeColor(colors.line).stroke();
   doc.fillColor(colors.ink).font('Helvetica').fontSize(8).text('THE LOLA BOOTH',48,746,{lineBreak:false});
   doc.fillColor(colors.muted).font('Times-Italic').text('Good people. Better photos.',153,746,{lineBreak:false});
   doc.font('Helvetica').text(`Page ${i+1} of ${pages.count}`,465,746,{width:99,align:'right',lineBreak:false});doc.restore();doc.page.margins.bottom=bottom;
  }
  doc.end();
 });
}
