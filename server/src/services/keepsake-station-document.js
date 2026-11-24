import fs from 'node:fs/promises';
import sharp from 'sharp';
import {KEEPSAKES_CORE_PRODUCTS} from '../../../shared/keepsakes-core-catalogue.js';
export async function stationDocumentImages(quote){
 if(!quote)return null;const images={};
 for(const key of new Set(quote.lines.map(l=>l.key).filter(k=>k!=='station'))){const product=KEEPSAKES_CORE_PRODUCTS.find(p=>p.key===key);if(!product)continue;const bytes=await fs.readFile(new URL('../../../public'+product.image,import.meta.url));images[key]='data:image/png;base64,'+(await sharp(bytes).png().toBuffer()).toString('base64');}
 return images;
}
export function stationDocumentSections(sections,quote){return quote?sections.flatMap(s=>s.kind==='investment'?[{kind:'keepsakes',title:'Your Keepsake Experience'},s]:[s]):sections;}
export function stationLineDescription(line){return line.key==='station'?`${line.hours} hours · ${line.location||'Keepsake Station'} · attendant, equipment, setup and breakdown included`:`${line.quantity} ${line.title}${line.complimentary?'':` · $${(line.unitCents/100).toFixed(2)} each`} · ${line.complimentary?'Complimentary Keepsakes':line.fulfillment==='LOB'?'Printed and mailed through Lob':'Purchased · in-house production'}`;}
export const stationProductionNote='Product examples are illustrative. Your event photographs will be selected when available. Staff, materials and production capacity are reviewed before manufacturing. Any post-event fulfillment arrangement requires your approval.';
