const categories={STANDARD:'PRIVATE_CELEBRATION',PROFESSIONAL:'PROFESSIONAL',ACTIVATION:'ACTIVATION',CUSTOM:'CUSTOM_PRODUCTION'};
// A quote request expresses interest in custom service; selected packages set its pricing catalog.
export function proposalPricingCatalog(selected,packages){
 const rows=selected.map(item=>packages.find(pkg=>pkg.id===item.package_id)).filter(Boolean);
 const fixed=[...new Set(rows.filter(pkg=>!pkg.pricing_profile?.quoteRequired).map(pkg=>pkg.catalog_key))];
 if(fixed.length>1)throw Error('Choose packages from the same pricing catalog before calculating. Custom production may be combined with that catalog.');
 return fixed[0]||(rows.length?'CUSTOM':null);
}
export function proposalPricingCategory(catalog,current,customer){
 if(catalog==='STANDARD'&&['PRIVATE_CELEBRATION','COMPANY_CELEBRATION'].includes(current))return current;
 return catalog==='STANDARD'&&customer==='BUSINESS'?'COMPANY_CELEBRATION':categories[catalog]||current;
}

// Saved proposals store net additional-experience prices. Requoting must not
// discount that net amount for a second time.
export function proposalBusinessBaseCents(selection,row,previousQuote){
 const entered=Math.round(Number(selection.price)*100);
 if(!row.pricing_profile?.businessPlan||selection.priceIsBaseRate)return entered;
 const saved=previousQuote?.lines?.find(l=>l.type==='PACKAGE'&&l.packageId===row.id);
 return saved&&saved.amountCents===entered?(saved.originalUnitPriceCents??saved.unitPriceCents):entered;
}
