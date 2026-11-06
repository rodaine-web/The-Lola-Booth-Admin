import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client.js';
import {proposalPricingCatalog,proposalPricingCategory} from '../../shared/proposal-pricing-review.js';
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export default function CatalogQuoteReview({experiences,addons,customLines=[],discount=0,otherFees=0,travelAmount,onTravelChange,initialQuote,requestContext,onQuote,onReviewChange}){
 const [catalog,setCatalog]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[quote,setQuote]=useState(null);
 const [choices,setChoices]=useState(()=>Object.fromEntries((initialQuote?.entitlements||[]).map(p=>[p.packageId,{prints:p.selectedPrints,printFormat:p.printFormat||'4X6',extraHours:p.extraHours||0,unlimitedPrints:p.unlimitedPrints===true,printCharge:initialQuote?.override?.printApprovals?.find(a=>a.packageId===p.packageId)?.amountCents==null?'':initialQuote.override.printApprovals.find(a=>a.packageId===p.packageId).amountCents/100}])));
 const [addonPrices,setAddonPrices]=useState(()=>Object.fromEntries((initialQuote?.override?.addonApprovals||[]).map(item=>[item.addonId,item.unitPriceCents/100])));
 const selected=experiences.flatMap(item=>item.packages||[]);
 const campaignOnly=selected.length>0&&selected.every(p=>p.campaign_id);
 const travel=travelAmount??'';
 const key=JSON.stringify([experiences,addons,customLines,discount,otherFees,travel,choices,addonPrices,catalog?.id]);
 const latestKey=useRef(key);latestKey.current=key;
 const callbacks=useRef({onQuote,onReviewChange});callbacks.current={onQuote,onReviewChange};
 useEffect(()=>{let live=true;api.get('/public/pricing-catalog').then(value=>{if(live)setCatalog(value);}).catch(e=>{if(live&&e.status!==404)setError(e.message);});return()=>{live=false;};},[]);
 useEffect(()=>{
  callbacks.current.onQuote(null);setError('');
  if(!catalog||!selected.length||campaignOnly){setBusy(false);return;}
  let active=true;setBusy(true);setError('');
  const timer=setTimeout(async()=>{try{
   const packages=catalog.packages,catalogKey=proposalPricingCatalog(selected,packages);
   const customerType=initialQuote?.customerType||requestContext?.customerType||'INDIVIDUAL';
   const eventCategory=proposalPricingCategory(catalogKey,initialQuote?.eventCategory||requestContext?.eventCategory,customerType);
   const packagePrices=[];
   const selections=selected.map(pkg=>{
    const row=packages.find(p=>p.id===pkg.package_id);if(!row)throw Error('Choose a catalog package for each experience.');
    if(pkg.price===''||pkg.price==null||!Number.isFinite(Number(pkg.price)))throw Error(`Enter a price for ${pkg.name}.`);
    if(row.pricing_profile.quoteRequired||Number(pkg.price)!==Number(row.starting_price))packagePrices.push({packageId:row.id,amountCents:Math.round(Number(pkg.price)*100)});
    return {packageId:row.id,prints:choices[row.id]?.prints??row.pricing_profile.prints,printFormat:choices[row.id]?.printFormat||'4X6',extraHours:Number(choices[row.id]?.extraHours||0),unlimitedPrints:choices[row.id]?.unlimitedPrints===true,addons:[]};
   });
   const addonApprovals=[];
   for(const chosen of addons){
    const row=catalog.addons.find(a=>a.id===chosen.addon_id),policy=row?.pricing_policy;
    if(!policy)throw Error(`Choose a configured add-on for ${chosen.description||'this item'}.`);
    if(policy.category==='TRAVEL')throw Error('Enter travel in the Travel charge field.');
    const target=selections.find(s=>{const profile=packages.find(p=>p.id===s.packageId).pricing_profile;return policy.experiences?.includes(profile.experience)&&(!policy.packageIds?.length||policy.packageIds.includes(s.packageId))&&!profile.includedAddonKeys?.includes(policy.key);});
    if(!target)throw Error(`${row.name} is not available with the selected packages.`);
    const entered=addonPrices[row.id]??chosen.unit_price;
    const missingCustom=policy.method==='CUSTOM'&&Number(row.price||0)===0&&addonPrices[row.id]==null&&!Number(chosen.unit_price);
    const amount=missingCustom?'':entered??row.price;
    if(amount===''||amount==null||!Number.isFinite(Number(amount)))throw Error(`Enter a price for ${row.name}.`);
    target.addons.push({addonId:row.id,quantity:Number(chosen.quantity||1)});
    if(entered!=null||Number(amount)!==Number(row.price))addonApprovals.push({addonId:row.id,packageId:target.packageId,unitPriceCents:Math.round(Number(amount)*100)});
   }
   const printApprovals=[];
   for(const selection of selections){const profile=packages.find(p=>p.id===selection.packageId).pricing_profile;
    if(selection.unlimitedPrints||(['glam','vogue'].includes(profile.experience)&&selection.prints>0&&catalog.printPrices?.[profile.experience]?.[selection.prints]==null)){
     const charge=choices[selection.packageId]?.printCharge;if(charge==null||charge==='')throw Error('Enter the additional price for this custom print allowance.');
     printApprovals.push({packageId:selection.packageId,selectedPrints:selection.prints,unlimitedPrints:selection.unlimitedPrints,amountCents:Math.round(Number(charge)*100)});
    }
   }
   const customItems=customLines.map(line=>{if(!line.description?.trim()||line.unit_price===''||line.unit_price==null)throw Error('Enter a description and price for each custom item.');return {description:line.description,quantity:Number(line.quantity||1),unitPriceCents:Math.round(Number(line.unit_price)*100)};});
   if(Number(otherFees))customItems.push({description:'Other fees',quantity:1,unitPriceCents:Math.round(Number(otherFees)*100)});
   const result=await api.post('/pricing/quotes',{catalogVersion:catalog.id,eventCategory,customerType,catalogKey,selections,customItems,discountCents:Math.round(Number(discount)*100),override:{travelAmountCents:Math.round(Number(travel||0)*100),packagePrices,addonApprovals,printApprovals}});
   if(active&&latestKey.current===key){setQuote({key,...result});callbacks.current.onQuote(result);}
  }catch(e){if(active)setError(e.message);}finally{if(active)setBusy(false);}},350);
  return()=>{active=false;clearTimeout(timer);};
 },[key]);
 const current=quote?.key===key;
 useEffect(()=>{callbacks.current.onReviewChange?.({busy,error,needsReview:!current,reasons:current?quote.reviewReasons:[]});},[busy,error,current,quote]);
 if(!catalog)return null;
 if(campaignOnly)return <section className="wizard-section"><label>Travel charge ($)<input type="number" min="0" step="0.01" value={travel} placeholder="0.00" onChange={e=>onTravelChange(e.target.value)}/></label><p>Applicable sales tax on taxable products, including prints, is calculated before payment.</p></section>;
 function change(id,field,value){setChoices(current=>({...current,[id]:{...current[id],[field]:value}}));}
 return <section id="package-pricing-review" className="wizard-section"><h3>Pricing</h3><p>Totals update automatically. Saved package and add-on prices apply unless you change them.</p><div className="form-grid">
 {selected.map(pkg=>{const profile=catalog.packages.find(p=>p.id===pkg.package_id)?.pricing_profile;if(!profile)return null;return <div key={pkg.package_id}><strong>{pkg.name}</strong>{['glam','vogue'].includes(profile.experience)&&<><label>Total physical prints<select aria-label="Total physical prints" value={choices[pkg.package_id]?.prints??profile.prints} onChange={e=>change(pkg.package_id,'prints',Number(e.target.value))}>{[...new Set([profile.prints,100,200,250,500,1000])].filter(n=>n>=profile.prints).sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n}{n===profile.prints?' (included)':''}</option>)}</select></label><label><input type="checkbox" checked={choices[pkg.package_id]?.unlimitedPrints===true} onChange={e=>change(pkg.package_id,'unlimitedPrints',e.target.checked)}/>Unlimited prints</label>{(choices[pkg.package_id]?.unlimitedPrints||((choices[pkg.package_id]?.prints??profile.prints)>0&&catalog.printPrices?.[profile.experience]?.[choices[pkg.package_id]?.prints??profile.prints]==null))&&<label>Additional print price ($)<input type="number" min="0" step="0.01" value={choices[pkg.package_id]?.printCharge??''} onChange={e=>change(pkg.package_id,'printCharge',e.target.value)}/></label>}</>}{profile.extraHourCents&&<label>Additional service hours<input type="number" min="0" max="24" value={choices[pkg.package_id]?.extraHours??0} onChange={e=>change(pkg.package_id,'extraHours',Number(e.target.value))}/></label>}</div>;})}
 {addons.map(item=>{const row=catalog.addons.find(a=>a.id===item.addon_id);return <label key={item.addon_id}>Add-on price — {item.description||row?.name} ($)<input type="number" min="0" step="0.01" value={addonPrices[item.addon_id]??(row?.pricing_policy?.method==='CUSTOM'&&!Number(row?.price)&&!Number(item.unit_price)?'':item.unit_price??row?.price??'')} onChange={e=>setAddonPrices(current=>({...current,[item.addon_id]:e.target.value}))}/></label>;})}
 <label>Travel charge ($)<input type="number" min="0" step="0.01" value={travel} placeholder="0.00" onChange={e=>onTravelChange(e.target.value)}/></label></div>
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Updating total…</p>}{current&&!busy&&<p role="status">Service total: <strong>{money(quote.serviceTotalCents)}</strong></p>}
 <p>Applicable sales tax on taxable products, including prints, is calculated before payment and is not included in this estimate.</p></section>;
}
