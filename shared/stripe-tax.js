const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function stripeTaxBreakdown(session,{expectedPrincipalCents,currency,automaticTaxRequired=false}={}){
 if(automaticTaxRequired&&!Number.isSafeInteger(session.total_details?.amount_tax))throw new Error('Stripe final tax amount is missing.');
 const gross=session.amount_total,tax=session.total_details?.amount_tax??0,discount=session.total_details?.amount_discount??0;
 if(!integer(gross)||!integer(tax)||!integer(discount)||tax>gross||!integer(session.amount_subtotal)||session.amount_subtotal-discount+tax!==gross)throw new Error('Stripe payment totals are inconsistent.');
 if(gross-tax!==expectedPrincipalCents||String(session.currency).toUpperCase()!==String(currency).toUpperCase()||session.payment_status!=='paid')throw new Error('Stripe payment does not match the service checkout.');
 if(automaticTaxRequired&&(session.automatic_tax?.enabled!==true||session.automatic_tax?.status!=='complete'))throw new Error('Stripe automatic tax is not complete.');
 return {subtotal:session.amount_subtotal/100,discount:discount/100,principal:(gross-tax)/100,tax:tax/100,total:gross/100,automaticTaxEnabled:session.automatic_tax?.enabled===true,automaticTaxStatus:session.automatic_tax?.status||null,addressAvailable:Boolean(session.customer_details?.address?.country||session.shipping_details?.address?.country||session.collected_information?.shipping_details?.address?.country)};
}
// Allocate the selected installment across already discounted service lines.
// This allocates principal only; Stripe alone determines tax on each line.
export function installmentLines(items,principalCents,defaultTaxCode){
 if(!integer(principalCents)||principalCents<=0||!/^txcd_\d{8}$/.test(defaultTaxCode||''))throw new Error('A valid service amount and confirmed Stripe tax code are required.');
 const lines=items.map(item=>({name:item.description||item.label||'LOLA event services',weight:Math.max(0,Math.round(Number(item.line_total??item.total??Number(item.quantity)*Number(item.unit_price))*100)),taxCode:item.stripe_tax_code||(item.taxable===false?'txcd_00000000':defaultTaxCode)})).filter(item=>item.weight>0);
 if(!lines.length)throw new Error('Invoice service lines are required for automatic tax.');
 if(lines.some(item=>!/^txcd_\d{8}$/.test(item.taxCode)))throw new Error('Invalid Stripe product tax code.');
 const sum=lines.reduce((n,item)=>n+item.weight,0),allocated=lines.map((item,index)=>({...item,index,amount:Math.floor(principalCents*item.weight/sum),remainder:(principalCents*item.weight)%sum}));
 let remaining=principalCents-allocated.reduce((n,item)=>n+item.amount,0);
 for(const item of [...allocated].sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){if(remaining-->0)item.amount++;}
 return allocated.filter(item=>item.amount>0).map(({name,amount,taxCode})=>({name,amount,taxCode}));
}
export function paymentTaxSummary(payment){return {subtotal:Math.round((Number(payment.amount||0)-Number(payment.tax_amount||0))*100)/100,tax:Number(payment.tax_amount||0),total:Number(payment.amount||0)};}
