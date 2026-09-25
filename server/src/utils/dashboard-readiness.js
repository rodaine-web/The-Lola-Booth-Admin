// Dashboard permission does not grant access to every event's operations.
export async function dashboardReadiness(events,user,{canAccess,readOperations}) {
  const rows=await Promise.all(events.map(async event=>{
    if(!user || !await canAccess(user,event.id))return null;
    return {...event,operational_readiness:(await readOperations(event.id,user)).readiness};
  }));
  return rows.filter(Boolean);
}
