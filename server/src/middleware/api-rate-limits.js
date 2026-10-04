import rateLimit from 'express-rate-limit';

// Independent stores: navigation and health polling cannot consume the login or
// booking/send quota. Authentication and authorization still run in the routers.
export function requestQuota(req) {
  if (['GET','HEAD'].includes(req.method)) {
    if (req.path === '/api/health') return 'health';
    if (/^\/api\/public\/(?:staging\/)?media\/[^/]+$/.test(req.path) || /^\/api\/(?:gallery|gallery-admin)\/media\/[^/]+$/.test(req.path)) return 'media';
    return 'read';
  }
  if (req.path.startsWith('/api/auth/')) return 'auth';
  return 'write';
}
export function createApiRateLimits({windowMs=900000,limit=120}={}) {
  const quotas={health:{windowMs:60000,limit:60},media:{windowMs:60000,limit:600},read:{windowMs:60000,limit:300},auth:{windowMs,limit:Math.min(limit,20)},write:{windowMs,limit}};
  const handlers=Object.fromEntries(Object.entries(quotas).map(([name,options])=>[name,rateLimit({...options,standardHeaders:true,legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Too many requests. Please wait before retrying.'}}})]));
  return (req,res,next)=>handlers[requestQuota(req)](req,res,next);
}
