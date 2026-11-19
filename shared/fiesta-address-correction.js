import {parseFiestaShares,parseFiestaCsvGrid} from './fiesta-gallery.js';
import {fiestaPostalField,parseFiestaPostalAnswers} from './fiesta-postal-survey.js';
import {normalizeUsMailAddress} from './us-mail-address.js';

const identity=r=>JSON.stringify([r.filename,r.channel,r.recipient]);
const serialize=grid=>grid.map(row=>row.map(cell=>'"'+String(cell).replaceAll('"','""')+'"').join(',')).join('\r\n');

// Rewrite address answers only. Sharing identities and guest permission answers are immutable here.
export function correctFiestaAddress(csv,eventCode,record,input,options={}){
 const parsed=parseFiestaShares(csv,eventCode,options),target=parsed.records.find(r=>identity(r)===identity(record));
 if(!target)throw new Error('This guest is missing from the source import. Refresh the review.');
 const normalized=parseFiestaPostalAnswers([
  ['Full Name',input.name],['Address',input.address_line1],['Apartment/Suite',input.address_line2||''],
  ['City',input.address_city],['State',input.address_state],['Zip Code',input.address_zip],['Country',input.address_country],
 ]).recipient;
 const address=normalizeUsMailAddress(normalized);
 if(!address||!/[a-z]/i.test(address.address_line1))throw new Error('Enter a complete US address, a valid state and a five-digit ZIP (including any leading zero).');
 const fields={full:['Full Name',address.name],line1:['Address',address.address_line1],line2:['Apartment/Suite',address.address_line2],city:['City',address.address_city],state:['State',address.address_state],zip:['Zip Code',address.address_zip],country:['Country',address.address_country]};
 const grid=parseFiestaCsvGrid(csv),header=grid[0];
 const matches=grid.slice(1).filter(row=>row[4].trim()===target.filename&&(row[0].trim()==='E-mail'?'EMAIL':'SMS')===target.channel&&(target.channel==='EMAIL'?row[1].trim().toLowerCase():'+'+row[2].trim().replace(/^\+/,''))===target.recipient);
 for(const row of matches){
  const found=new Set();
  for(let j=6;j<row.length;j+=2){const key=fiestaPostalField(row[j]);if(fields[key]){row[j+1]=fields[key][1];found.add(key);}}
  for(const [key,[question,value]]of Object.entries(fields))if(!found.has(key)){
   let slot=-1;for(let j=6;j<header.length;j+=2)if(!row[j]?.trim()&&!row[j+1]?.trim()){slot=j;break;}
   if(slot<0){if(header.length>=66)throw new Error('This source has no free survey columns for an address correction.');slot=header.length;const suffix=slot===6?'':` ${(slot-6)/2+1}`;header.push('Question'+suffix,'Answer'+suffix);for(const other of grid.slice(1))other.push('','');}
   row[slot]=question;row[slot+1]=value;
  }
 }
 const corrected=serialize(grid),check=parseFiestaShares(corrected,eventCode,options);
 if(check.records.length!==parsed.records.length||check.records.some((r,i)=>identity(r)!==identity(parsed.records[i])))throw new Error('The correction changed a sharing identity.');
 return {csv:corrected,address};
}
