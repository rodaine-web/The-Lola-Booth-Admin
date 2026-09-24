export function funnelHref(key, range) {
  const params=new URLSearchParams({from:range.start,to:range.end});
  if(key==='proposals_sent'||key==='proposals_accepted'){params.set('funnel',key==='proposals_sent'?'sent':'accepted');return '/sales/proposals?'+params;}
  params.set('funnel',key);return '/sales/leads?'+params;
}
export function sourceHref(source,range){return '/sales/leads?'+new URLSearchParams({source_group:source,from:range.start,to:range.end});}

export function metricHref(metric, range) {
  if (metric.key === 'new_leads') return funnelHref('leads', range);
  if (metric.key === 'qualified_leads') return funnelHref('qualified', range);
  if (['proposals_sent','proposals_accepted'].includes(metric.key)) return '/sales/proposals?' + new URLSearchParams({activity:metric.key === 'proposals_sent' ? 'sent' : 'accepted',from:range.start,to:range.end});
  return metric.href;
}
