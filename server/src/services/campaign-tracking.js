import {randomBytes,createHash} from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
export const trackingHash=token=>createHash('sha256').update(token).digest('hex');
export const transparentPixel=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
export function trackingOrigin(value=process.env.CAMPAIGN_TRACKING_ORIGIN) {
 let url;try{url=new URL(value);}catch{throw new AppError('Configure the public campaign tracking API origin before sending.',422,'CAMPAIGN_TRACKING_ORIGIN_REQUIRED');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||/^(localhost|127\.|\[::1\])/.test(url.hostname))throw new AppError('Campaign tracking requires a public HTTPS API origin.',422,'INVALID_TRACKING_ORIGIN');
 return url.origin;
}
export function trackableDestination(value) {
 try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!/^\/(?:customer-documents\/)?unsubscribe\//.test(u.pathname)&&value.length<=8000?u.href:null;}catch{return null;}
}
// Only serialized, already-sanitized email HTML enters here. The parser retains
// the email's tags/styles and decodes href entities before storing destinations.
export function composeTracking(rendered,{origin,tokenFactory=()=>randomBytes(32).toString('base64url')}={}) {
 const base=trackingOrigin(origin),links=[],replacements=new Map();
 let html=sanitizeHtml(rendered.html,{allowedTags:false,allowedAttributes:false,allowVulnerableTags:true,transformTags:{a:(tagName,attribs)=>{
  const destination=trackableDestination(attribs.href||'');
  if(destination){let link=replacements.get(attribs.href);if(!link){const token=tokenFactory();link=base+'/api/public/campaigns/track/click/'+token;links.push({token_hash:trackingHash(token),kind:'CLICK',destination});replacements.set(attribs.href,link);}attribs={...attribs,href:link};}
  return {tagName,attribs};
 }}});
 const token=tokenFactory();links.push({token_hash:trackingHash(token),kind:'OPEN',destination:null});
 const pixel='<img src="'+base+'/api/public/campaigns/track/open/'+token+'" width="1" height="1" alt="" style="width:1px;height:1px;border:0;display:block" />';
 html=html.includes('</body>')?html.replace('</body>',pixel+'</body>'):html+pixel;
 let text=rendered.text;for(const [destination,link] of replacements)text=text.split(destination).join(link);
 return {...rendered,html,text,links};
}
export async function prepareCampaignTracking(rendered,recipientId) {
 const result=composeTracking(rendered);
 for(const link of result.links)await query('INSERT INTO campaign_tracking_links(token_hash,recipient_id,kind,destination) VALUES($1,$2,$3,$4)',[link.token_hash,recipientId,link.kind,link.destination]);
 await query('UPDATE campaign_recipients SET tracking_enabled=true WHERE id=$1',[recipientId]);
 return result;
}
export function automatedTrackingRequest({method='GET',userAgent='',purpose=''}={}) {
 return method!=='GET'||/bot|crawler|spider|scanner|safelinks|proofpoint|mimecast|barracuda|headless|preview|curl|wget/i.test(userAgent)||/prefetch|preview/i.test(purpose);
}
export async function recordCampaignTracking(token,kind,request={}) {
 if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!['OPEN','CLICK'].includes(kind))throw new AppError('This campaign link is unavailable.',404,'NOT_FOUND');
 return transaction(async()=>{
  const link=(await query(`SELECT t.*,r.campaign_id,r.sent_at,r.unsubscribed_at,c.status,c.deleted_at FROM campaign_tracking_links t JOIN campaign_recipients r ON r.id=t.recipient_id JOIN campaigns c ON c.id=r.campaign_id WHERE t.token_hash=$1 AND t.kind=$2 AND t.expires_at>now()`,[trackingHash(token),kind])).rows[0];
  if(!link||link.deleted_at)throw new AppError('This campaign link is unavailable.',404,'NOT_FOUND');
  if(kind==='CLICK'&&!trackableDestination(link.destination))throw new AppError('This campaign link is unavailable.',404,'NOT_FOUND');
  if(link.sent_at&&!link.unsubscribed_at&&link.status!=='CANCELLED'&&!automatedTrackingRequest(request)){
   const field=kind==='OPEN'?'opened_at':'clicked_at';
   const updated=await query(`UPDATE campaign_recipients SET ${field}=now() WHERE id=$1 AND ${field} IS NULL RETURNING id`,[link.recipient_id]);
   if(updated.rowCount)await query('INSERT INTO campaign_events(campaign_id,recipient_id,event_type,event_key,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING',[link.campaign_id,link.recipient_id,kind==='OPEN'?'estimated_open':'tracked_click','tracking:'+link.recipient_id+':'+kind,{source:'campaign_tracking',estimated:kind==='OPEN'}]);
  }
  return link.destination;
 });
}
