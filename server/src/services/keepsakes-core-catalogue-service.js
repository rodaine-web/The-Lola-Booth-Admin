import {startingBookPrice} from '../../../shared/keepsakes-books.js';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertKeepsakes} from './keepsakes-service.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
import {writeAudit} from './audit-service.js';
import {coreCatalogueView,keepsakesCoreProduct} from '../../../shared/keepsakes-core-catalogue.js';
export async function keepsakesCoreCatalogue({admin=false}={}){
 assertKeepsakes();
 const rows=(await query('SELECT * FROM keepsakes_products WHERE catalogue_key IS NOT NULL AND retired_at IS NULL')).rows;
 const settings=(await query("SELECT entity_key,payload->>'value' AS value FROM website_channel_records WHERE channel='STAGING' AND cms_type='settings' AND status='PUBLISHED' AND entity_key=ANY($1::text[])",[['contact_email','phone','service_area','instagram_url','tiktok_url','copyright_text']])).rows;
 const variants=(await query("SELECT * FROM keepsakes_book_variants WHERE audience='GUEST'")).rows;
 return {products:coreCatalogueView(rows).map(p=>({...p,...(admin?{operationalConfig:rows.find(r=>r.id===p.productId)?.operational_config||{},taxCode:rows.find(r=>r.id===p.productId)?.tax_code||''}:{})})).map(p=>p.key==='photo-book'?{...p,retailCents:null,startingCents:startingBookPrice(variants)}:p),branding:Object.fromEntries(settings.map(r=>[r.entity_key,r.value]))};
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

export async function configureCoreRetail(key,raw,user){
 assertKeepsakes();assertKeepsakesManager(user);const core=keepsakesCoreProduct(key);
 if(!core||!['IN_HOUSE','DIGITAL_EDIT','LOB'].includes(core.route))throw new AppError('This product needs verified supplier ordering and its final editor before activation.',409,'KEEPSAKES_CONFIGURATION_PENDING');
 const {keepsakesPrintSpec}=await import('../../../shared/keepsakes.js');
 const {PRODUCT_IMAGE_IDS}=await import('../../../shared/keepsakes-product-assets.js');
 const data=z.object({active:z.boolean(),taxCode:z.string().regex(/^txcd_\d{8}$/),reason:z.string().trim().min(10).max(1000),productionReady:z.boolean().default(false),editingReady:z.boolean().default(false),stockUnits:z.number().int().min(0).max(100000).nullable().default(null),shippingCents:z.number().int().min(0).max(100000).nullable().default(null),variants:z.array(z.object({id:z.string().regex(/^[-\w.]{1,150}$/),label:z.string().trim().min(1).max(120),previewAssetId:z.string().max(100).optional(),printSpec:keepsakesPrintSpec.optional(),dimensions:z.string().trim().max(100).optional()}).strict()).min(1).max(30)}).strict().parse(raw);
 if(new Set(data.variants.map(v=>v.id)).size!==data.variants.length)throw new AppError('Use unique variant identifiers.',422,'KEEPSAKES_VARIANTS');
 for(const v of data.variants){if(v.previewAssetId==='frame-metal')throw new AppError('Metal frames are coming soon; the supplier ordering configuration is not ready.',409,'KEEPSAKES_CONFIGURATION_PENDING');if(v.previewAssetId&&!PRODUCT_IMAGE_IDS[key]?.includes(v.previewAssetId))throw new AppError('Use an approved image belonging to this product.',422,'KEEPSAKES_VARIANT_IMAGE');if(core.route!=='DIGITAL_EDIT'&&!['keychain','magnet'].includes(key)&&(!v.printSpec||!v.dimensions))throw new AppError('Physical products need their confirmed dimensions and print specification.',422,'KEEPSAKES_PRINT_SPEC');}
 if(data.active&&((core.route==='IN_HOUSE'&&(!data.productionReady||data.stockUnits!=null&&data.stockUnits<1))||(core.route==='DIGITAL_EDIT'&&!data.editingReady)))throw new AppError('Confirm the editing or stock and production capacity before activation.',422,'KEEPSAKES_OPERATIONS');
 const variants=data.variants.map(v=>({...v,...(core.route==='LOB'?{backTemplate:'lola-connect-v2'}:{})}));
 return transaction(async()=>{const row=(await query('SELECT * FROM keepsakes_products WHERE catalogue_key=$1 AND retired_at IS NULL FOR UPDATE',[key])).rows[0];if(!row||!row.retail_cents)throw new AppError('Save the retail price first.',409,'KEEPSAKES_PRICE_REQUIRED');
 await query('UPDATE keepsakes_products SET active=$2,verified=true,verified_at=now(),tax_code=$3,variants=$4,operational_config=$5,updated_at=now() WHERE id=$1',[row.id,data.active,data.taxCode,JSON.stringify(variants),JSON.stringify({productionReady:data.productionReady,editingReady:data.editingReady,stockConfirmed:true,stockUnits:data.stockUnits,shippingCents:data.shippingCents,reason:data.reason})]);
 await writeAudit({req:{user},action:'keepsakes_retail_configured',entity:'keepsakes',entityId:row.id,after:{key,...data}});return {saved:true};});
}
