/** Carry an accepted composed quote into invoice accounting without recomputing its agreed totals. */
export function proposalInvoiceSnapshot(proposal) {
  const quote=proposal.content?.scenario;
  if(!quote)return null;
  const pricing=quote.pricing,lines=quote.lines;
  const cents=value=>Math.round(Number(value||0)*100);
  const subtotal=lines.reduce((sum,line)=>sum+cents(line.line_total),0);
  let allocatedDiscount=0,allocatedTax=0;
  const items=lines.map((line,index)=>{
    const last=index===lines.length-1,gross=cents(line.line_total),weight=subtotal?gross/subtotal:0;
    const discount=last?cents(pricing.discount)-allocatedDiscount:Math.round(cents(pricing.discount)*weight);
    const tax=last?cents(pricing.tax)-allocatedTax:Math.round(cents(pricing.tax)*weight);
    allocatedDiscount+=discount;allocatedTax+=tax;
    const quantity=Number(line.quantity)||1;
    return {description:line.description,quantity,unit_price:gross/100/quantity,taxable:true,tax_rate:Number(pricing.tax_rate)||0,discount:discount/100,tax:tax/100,line_total:(Math.max(0,gross-discount)+tax)/100};
  });
  return {...pricing,items};
}
