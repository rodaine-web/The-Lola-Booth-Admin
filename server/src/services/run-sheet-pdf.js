import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const colors={paper:'#FAF8F3',ink:'#111820',gold:'#A58040',muted:'#596579',line:'#E3DDD2'};
const human=value=>String(value ?? '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const value=(input,fallback='Not specified')=>input===null||input===undefined||input===''?fallback:String(input);
function date(input){
  if(!input)return 'Not specified';
  const raw=input instanceof Date?input.toISOString().slice(0,10):String(input).slice(0,10);
  const parsed=new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())?String(input):parsed.toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'});
}
function time(input){
  if(!input)return 'TBD';
  const text=String(input),match=text.match(/^(\d{2}):(\d{2})/);
  if(!match)return text;
  const hour=Number(match[1]);return `${hour%12||12}:${match[2]} ${hour<12?'AM':'PM'}`;
}
export async function renderRunSheetPdf(ops,{eventUrl=null,compress=true}={}){
  const doc=new PDFDocument({size:'LETTER',compress,margin:0,bufferPages:true,autoFirstPage:false,info:{Title:`Event Run Sheet - ${ops.event.event_name}`,Author:'The Lola Booth'}});
  const chunks=[];doc.on('data',chunk=>chunks.push(chunk));
  const done=new Promise((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const e=ops.event;const W=612,M=30,inner=552,gap=20,col=266,bottom=738;
  let cursor=0;
  const text=(s,x,y,width,size=9,font='Helvetica',color=colors.ink)=>{
    doc.font(font).fontSize(size).fillColor(color).text(value(s),x,y,{width,lineGap:2});
  };
  const height=(s,width,size=9,font='Helvetica')=>doc.font(font).fontSize(size).heightOfString(value(s),{width,lineGap:2});
  function page(){
    doc.addPage();doc.rect(0,0,W,792).fill(colors.paper);doc.rect(0,0,W,84).fill('#111111');
    const logo=fileURLToPath(new URL('../../../public/brand/LOLA_Primary_Light_Transparent.png',import.meta.url));
    if(fs.existsSync(logo))doc.image(logo,M,10,{fit:[128,64],align:'left',valign:'center'});
    else {text('LOLA',M,14,200,36,'Times-Roman','#D5B77F');text('T H E  L O L A  B O O T H',M,57,220,8,'Helvetica','#FFFFFF');}
    text('Good people. Better photos.',300,23,282,17,'Times-Italic','#FFFFFF');
    text('E V E N T  R U N  S H E E T',300,58,282,8,'Helvetica','#FFFFFF');cursor=104;
  }
  function section(title,x,y,width){
    const titleHeight=height(title.toUpperCase(),width,10,'Helvetica-Bold');
    text(title.toUpperCase(),x,y,width,10,'Helvetica-Bold');
    const line=y+titleHeight+5;
    doc.moveTo(x,line).lineTo(x+width,line).strokeColor(colors.gold).lineWidth(.6).stroke();return line+7;
  }
  function row(label,detail,x,y,width){
    const labelW=Math.min(95,width*.37),h=Math.max(19,height(detail,width-labelW-8)+7,height(label,labelW,8)+7);
    text(label,x,y+3,labelW,8,'Helvetica',colors.muted);text(detail,x+labelW+8,y+3,width-labelW-8,9);
    doc.moveTo(x,y+h-3).lineTo(x+width,y+h-3).strokeColor(colors.line).lineWidth(.4).stroke();return y+h;
  }
  // Split even a single oversized note into measured fragments, preserving all
  // text and restarting the section on a continuation page.
  function rowsBlock(title,rows,x,y,width){
    if(y+48>bottom){page();x=M;width=inner;y=cursor;}
    y=section(title,x,y,width);
    for(const [label,raw] of rows.length?rows:[['Details','None recorded.']]){
      let remaining=value(raw),first=true;
      while(remaining.length){
        const available=bottom-y;
        if(available<35){page();x=M;width=inner;y=section(`${title.replace(/ \(continued\)$/i,'')} (continued)`,x,cursor,width);}
        const detailW=width-Math.min(95,width*.37)-8;
        let fragment=remaining;
        if(height(fragment,detailW)+10>bottom-y){
          let lo=1,hi=fragment.length;
          while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(height(fragment.slice(0,mid),detailW)+10<=bottom-y)lo=mid;else hi=mid-1;}
          let cut=lo;const space=fragment.lastIndexOf(' ',cut);if(space>cut*.5)cut=space;
          fragment=remaining.slice(0,cut);
        }
        y=row(first?label:`${label} (cont.)`,fragment,x,y,width);
        remaining=remaining.slice(fragment.length).trimStart();first=false;
      }
    }
    cursor=y+12;return cursor;
  }
  function paired(leftTitle,leftRows,rightTitle,rightRows){
    const estimate=rows=>23+rows.reduce((sum,[l,v])=>sum+Math.max(19,height(v,col-103)+7,height(l,95,8)+7),0)+12;
    if(cursor+Math.max(estimate(leftRows),estimate(rightRows))>bottom){
      // Full-width continuation avoids interleaving the two columns on overflow.
      rowsBlock(leftTitle,leftRows,M,cursor,inner);rowsBlock(rightTitle,rightRows,M,cursor,inner);return;
    }
    const start=cursor,a=rowsBlock(leftTitle,leftRows,M,start,col),b=rowsBlock(rightTitle,rightRows,M+col+gap,start,col);cursor=Math.max(a,b);
  }
  page();
  const titleHeight=height(e.event_name,inner,29,'Times-Bold');
  text(e.event_name,M,cursor,inner,29,'Times-Bold');cursor+=titleHeight+5;
  text(`${human(e.event_type)}  |  ${human(e.status)}`,M,cursor,inner,9,'Helvetica-Bold',colors.gold);cursor+=23;
  rowsBlock('Event schedule',[
    ['Date',date(e.event_date)],['Time',`${time(e.start_time)} - ${time(e.end_time)}`],
    ['Location',[e.venue_name,e.venue_address,e.city,e.state].filter(Boolean).join(', ')||'Not specified']
  ],M,cursor,inner);
  paired('Client information',[
    ['Client',value(e.client_name)],['Email',value(e.client_email)],['Phone',value(e.client_phone)],
    ['Guests',value(e.guest_count)],['Agreement',value(ops.agreement_status,'Not recorded')],
    ...(e.payment_status?[['Payment',`${human(e.payment_status)}${e.balance_due!=null?` ($${Number(e.balance_due).toFixed(2)} outstanding)`:''}`]]:[])
  ],'On-site team',[
    ...(ops.staff.length?ops.staff.map(s=>[s.lead_attendant?'Lead attendant':human(s.assignment_role),[s.name,s.phone,s.call_time?`Call: ${time(s.call_time)}`:null,human(s.acknowledgement_status)].filter(Boolean).join('\n')]):[['Staff','Not assigned']]),
    ...ops.contacts.map(c=>[human(c.role),[c.name,c.phone,c.email,c.notes].filter(Boolean).join('\n')])
  ]);
  paired('Event timeline',ops.timeline.length?ops.timeline.map(t=>[t.label,time(t.value)]):[['Schedule','TBD']], 'Venue details',[
    ['Parking / load in',value(e.parking_loading_instructions||e.load_in_instructions)],['Access',value(e.access_instructions)],['Venue contact',value(e.venue_contact_name)],['Venue phone',value(e.venue_contact_phone)],['Venue notes',value(e.venue_notes)]
  ]);
  paired('Selected experiences',(ops.experiences||[]).length?[...ops.experiences.map(x=>['Experience',x.name]),...((ops.packages||[]).length?ops.packages.map(p=>['Package',p.name]):e.package_name?[['Package',e.package_name]]:[])]:[['Experience',value(e.experience_name,'Not selected')]],'Add-ons',(ops.addons||[]).map(a=>[a.name,`Quantity: ${a.quantity}`]));
  paired('Special requests', [['Client notes',value(e.client_notes,'None recorded.')]],'Approved creative',(ops.approvals||[]).map(a=>[human(a.approval_type),`Version ${a.version||1} - ${human(a.status)}${a.metadata?.components?.length?`\n${a.metadata.components.map(c=>typeof c==='string'?human(c):human(c.component)).join(', ')}`:''}`]));
  // Operations always starts a separate sheet, matching the reference's split.
  page();
  const equipmentRows=ops.equipment.map(item=>[item.name,[human(item.category),human(item.lifecycle_status),item.asset_uid||item.equipment_record_id||'',item.accessories?`Accessories: ${typeof item.accessories==='string'?item.accessories:JSON.stringify(item.accessories)}`:null].filter(Boolean).join('\n')]);
  const split=Math.ceil(equipmentRows.length/2);
  paired('Assigned equipment',equipmentRows.length?equipmentRows.slice(0,split):[['Equipment','Not assigned']],'Assigned equipment (continued)',equipmentRows.length>1?equipmentRows.slice(split):[['Additional equipment','Not assigned']]);
  rowsBlock('Setup & location notes',[
    ['Backdrop',value(ops.backdrop_name||ops.creative?.backdrop_selection)],['Placement',value(e.booth_placement)],['Power',value(e.power_requirements)],['Lighting',value(e.lighting_notes)],['Space',value(e.space_requirements)],['Setup',value(e.setup_instructions,'None recorded.')],['Creative notes',value(ops.creative?.special_design_instructions,'None recorded.')]
  ],M,cursor,inner);
  const groups=ops.checklists||[];
  if(!groups.length)rowsBlock('Event day checklist', [['Checklist','None recorded.']],M,cursor,inner);
  const checklistRows=group=>group.items.map(item=>[
    `${['COMPLETED','NOT_REQUIRED'].includes(item.status)?'[x]':'[ ]'} ${human(item.timing_phase||item.category||'Task')}`,
    `${item.title||item.label}${item.required?' - Required':''}${item.severity==='CRITICAL'?' - Critical':''}\n${human(item.status)}${item.description?`\n${item.description}`:''}`
  ]);
  for(let i=0;i<groups.length;i+=2){
    if(groups[i+1])paired(`Checklist - ${groups[i].name}`,checklistRows(groups[i]),`Checklist - ${groups[i+1].name}`,checklistRows(groups[i+1]));
    else rowsBlock(`Checklist - ${groups[i].name}`,checklistRows(groups[i]),M,cursor,inner);
  }
  rowsBlock('Important reminders', [...(ops.readiness?[['Readiness',`${ops.readiness.complete} of ${ops.readiness.total} required items complete; ${ops.readiness.critical} critical item(s).`]]:[]),...(ops.notes||[]).filter(n=>n.pinned).map(n=>['Note',n.body])],M,cursor,inner);
  if(eventUrl){
    if(cursor+107>bottom)page();
    const qr=await QRCode.toBuffer(eventUrl,{width:220,margin:1,errorCorrectionLevel:'M'});
    doc.image(qr,M,cursor,{width:88,height:88});
    text('EVENT PAGE',M+103,cursor+8,inner-103,11,'Helvetica-Bold',colors.gold);
    text('Scan to open event details. Sign in with an authorized admin or assigned staff account.',M+103,cursor+31,inner-103,10);
    doc.link(M,cursor,88,88,eventUrl);
  }
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
    doc.switchToPage(i);doc.moveTo(M,755).lineTo(W-M,755).strokeColor(colors.line).stroke();
    text('THE LOLA BOOTH  |  Good people. Better photos.',M,767,420,8,'Helvetica',colors.muted);
    text(`Page ${i+1} of ${range.count}`,W-110,767,80,8,'Helvetica',colors.muted);
  }
  doc.end();return done;
}
