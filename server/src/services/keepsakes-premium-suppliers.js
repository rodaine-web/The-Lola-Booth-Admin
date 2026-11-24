import {AppError} from '../utils/errors.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
const pathPart=value=>{if(!/^[a-zA-Z0-9_.,×x-]{1,400}$/.test(value||''))throw new AppError('Choose a product from the supplier catalogue.',422,'SUPPLIER_PRODUCT_INVALID');return encodeURIComponent(value);};
async function read(provider,path,{body,request=fetch}={}){
 const whcc=provider==='WHCC',key=whcc?process.env.WHCC_TEST_API_KEY:process.env.GELATO_API_KEY;
 if(!key)throw new AppError(`${whcc?'WHCC test':'Gelato'} credentials are not configured.`,409,'SUPPLIER_NOT_CONFIGURED');
 // No order creation endpoint is exposed here. WHCC is pinned to its test host.
 const base=whcc?'https://apis-stage.whcc.com/api':'https://product.gelatoapis.com';
 const response=await request(base+path,{method:body?'POST':'GET',headers:{...(whcc?{Authorization:'Bearer '+key,'WHCC-API-Version':'2026-10'}:{'X-API-KEY':key}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new AppError(`${provider} catalogue request failed (${response.status}). Check the key and product access.`,502,'SUPPLIER_CATALOGUE_ERROR');
 return response.json();
}
export async function premiumSupplierCatalogue(provider,options,user,{request=fetch}={}){
 assertKeepsakesManager(user);if(!['WHCC','GELATO'].includes(provider))throw new AppError('Supplier unavailable.',404,'NOT_FOUND');
 let data;
 if(provider==='WHCC')data=await read(provider,options.product?'/v1/catalog/products/'+pathPart(options.product):'/v1/catalog/products?limit=200'+(options.cursor?'&cursor='+encodeURIComponent(options.cursor):''),{request});
 else if(options.product)data=await read(provider,'/v3/products/'+pathPart(options.product),{request});
 else if(options.catalog)data=await read(provider,'/v3/catalogs/'+pathPart(options.catalog)+(options.search?'/products:search':''),{request,...(options.search?{body:{limit:50,offset:options.offset||0,attributeFilters:{}}}:{})});
 else data=await read(provider,'/v3/catalogs',{request});
 return {provider,readOnly:true,checkedAt:new Date().toISOString(),data};
}
