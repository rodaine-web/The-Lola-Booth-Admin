export const refundedOrderHold=o=>!!o&&(o.refunded_cents>=o.total_cents&&o.refunded_cents>0||o.refunded_cents>0&&!o.item_refunds_managed);
export const remainingItemUnits=item=>Math.max(0,(item.units||0)-(item.cancelledUnits||0));
