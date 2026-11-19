// Provider evidence and preparation readiness are independent; never infer mail
// delivery from rendering, API acceptance, or a scheduled release date.
export function postcardResult(row){
 if(row.live_status==='SUBMITTED'){
  const provider=String(row.live_provider_status||'').toLowerCase();
  if(/returned|rejected|failed|canceled|cancelled/.test(provider))return {status:'FAILED',reason:'Provider reported '+provider.replaceAll('_',' ')};
  if(row.delivered_at||provider==='delivered')return {status:'DELIVERED',reason:'Provider confirmed delivery.'};
  if(provider==='in_transit'||provider==='in_local_area'||provider==='processed_for_delivery')return {status:'IN_TRANSIT',reason:'Provider reported '+provider.replaceAll('_',' ')};
  if(row.mailed_at||provider==='mailed')return {status:'MAILED',reason:'Provider confirmed mailing.'};
  return {status:'SUBMITTED',reason:'Accepted for printing and mailing; postal delivery is not yet confirmed.'};
 }
 if(row.live_status==='NEEDS_REVIEW')return {status:'NEEDS_REVIEW',reason:'Production submission outcome requires provider reconciliation. Do not retry.'};
 if(row.live_status&&row.live_status!=='CANCELLED')return {status:'PENDING',reason:'Production release '+row.live_status.toLowerCase()+'.'};
 if(row.exclusion_reason)return {status:'EXCLUDED',reason:row.exclusion_reason};
 if(row.survey_status==='NO_CONSENT'||row.consent===false)return {status:'EXCLUDED',reason:'Physical mailing permission is missing or declined.'};
 if(row.issues?.length)return {status:'HELD',reason:row.issues.map(x=>x.replaceAll('_',' ').toLowerCase()).join('; ')};
 if(!['MATCHED','PREPARED'].includes(row.match_status))return {status:'HELD',reason:row.match_status==='AMBIGUOUS'?'Photo match is ambiguous.':'Photo ownership has not been confirmed.'};
 if(!row.media_id)return {status:'HELD',reason:'No confirmed photo match.'};
 if(!row.recipient?.name||!row.recipient?.address_line1||!row.recipient?.address_city||!/^[A-Z]{2}$/.test(row.recipient?.address_state||'')||!/^\d{5}(-\d{4})?$/.test(row.recipient?.address_zip||'')||row.recipient?.address_country!=='US')return {status:'HELD',reason:'A complete US mailing address is required.'};
 if(row.card_status==='FAILED')return {status:'HELD',reason:row.test_error||'Test submission needs reconciliation.'};
 return {status:'READY',reason:row.card_status==='SUBMITTED_TEST'?'Test submitted; review provider proof before live release.':'Ready for postcard preparation and review.'};
}
export function fulfillmentSummary(rows,images){
 const count=status=>rows.filter(r=>r.result.status===status).length;
 return {images,combinations:rows.length,processedImages:new Set(rows.filter(r=>r.postcard_id).map(r=>r.media_id).filter(Boolean)).size,
 matched:new Set(rows.filter(r=>r.media_id).map(r=>r.media_id)).size,ready:count('READY'),
 successful:rows.filter(r=>['SUBMITTED','MAILED','IN_TRANSIT','DELIVERED'].includes(r.result.status)).length,
 failed:count('FAILED'),held:count('HELD')+count('NEEDS_REVIEW'),excluded:count('EXCLUDED'),pending:count('PENDING'),
 mailed:rows.filter(r=>r.mailed_at).length,delivered:count('DELIVERED')};
}
