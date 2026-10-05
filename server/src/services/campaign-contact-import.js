import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';
const maxRows=1000, maxBytes=2*1024*1024;
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,processEntities:true,removeNSPrefix:true});
function xml(bytes){const text=Buffer.from(bytes).toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('XML entities are unsupported.');return parser.parse(text);}
function text(value){if(value==null)return '';if(typeof value!=='object')return String(value);return array(value.r).map(r=>text(r.t)).join('') || text(value.t || value['#text']);}
function csvRows(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell!=='')throw new Error('Unexpected quote in CSV.');else quoted=!quoted;}
  else if(!quoted&&(c===','||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];if(rows.length>maxRows+1)throw new Error('Import at most 1,000 contacts.');}}
  else cell+=c;
 }
 if(quoted)throw new Error('Unclosed CSV quote.');if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
function excelRows(bytes){
 let expanded=0,count=0;
 const files=unzipSync(bytes,{filter: entry=>{
  if(++count>200)throw new Error('Workbook has too many files.');
  const needed=/^xl\/(sharedStrings.xml|workbook.xml|_rels\/workbook.xml.rels|worksheets\/sheet\d+\.xml)$/.test(entry.name);
  if(needed){expanded+=entry.originalSize;if(entry.originalSize>4*1024*1024||expanded>8*1024*1024)throw new Error('Workbook is too large.');}return needed;
 }});
 const wb=xml(files['xl/workbook.xml']);const sheets=array(wb.workbook?.sheets?.sheet);
 const selected=sheets.find(s=>s['@_name']==='Contacts') || sheets[0];
 const rels=array(xml(files['xl/_rels/workbook.xml.rels'])?.Relationships?.Relationship);
 const target=rels.find(r=>r['@_Id']===(selected?.['@_r:id']||selected?.['@_id']))?.['@_Target'];
 const path=target?.startsWith('/xl/')?target.slice(1):target?.startsWith('worksheets/')?'xl/'+target:null;
 if(!path||!files[path])throw new Error('Workbook needs a Contacts worksheet.');
 const strings=files['xl/sharedStrings.xml']?array(xml(files['xl/sharedStrings.xml']).sst?.si).map(text):[];
 const sheet=xml(files[path]);const out=[];
 for(const row of array(sheet.worksheet?.sheetData?.row)){
  const cells=[];
  for(const c of array(row.c)){
   const ref=c['@_r'];if(!/^[A-Z]{1,2}\d+$/.test(ref||''))throw new Error('Unsupported cell address.');
   const letters=ref.match(/^[A-Z]+/)[0];let col=0;for(const x of letters)col=col*26+x.charCodeAt(0)-64;col--;
   if(col>30)continue;
   if(c.f!=null)throw new Error('Remove formulas from contact cells before importing.');
   cells[col]=c['@_t']==='s'?strings[Number(c.v)] || '':c['@_t']==='inlineStr'?text(c.is):text(c.v);
  }
  const rowNumber=Number(row['@_r']||out.length+1);
  if(!Number.isInteger(rowNumber)||rowNumber<1)throw new Error('Unsupported row address.');
  out[rowNumber-1]=cells;if(out.length>maxRows+1)throw new Error('Import at most 1,000 contacts.');
 }
 return out;
}
export function importCampaignContacts(input){
 const {filename,data}=input||{};
 if(typeof filename!=='string'||typeof data!=='string'||data.length>Math.ceil(maxBytes*4/3)+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new AppError('Upload an Excel (.xlsx) or CSV file up to 2 MB.',422,'INVALID_CONTACT_FILE');
 const bytes=Buffer.from(data,'base64');if(bytes.length>maxBytes)throw new AppError('Contact file exceeds 2 MB.',422,'INVALID_CONTACT_FILE');
 let rows;try{rows=/\.xlsx$/i.test(filename)?excelRows(bytes):/\.csv$/i.test(filename)?csvRows(bytes.toString('utf8').replace(/^\uFEFF/,'')):null;if(!rows)throw new Error('Choose .xlsx or .csv.');}
 catch(e){throw new AppError('Cannot import contacts: '+e.message,422,'INVALID_CONTACT_FILE');}
 const header=(rows.shift()||[]).map(x=>String(x||'').trim().toLowerCase().replace(/[ _-]/g,''));
 if(!header.includes('email')||!header.includes('marketingconsent'))throw new AppError('Use the template headers, including Email and Marketing Consent.',422,'INVALID_CONTACT_HEADERS');
 const recipients=[],errors=[],seen=new Map();let duplicates=0;
 rows.forEach((row,i)=>{
  if(!row.some(v=>String(v||'').trim()))return;
  const get=key=>String(row[header.indexOf(key)]||'').trim();
  const email=get('email').toLowerCase(),consent=get('marketingconsent').toLowerCase();
  if(!z.email().safeParse(email).success){errors.push({row:i+2,message:'Valid email is required.'});return;}
  if(!['yes','true','1','no','false','0',''].includes(consent)){errors.push({row:i+2,message:'Marketing Consent must be Yes or No.'});return;}
  const c={email,first_name:get('firstname'),last_name:get('lastname'),company:get('company'),phone:get('phone'),marketing_email_opt_in:['yes','true','1'].includes(consent)};
  if(c.first_name.length>100||c.last_name.length>100||c.company.length>200||c.phone.length>50){errors.push({row:i+2,message:'Contact details are too long.'});return;}
  if(seen.has(email)){duplicates++;seen.get(email).marketing_email_opt_in &&= c.marketing_email_opt_in;return;}seen.set(email,c);recipients.push(c);
 });
 return {recipients,errors,duplicates,total:recipients.length,withoutConsent:recipients.filter(r=>!r.marketing_email_opt_in).length};
}
