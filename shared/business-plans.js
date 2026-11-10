import {primaryExperienceKeys} from './experience-catalog.js';
export const businessPlanTiers=['EVENT','EVENT_PLUS','EVENT_PREMIUM','ACTIVATION','CAMPAIGN'];
export const businessPlanNames={EVENT:'Event',EVENT_PLUS:'Event Plus',EVENT_PREMIUM:'Event Premium',ACTIVATION:'Activation',CAMPAIGN:'Campaign'};
export const businessRates={glam:[999,1299,2299,3499,4999],'360':[1099,1399,2499,3799,5999],mirror:[1199,1599,2699,3999,6999],vogue:[1299,1899,2999,4499,7999]};
export const businessCoverage=[2,4,4,6,8];
export const businessPrints=[100,200,300,500,750];
export const businessDiscounts={'1:1':10,'1:2':15,'2:1':15,'2:2':20};
export const businessIncludedCount=tier=>['EVENT','EVENT_PLUS'].includes(tier)?1:2;
export function businessFeatures(tier,key){
 const index=businessPlanTiers.indexOf(tier),video=key==='360';
 const common=['{hours} hours of guest-facing operation','Professional delivery, setup and breakdown within the defined service area','Dedicated trained attendant for this experience','Unlimited '+(video?'video':'photo')+' capture sessions during contracted operating hours','Digital sharing and content delivery where supported','Online gallery or equivalent content delivery where supported',...(video?['Digital video delivery; no physical printing']:['On-site printing: {prints} physical prints allocated to this experience; printing equipment must be supported and assigned','Unused prints do not automatically transfer between experiences'])];
 const specific=[
 ['Standard custom photo/video overlay','Standard event welcome screen','Standard lighting and applicable booth backdrop','Basic pre-event coordination'],
 ['Enhanced branded photo/video overlay','Custom welcome screen','Standard backdrop or appropriate experience styling','Enhanced lighting setup','Basic branded sharing presentation where supported','Pre-event design consultation','One standard creative revision'],
 ['Custom branded overlay and welcome screen','Enhanced digital sharing','Premium experience styling','Customized creative designs','Branded sharing presentation where supported','Pre-event planning consultation','Two standard creative revisions','Coordinated setup and event execution'],
 ['Fully branded photo/video overlay','Custom welcome screen','Enhanced branded sharing presentation','Custom branded digital content','Experience-specific branded styling','Consent-based lead capture option, subject to supported integration and agreed scope','Brand activation planning consultation','Up to three standard creative revisions','Post-event usage and engagement summary using available platform data','Coordinated production planning and onsite execution','Physical fabrication, special enclosures, premium backdrop production, CRM integrations, postcard mailing, advanced analytics and third-party technology are quoted separately'],
 ['Premium branded photo/video overlay','Custom welcome screen','Campaign-specific creative direction','Branded digital sharing presentation','Consent-based lead capture planning where applicable','Dedicated production coordination','Up to four standard creative revisions','Post-event engagement and usage report using available data','Campaign planning consultation','Base-day coverage is subject to agreed scope; additional dates, locations, units and production are quoted separately','For multi-day campaigns, print allowances must be explicitly defined per day or for the whole campaign']
 ];
 return [...common,...specific[index]];
}
export function businessPackageDefinitions(){return primaryExperienceKeys.flatMap(key=>businessPlanTiers.map((tier,index)=>({key,tier,name:businessPlanNames[tier],price:businessRates[key][index],hours:businessCoverage[index],prints:key==='360'?0:businessPrints[index],included:businessIncludedCount(tier),catalog:['ACTIVATION','CAMPAIGN'].includes(tier)?'ACTIVATION':'PROFESSIONAL',features:businessFeatures(tier,key)})));}
