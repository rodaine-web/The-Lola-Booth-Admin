import fs from 'node:fs/promises';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
const escape=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const columns='ABCDEFGHIJKLMNOPQR';
function serial(value,dateOnly=false){
 if(!value||!Number.isFinite(Date.parse(value)))return null;
 if(dateOnly)return Date.parse(String(value).slice(0,10)+'T00:00:00Z')/86400000+25569;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second)/86400000+25569;
}
function cell(ref,value,style=1){
 if(value===null||value===undefined||value==='')return `<x:c r="${ref}" s="${style}"/>`;
 return typeof value==='number'?`<x:c r="${ref}" s="${style}" t="n"><x:v>${value}</x:v></x:c>`:`<x:c r="${ref}" s="${style}" t="inlineStr"><x:is><x:t xml:space="preserve">${escape(String(value).slice(0,32700))}</x:t></x:is></x:c>`;
}
function replaceCell(xml,ref,value,style=1){return xml.replace(new RegExp(`<x:c r="${ref}"[^>]*(?:/>|>[\\s\\S]*?</x:c>)`),cell(ref,value,style));}
// Fill the reviewed Artifact Tool template without a server-side office engine.
// Only explicit report fields are written; user strings are literal XML cells.
export async function buildPostcardWorkbook(report){
 const files=unzipSync(await fs.readFile(new URL('../../templates/postcard-client-report.xlsx',import.meta.url)));
 const summary=report.summary,keys=['images','processedImages','combinations','successful','failed','held','excluded','pending','mailed','delivered'];
 let first=strFromU8(files['xl/worksheets/sheet1.xml']);
 for(let i=0;i<keys.length;i++)first=replaceCell(first,`B${8+i}`,keys[i]==='pending'?(summary.pending||0)+(summary.ready||0):summary[keys[i]]||0,6);
 first=replaceCell(first,'A15','Not yet submitted');
 const generated=serial(report.createdAt);
 first=replaceCell(replaceCell(first,'B4',report.eventName),'B5',generated,8);
 files['xl/worksheets/sheet1.xml']=strToU8(first);
 let second=strFromU8(files['xl/worksheets/sheet2.xml']);
 second=replaceCell(replaceCell(second,'B4',report.eventName),'B5',generated,8);
 const header=second.match(/<x:sheetData>([\s\S]*?)<x:row r="8"/)[1];
 const links=[];
 const body=report.rows.map((r,i)=>{
  const n=i+8,a=r.address||{};
  const values=[r.filename,r.photoUrl?'View photo':'Link unavailable',r.name,r.email,r.phone,a.address_line1,a.address_line2,a.address_city,a.address_state,a.address_zip,a.address_country,r.status,r.reason,serial(r.submittedAt),serial(r.mailedAt),serial(r.expectedDelivery,true),serial(r.deliveredAt),serial(r.scheduledReleaseAt)];
  if(r.photoUrl){const url=new URL(r.photoUrl);if(url.protocol==='https:'||['localhost','127.0.0.1'].includes(url.hostname))links.push({row:n,url:url.href});}
  return `<x:row r="${n}" ht="48" customHeight="1">${values.map((v,j)=>cell(columns[j]+n,v,j===9?10:j===15?9:j>=13?8:11)).join('')}</x:row>`;
 }).join('');
 second=second.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/,`<x:sheetData>${header}${body}</x:sheetData>`);
 const last=Math.max(8,report.rows.length+7);
 second=second.replace(/sqref="L8(?::L8)?"/g,`sqref="L8:L${last}"`);
 second=second.replace(/<x:cfRule([^>]*\btext="([A-Z_]+)"[^>]*)\s*\/>/g,(_,attributes,text)=>`<x:cfRule${attributes}><x:formula>NOT(ISERROR(SEARCH("${text}",L8)))</x:formula></x:cfRule>`);
 second=second.replace('</x:sheetData>',`</x:sheetData><x:autoFilter ref="A7:R${last}"/>`);
 // SpreadsheetML requires hyperlinks after conditionalFormatting and before
 // pageMargins. Appending them at the worksheet end makes Excel repair it.
 if(links.length){second=second.replace('<x:pageMargins',`<x:hyperlinks>${links.map((l,i)=>`<x:hyperlink ref="B${l.row}" r:id="photo${i}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`).join('')}</x:hyperlinks><x:pageMargins`);files['xl/worksheets/_rels/sheet2.xml.rels']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l,i)=>`<Relationship Id="photo${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escape(l.url)}" TargetMode="External"/>`).join('')}</Relationships>`);}
 files['xl/worksheets/sheet2.xml']=strToU8(second);
 const path=Object.keys(files).find(p=>/\/charts\/chart1.xml$/.test(p));
 let chart=strFromU8(files[path]);
 const names=['Successfully submitted','Failed','Held / needs review','Excluded','Not yet submitted'],counts=keys.slice(3,8).map(key=>key==='pending'?(summary.pending||0)+(summary.ready||0):summary[key]||0);
 chart=chart.replace(/<c:strCache>[\s\S]*?<\/c:strCache>/,`<c:strCache><c:ptCount val="5"/>${names.map((v,i)=>`<c:pt idx="${i}"><c:v>${escape(v)}</c:v></c:pt>`).join('')}</c:strCache>`).replace(/<c:numCache>[\s\S]*?<\/c:numCache>/,`<c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="5"/>${counts.map((v,i)=>`<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`);
 const palette=['4C7B3C','B83E32','D2A148','AAA49C','D4B977'];
 chart=chart.replace('</c:tx>','</c:tx>'+palette.map((color,i)=>`<c:dPt><c:idx val="${i}"/><c:spPr><a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:dPt>`).join(''));
 files[path]=strToU8(chart);
 let styles=strFromU8(files['xl/styles.xml']);
 styles=styles.replace('<x:cellXfs count="11">','<x:cellXfs count="12">').replace('</x:cellXfs>','<x:xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><x:alignment vertical="center" wrapText="1"/></x:xf></x:cellXfs>');
 files['xl/styles.xml']=strToU8(styles);
 return Buffer.from(zipSync(files));
}
