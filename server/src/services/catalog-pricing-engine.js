import {AppError} from '../utils/errors.js';

function invalid(message) { throw new AppError(message,422,'PRICING_INVALID'); }
export function minorUnits(value) {
  const text=String(value??'0');
  if(!/^\d+(\.\d{1,2})?$/.test(text))invalid('Use a nonnegative amount with at most two decimal places.');
  const [whole,fraction='']=text.split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount))invalid('Amount exceeds the supported range.');
  return amount;
}
function integer(value,min=0,max=1000000){if(!Number.isSafeInteger(value)||value<min||value>max)invalid('Invalid pricing quantity.');return value;}
const moneyInteger=value=>integer(value,0,Number.MAX_SAFE_INTEGER);
export const eventCatalogs=Object.freeze({PRIVATE_CELEBRATION:'STANDARD',COMPANY_CELEBRATION:'STANDARD',PROFESSIONAL:'PROFESSIONAL',ACTIVATION:'ACTIVATION',CUSTOM_PRODUCTION:'CUSTOM'});
export function selectPricingCatalog(category,requested,{admin=false,reason=''}={}){
  const expected=eventCatalogs[category];if(!expected)invalid('Choose an event category.');
  const selected=requested||expected;
  if(!['STANDARD','PROFESSIONAL','ACTIVATION','CUSTOM'].includes(selected))invalid('Unknown pricing catalog.');
  if(selected!==expected&&!(category==='PROFESSIONAL'&&selected==='STANDARD')&&!(admin&&reason.trim()))invalid('A catalog override requires Admin approval and a reason.');
  return selected;
}
export function printUpgrade(experience,included,selected,matrix){
  integer(included);integer(selected);
  if(!['glam','vogue'].includes(experience)){if(selected||included)invalid('Printing is available only for Glam and Vogue.');return 0;}
  if(selected<included)invalid('Selected prints cannot be less than the included allowance.');
  const price=n=>n===0?0:matrix?.[experience]?.[n];
  if(price(included)==null||price(selected)==null)invalid('This print allowance requires an approved custom quote.');
  return Math.max(0,integer(price(selected))-integer(price(included)));
}

// Evidence is supplied only by a trusted routing adapter or an audited Admin review.
// No radius, state boundary, or fabricated route is substituted for driving coverage.
export function travelPricing({allowanceMinutes,rules,route,extraTrips=false}){
  const review=reasons=>({status:'REVIEW_REQUIRED',amountCents:null,reasons,allowanceMinutes,dispatch:rules.dispatchLabel,policy:'CHICAGO_BOUNDARY_DRIVING'});
  if(extraTrips)return review(['Additional trips or vehicles require logistics review.']);
  if(!route?.verified||!route.venueValidated)return review(['A validated venue and verified route are required.']);
  if(!route.source||!route.calculatedAt)return review(['Routing evidence is incomplete.']);
  if(route.flags?.length)return review(route.flags);
  if(!Number.isFinite(route.oneWayMinutes)||route.oneWayMinutes<0)return review(['Driving time is unavailable.']);
  if(route.oneWayMinutes>=rules.manualReviewMinutes)return review(['One-way travel meets the manual-review threshold.']);
  if(route.insideChicago===true)return {status:'INCLUDED',amountCents:0,allowanceMinutes,evidence:route};
  if(route.insideChicago!==false||route.boundaryVerified!==true)return review(['Chicago boundary crossing could not be verified.']);
  const miles=route.excessMilesByAllowance?.[allowanceMinutes];
  if(!Number.isFinite(miles)||miles<0)return review(['Driving mileage beyond the included allowance is unavailable.']);
  return {status:miles?'CHARGE':'INCLUDED',amountCents:Math.round(miles*integer(rules.mileageRateCents)),allowanceMinutes,excessOneWayMiles:miles,evidence:route};
}

