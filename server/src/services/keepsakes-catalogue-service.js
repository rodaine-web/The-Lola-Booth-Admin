import {query} from '../db/pool.js';
import {prodigiVariant,prodigiStatus} from './prodigi-service.js';
import {assertKeepsakes} from './keepsakes-service.js';
export const curatedKeepsakesSkus=[
 {sku:'GLOBAL-MUG-W',title:'Photo Mug',category:'mug'},
 {sku:'GLOBAL-PHO-4X6',title:'Photo Prints',category:'print'},
 {sku:'GLOBAL-CFP-12X16',title:'Framed Photo Prints',category:'frame'},
 {sku:'MAG-1-10X10',title:'Photo Magnet',category:'magnet'},
];
export async function syncKeepsakesCatalogue(){
 assertKeepsakes();const items=[];
 for(const candidate of curatedKeepsakesSkus){
  try{
   const variant=await prodigiVariant(candidate.sku);
   const data={...candidate,printAreas:variant.printAreas||[],attributeOptions:variant.attributeOptions||{},attributes:variant.attributes||{},shipsTo:variant.shipsTo||[],sizeLabel:variant.sizeLabel||null};
   await query('INSERT INTO keepsakes_catalogue_variants(sku,data,checked_at) VALUES($1,$2,now()) ON CONFLICT(sku) DO UPDATE SET data=$2,checked_at=now(),last_error=NULL',[candidate.sku,JSON.stringify(data)]);
   items.push({...data,status:'CATALOGUE_FOUND',purchasable:false});
  }catch(error){
   await query('INSERT INTO keepsakes_catalogue_variants(sku,last_error) VALUES($1,$2) ON CONFLICT(sku) DO UPDATE SET last_error=$2',[candidate.sku,error.code||'CATALOGUE_ERROR']);items.push({...candidate,status:'NEEDS_REVIEW',purchasable:false});
  }
 }return {items,message:'Catalogue checks do not activate listings. Review exact print templates, attributes, prices and destination quotes.'};
}
export async function keepsakesProdigiIntegration(){
 const items=(await query('SELECT sku,data,checked_at,last_error FROM keepsakes_catalogue_variants ORDER BY sku')).rows;
 return {...prodigiStatus(),status:prodigiStatus().readiness,lastSync:items.map(i=>i.checked_at).filter(Boolean).sort().at(-1)||null,items,callbacks:'Scheduled polling. Signed subscription not configured.'};
}
