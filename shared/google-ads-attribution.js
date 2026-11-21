// An ad interaction is attribution evidence, not a verified person's identity.
export function hasGoogleAdsAttribution(record={}){
 if(record.lead_source==='GOOGLE_ADS')return true;
 return [record,record.first_touch||{}].some(touch=>
  ['gclid','gbraid','wbraid'].some(key=>typeof touch[key]==='string'&&touch[key].trim())||
  String(touch.utm_source||'').toLowerCase()==='google'&&['cpc','ppc','paidsearch','paid_search'].includes(String(touch.utm_medium||'').toLowerCase()));
}
