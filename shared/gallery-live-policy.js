export function liveLobReady(config={}, {statusChannel='WEBHOOK'}={}) {
 return config.APP_ENV==='production' && config.GALLERY_MAILING_LIVE_ENABLED==='true'
  && /^live_(?!pub)[A-Za-z0-9_]+$/.test(config.LOB_LIVE_API_KEY||'')
  && (statusChannel==='POLLING'||Boolean(config.LOB_LIVE_WEBHOOK_SECRET&&config.LOB_LIVE_WEBHOOK_SECRET.length>=16));
}
export function liveBatchBudget({quantity,cost_limit_cents,unit_cost_cents}) {
 return Number.isSafeInteger(quantity)&&quantity>0&&quantity<=500
  &&Number.isSafeInteger(cost_limit_cents)&&cost_limit_cents>0&&cost_limit_cents<=10000000
  &&Number.isSafeInteger(unit_cost_cents)&&unit_cost_cents>0&&unit_cost_cents<=100000
  &&quantity*unit_cost_cents<=cost_limit_cents;
}
