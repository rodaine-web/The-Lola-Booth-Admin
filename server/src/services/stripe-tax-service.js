import {AppError} from '../utils/errors.js';
import {query} from '../db/pool.js';
import {logger} from '../config/logger.js';
import {installmentLines,stripeTaxBreakdown} from '../../../shared/stripe-tax.js';
export async function stripeTaxCheckout(invoice,amount){
 if(process.env.STRIPE_AUTOMATIC_TAX_ENABLED!=='true')return null;
 if(Number(invoice.tax||0)!==0)throw new AppError('This invoice already includes manual tax. Admin must review it before using automatic tax.',409,'STRIPE_LEGACY_TAX_REVIEW');
 const code=process.env.STRIPE_TAX_CODE;
 if(!/^txcd_\d{8}$/.test(code||''))throw new AppError('A reviewed Stripe service tax code is required before automatic tax activation.',503,'STRIPE_TAX_CODE_REQUIRED');
 let overrides={};
 try{overrides=JSON.parse(process.env.STRIPE_TAX_CODE_OVERRIDES||'{}');if(!overrides||Array.isArray(overrides)||typeof overrides!=='object'||Object.values(overrides).some(value=>!/^txcd_\d{8}$/.test(value)))throw Error();}catch{throw new AppError('Stripe tax-code overrides need reviewed exact codes.',503,'STRIPE_TAX_CODE_REQUIRED');}
 const items=(await query('SELECT description,label,quantity,unit_price,line_total,total,taxable,tax_rate,stripe_tax_code FROM invoice_items WHERE invoice_id=$1 ORDER BY id',[invoice.id])).rows;
 if(items.some(item=>Number(item.tax_rate||0)!==0))throw new AppError("Remove duplicate manual tax through Admin review before automatic tax.",409,"STRIPE_LEGACY_TAX_REVIEW");
 try{return {lines:installmentLines(items.map(item=>({...item,stripe_tax_code:item.stripe_tax_code||overrides[item.description||item.label]||null})),Math.round(amount*100),code),taxCode:code};}
 catch(error){throw new AppError(error.message,409,'STRIPE_TAX_ITEMS_REQUIRED');}
}
export function validateStripeTaxSession(session,attempt){
 try{
  const breakdown=stripeTaxBreakdown(session,{expectedPrincipalCents:Math.round(Number(attempt.amount)*100),currency:attempt.currency,automaticTaxRequired:attempt.metadata?.automatic_tax_enabled===true});
  logger.info({sessionId:session.id,invoiceId:attempt.invoice_id,automaticTaxEnabled:breakdown.automaticTaxEnabled,taxStatus:breakdown.automaticTaxStatus,taxAmount:breakdown.tax,currency:attempt.currency,addressAvailable:breakdown.addressAvailable},'Stripe final tax verified');
  return breakdown;
 }catch(error){throw new AppError(error.message,409,'STRIPE_TAX_PAYMENT_MISMATCH');}
}
