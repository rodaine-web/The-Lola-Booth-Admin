import {businessIncludedCount,businessDiscounts,businessPlanTiers} from '../../../shared/business-plans.js';
import {AppError} from '../utils/errors.js';
const invalid=message=>{throw new AppError(message,422,'BUSINESS_PLAN_INVALID');};
export function businessPlanPricing(input,catalog,{admin=false}={}){
 const packages=input.selections.map(s=>catalog.packages.find(p=>p.id===s.packageId));
 if(!packages.some(p=>p?.pricing_profile?.businessPlan))return null;
 if(!admin)invalid('Business packages are available through an Admin quotation only.');
 if(packages.some(p=>!p?.active||!p.pricing_profile?.businessPlan))invalid('Choose one business plan for all selected experiences, or use Custom Build.');
 const tier=packages[0].tier_key;
 if(!businessPlanTiers.includes(tier)||packages.some(p=>p.tier_key!==tier))invalid('All business experiences must use the same package tier.');
 const included=input.businessPlan?.includedPackageIds;
 const count=businessIncludedCount(tier);
 if(!Array.isArray(included)||included.length!==count||new Set(included).size!==count||included.some(id=>!packages.some(p=>p.id===id)))invalid(`Choose exactly ${count} included experience${count===1?'':'s'} for this plan.`);
 const extras=packages.filter(p=>!included.includes(p.id)).length;
 let discountPercent=extras?businessDiscounts[count+':'+extras]:0;
 if(discountPercent==null){
  const manual=input.businessPlan?.additionalDiscountPercent;
  if(!Number.isInteger(manual)||manual<0||manual>100||!input.override?.reason?.trim())invalid('This combination requires an authorized custom discount (including 0%) and an audit reason.');
  discountPercent=manual;
 }
 return {tier,includedPackageIds:included,discountPercent,includedCount:count,additionalCount:extras,coverageHours:input.businessPlan?.coverageHours,scope:input.businessPlan?.scope||''};
}
