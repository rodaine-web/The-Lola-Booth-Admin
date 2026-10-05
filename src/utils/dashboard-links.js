export function funnelHref(key, range) {
  const params=new URLSearchParams({from:range.start,to:range.end,data_scope:"business"});
  if(key==='proposals_sent'||key==='proposals_accepted'){params.set('funnel',key==='proposals_sent'?'sent':'accepted');return '/sales/proposals?'+params;}
  params.set('funnel',key);return '/sales/leads?'+params;
}
export function sourceHref(source,range){return '/sales/leads?'+new URLSearchParams({source_group:source,from:range.start,to:range.end,data_scope:"business"});}

export function metricHref(metric, range) {
  if (metric.key === 'new_leads') return funnelHref('leads', range);
  if (metric.key === 'qualified_leads') return funnelHref('qualified', range);
  if (['proposals_sent','proposals_accepted'].includes(metric.key)) return '/sales/proposals?' + new URLSearchParams({activity:metric.key === 'proposals_sent' ? 'sent' : 'accepted',from:range.start,to:range.end});
  if (metric.key === 'bookings_won') return funnelHref('booked', range);
  if (metric.key === 'booked_revenue') return '/events/events?' + new URLSearchParams({booking_from:range.start,booking_to:range.end});
  if (metric.key === 'collected_revenue') return '/finance/payments?' + new URLSearchParams({from:range.start,to:range.end});
  if (metric.key === 'refunds') return '/finance/payments?' + new URLSearchParams({refunded:'true',from:range.start,to:range.end});
  if (metric.key === 'tasks_due') return '/operations/tasks?' + new URLSearchParams({due_from:range.start,due_to:range.end});
  if (metric.key === 'upcoming_events') return '/events/events?' + new URLSearchParams({upcoming:'true',to:range.end});
  return metric.href;
}
