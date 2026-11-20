// Disposable synthetic files for strict Microsoft Open XML validation in CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildPostcardWorkbook} from '../../server/src/services/postcard-report-workbook.js';
const out=process.argv[2];if(!out)throw Error('Provide a temporary output directory.');
await fs.mkdir(out,{recursive:true});
for(const size of [0,1,87]){
 const rows=Array.from({length:size},(_,i)=>({filename:`photo-${i}.jpg`,name:'Synthetic & sample <recipient>',email:'sample@example.invalid',phone:'+12025550100',photoUrl:i%2?'https://gallery.thelolabooth.com/gallery/photo/synthetic-'+i:null,address:{address_line1:'100 Sample St',address_city:'Sample City',address_state:'MA',address_zip:'01234'},status:i%3?'SUBMITTED':'HELD',reason:'Synthetic compatibility check.',submittedAt:'2035-11-18T18:00:00Z',mailedAt:'2035-11-19T18:00:00Z',expectedDelivery:'2035-11-25'}));
 await fs.writeFile(path.join(out,`postcard-${size}.xlsx`),await buildPostcardWorkbook({eventName:'Synthetic report & gallery',createdAt:'2035-11-19T12:00:00Z',summary:{images:size,combinations:size},rows}));
}