export function calculateCatalogQuote({version,selections,eventCategory,customerType='INDIVIDUAL',catalogKey,discountCents=0,customItems=[],route,extraTrips=false,override},catalog,{admin=false}={}){
  if(!['INDIVIDUAL','BUSINESS','ORGANIZATION'].includes(customerType))invalid('Choose a customer type.');
  const selectedCatalog=selectPricingCatalog(eventCategory,catalogKey,{admin,reason:override?.reason||''});
  if(!Array.isArray(selections)||!selections.length||selections.length>4)invalid('Choose one to four experiences.');
  const lines=[],seen=new Set(),entitlements=[],reasons=[];let allowance=0;
  for(const choice of selections){
    const pkg=catalog.packages.find(p=>p.id===choice.packageId&&p.active&&(p.catalog_key===selectedCatalog||(selectedCatalog==='CUSTOM'&&p.pricing_profile?.quoteRequired)));
    if(!pkg)invalid('Choose an active package in the selected catalog.');
    const profile=pkg.pricing_profile;if(!profile)invalid('Package pricing rules are missing.');
    if(seen.has(profile.experience))invalid('Select each experience once.');seen.add(profile.experience);
    const scopeApproval=override?.scopeApprovals?.find(item=>item.packageId===pkg.id);
    if(scopeApproval&&(!admin||!override.reason?.trim()||!scopeApproval.description?.trim()))invalid('Scope approval requires an Admin reason and an explicit description.');
    const priceOverride=override?.packagePrices?.find(item=>item.packageId===pkg.id);
    if((pkg.pricing_mode==='CUSTOM'||profile.quoteRequired)&&(!scopeApproval||!priceOverride)){reasons.push('Custom production requires an approved scope and price.');entitlements.push({packageId:pkg.id,packageName:pkg.name,...profile,scopeApproved:false});continue;}
    if(priceOverride&&(!admin||!override.reason?.trim()))invalid('Package price overrides require Admin approval and a reason.');
    const base=priceOverride?moneyInteger(priceOverride.amountCents):minorUnits(pkg.starting_price);allowance=Math.max(allowance,profile.travelMinutes||0);
    const addLine=(type,description,quantity,unitCents)=>{const amount=integer(quantity,1,10000)*moneyInteger(unitCents);moneyInteger(amount);lines.push({type,description,quantity,unitPriceCents:unitCents,amountCents:amount,packageId:pkg.id,experience:profile.experience});};
    const experienceLabel={glam:'The LOLA Glam','360':'The LOLA 360',vogue:'The LOLA Vogue',audio:'Audio Guest Book'}[profile.experience];
    addLine('PACKAGE',pkg.name.includes('—')?pkg.name:`${experienceLabel} — ${pkg.name}`,1,base);
    const included=profile.prints||0,selected=choice.prints??included;
    const printFormat=choice.printFormat||'4X6';
    if(!['4X6','2X6'].includes(printFormat))invalid('Choose a supported print format.');
    const unlimited=choice.unlimitedPrints===true;
    if(unlimited&&!['glam','vogue'].includes(profile.experience))invalid('Printing is available only for Glam and Vogue.');
    integer(selected);if(selected<included)invalid('Selected prints cannot be less than the included allowance.');
    const customPrinting=unlimited||(['glam','vogue'].includes(profile.experience)&&selected>0&&catalog.rules.printPrices?.[profile.experience]?.[selected]==null);
    const printApproval=override?.printApprovals?.find(item=>item.packageId===pkg.id&&item.selectedPrints===selected&&Boolean(item.unlimitedPrints)===unlimited);
    if(printApproval&&(!admin||!override.reason?.trim()))invalid('Print allowance overrides require an audited Admin approval.');
    let upgrade;
    if(customPrinting){if(printApproval)upgrade=moneyInteger(printApproval.amountCents);else {reasons.push('High-volume or unlimited printing requires an approved scope and print charge.');upgrade=0;}}
    else upgrade=printUpgrade(profile.experience,included,selected,catalog.rules.printPrices);
    if(upgrade)addLine('PRINT_UPGRADE',`${unlimited?'Unlimited':selected} total physical prints (${included} included)`,1,upgrade);
    if(upgrade)lines[lines.length-1].stripeTaxCode='txcd_20090028'; // Owner-approved Printing classification, retained on invoice items.
    const hours=integer(choice.extraHours??0,0,24);
    if(hours){if(!profile.extraHourCents)invalid('Additional rental time requires a quote.');addLine('EXTRA_HOURS','Additional service hours',hours,profile.extraHourCents);}
    const addonSeen=new Set();
    for(const chosen of choice.addons||[]){
      if(addonSeen.has(chosen.addonId))invalid('Select each add-on only once per experience.');addonSeen.add(chosen.addonId);
      const addon=catalog.addons.find(a=>a.id===chosen.addonId&&a.active),policy=addon?.pricing_policy;
      if(!addon||!policy)invalid('Choose a configured add-on.');
      if(addonSeen.has('key:'+policy.key))invalid('This enhancement was already selected.');addonSeen.add('key:'+policy.key);
      if(!policy.experiences?.includes(profile.experience)||(policy.packageIds?.length&&!policy.packageIds.includes(pkg.id)))invalid('Add-on is incompatible with this package.');
      if(['PRINTS','EXTRA_HOURS','TRAVEL'].includes(policy.category))invalid('Use the dedicated print, hours or travel selection.');
      if(profile.includedAddonKeys?.includes(policy.key))invalid('This enhancement is already included in the package.');
      const qty=integer(chosen.quantity??1,policy.minQuantity||1,policy.maxQuantity||1);
      const approval=override?.addonApprovals?.find(item=>item.addonId===addon.id&&item.packageId===pkg.id);
      if(approval&&(!admin||!override.reason?.trim()||!approval.description?.trim()))invalid('Add-on scope and price require an audited Admin approval.');
      if((['CUSTOM','FROM','CALCULATED'].includes(policy.method)||policy.approvalRequired)&&!approval){reasons.push(`${addon.name} requires an approved quote.`);continue;}
      addLine('ADDON',approval?`${addon.name} — ${approval.description}`:addon.name,qty,approval?moneyInteger(approval.unitPriceCents):minorUnits(addon.price));
    }
    if(profile.deliveryApprovalRequired&&!scopeApproval)reasons.push(`${pkg.name} has deliverables requiring Admin approval.`);
    if(profile.startingAt&&!scopeApproval)reasons.push(`${pkg.name} is a starting price; scope requires review.`);
    const sheets=unlimited?null:printFormat==='2X6'?Math.ceil(selected/2):selected;
    const printOperations=catalog.rules.printOperations||{};
    if(sheets!=null&&printOperations.sheetsPerHour&&profile.serviceHours&&sheets/printOperations.sheetsPerHour>profile.serviceHours+hours&&!scopeApproval)reasons.push('Printing exceeds estimated single-printer capacity. Confirm the equipment and service plan.');
    entitlements.push({packageId:pkg.id,packageName:pkg.name,...profile,selectedPrints:selected,unlimitedPrints:unlimited,printFormat,extraHours:hours,...(scopeApproval?{approvedScope:scopeApproval.description}: {}),printEstimate:{physicalPrints:unlimited?null:selected,sheets4x6:sheets,consumableCostCents:sheets==null||printOperations.costPerSheetCents==null?null:moneyInteger(sheets*moneyInteger(printOperations.costPerSheetCents)),printerHours:sheets==null||!printOperations.sheetsPerHour?null:sheets/printOperations.sheetsPerHour}});
  }
  let travel=travelPricing({allowanceMinutes:allowance,rules:catalog.rules,route,extraTrips});
  if(override?.travelAmountCents!==undefined){
    if(!admin||!override.reason?.trim())invalid('Travel overrides require Admin approval and a reason.');
    travel={status:'MANUAL_APPROVED',amountCents:moneyInteger(override.travelAmountCents),allowanceMinutes:allowance,reason:override.reason,original:travel};
  }
  if(travel.status==='REVIEW_REQUIRED')reasons.push(...travel.reasons);
  if(travel.amountCents)lines.push({type:'TRAVEL',description:'Travel & Logistics — Outside Included Coverage',quantity:1,unitPriceCents:travel.amountCents,amountCents:travel.amountCents});
  if(customItems.length){
    if(!admin||!override?.reason?.trim())invalid('Custom charges require an audited Admin reason.');
    for(const item of customItems){if(!item.description?.trim())invalid('Describe each custom charge.');const quantity=integer(item.quantity,1,10000),unit=moneyInteger(item.unitPriceCents);lines.push({type:'CUSTOM',description:item.description,quantity,unitPriceCents:unit,amountCents:moneyInteger(quantity*unit)});}
  }
  moneyInteger(discountCents);if(discountCents&&(!admin||!override?.reason?.trim()))invalid('Discounts require Admin approval and a reason.');
  const subtotal=lines.reduce((sum,line)=>sum+line.amountCents,0);moneyInteger(subtotal);
  if(discountCents>subtotal)invalid('Discount exceeds the subtotal.');
  return {schemaVersion:1,catalogVersion:version,catalogKey:selectedCatalog,eventCategory,customerType,currency:'USD',lines,entitlements,travel,discountCents,subtotalCents:subtotal,serviceTotalCents:subtotal-discountCents,tax:{status:'CALCULATED_AT_PAYMENT',addressSource:'BILLING',amountCents:null},status:reasons.length?'REVIEW_REQUIRED':'PRICED',reviewReasons:[...new Set(reasons)],override:override&&admin?override:null};
}
