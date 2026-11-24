import {startingBookPrice} from '../../../shared/keepsakes-books.js';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertKeepsakes} from './keepsakes-service.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
import {writeAudit} from './audit-service.js';
import {coreCatalogueView,keepsakesCoreProduct} from '../../../shared/keepsakes-core-catalogue.js';
export async function keepsakesCoreCatalogue(){
 assertKeepsakes();
 const rows=(await query('SELECT id,catalogue_key,retail_cents FROM keepsakes_products WHERE catalogue_key IS NOT NULL AND retired_at IS NULL')).rows;
 const settings=(await query("SELECT entity_key,payload->>'value' AS value FROM website_channel_records WHERE channel='STAGING' AND cms_type='settings' AND status='PUBLISHED' AND entity_key=ANY($1::text[])",[['contact_email','phone','service_area','instagram_url','tiktok_url','copyright_text']])).rows;
 const variants=(await query("SELECT * FROM keepsakes_book_variants WHERE audience='GUEST'")).rows;
 return {products:coreCatalogueView(rows).map(p=>p.key==='photo-book'?{...p,retailCents:null,startingCents:startingBookPrice(variants)}:p),branding:Object.fromEntries(settings.map(r=>[r.entity_key,r.value]))};
}
export async function saveCoreCataloguePrice(key,input,user){
 assertKeepsakesManager(user);
 if(!keepsakesCoreProduct(key))throw new AppError('Product unavailable.',404,'NOT_FOUND');
 const {retailCents}=z.object({retailCents:z.number().int().min(1).max(100000)}).strict().parse(input);
 return transaction(async()=>{
 const result=await query('UPDATE keepsakes_products SET retail_cents=$2,updated_at=now() WHERE catalogue_key=$1 AND retired_at IS NULL RETURNING id',[key,retailCents]);
 if(!result.rowCount)throw new AppError('Catalogue migration is required.',409,'KEEPSAKES_CATALOGUE_UNAVAILABLE');
 await writeAudit({req:{user},action:'keepsakes_core_price_updated',entity:'keepsakes',entityId:result.rows[0].id,after:{key,retailCents}});
 return {saved:true};
 });
}
