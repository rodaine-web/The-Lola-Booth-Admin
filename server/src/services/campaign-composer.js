import sanitizeHtml from 'sanitize-html';
import {campaignOfferPrice} from '../../../shared/campaign-content.js';
import {AppError} from '../utils/errors.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function renderOfferCards(offers,interestUrl,{test=false,origin}={}){
 return offers.map(o=>{
  const p=campaignOfferPrice(o);
  let image='';if(o.image_url){const url=new URL(o.image_url,origin);if(url.protocol!=='https:'||url.username||url.password||/^(localhost|127\.|\[::1\])/.test(url.hostname))throw new AppError('Offer images must use public HTTPS.',422,'INVALID_CAMPAIGN_ASSET');image=`<img src="${escape(url.href)}" alt="${escape(o.name)}" width="160" style="width:160px;max-width:100%;height:auto;margin-bottom:12px">`;}
  return `<table role="presentation" width="100%" cellpadding="18" cellspacing="0" style="margin:16px 0;border:1px solid #e4ddd2;border-radius:8px;background:#fff"><tr><td>${image}<h2 style="font:24px Georgia;color:#171717;margin:0 0 10px">${escape(o.name)}</h2><p style="font:15px Arial;color:#444">${escape(o.description).replaceAll('\n','<br>')}</p>${o.kind==='EXPERIENCE'&&o.hours?`<p style="font:14px Arial">${escape(o.hours)} hours of service</p>`:''}<p style="font:22px Arial;color:#8c652a">${p.saving?`<s style="color:#777;font-size:17px;text-decoration:line-through">${money(p.original)}</s> &nbsp;`:''}<strong>${money(p.discounted)}</strong></p>${p.saving?`<p style="font:14px Arial;color:#486244">Save ${money(p.saving)}</p>`:''}${o.kind==='EXPERIENCE'?`<a href="${escape(interestUrl+'?package='+encodeURIComponent(o.key))}" style="display:inline-block;padding:12px 20px;background:#8c652a;color:white;text-decoration:none;font:15px Arial">I'm interested →</a>`:''}</td></tr></table>`;
 }).join('');
}
export function renderComposedCampaign(campaign,c,recipient,{origin,token,test}){
 const interestUrl=origin+'/interest/'+token,unsubscribeUrl=origin+'/unsubscribe/'+token;
 const offers=renderOfferCards(c.offers,interestUrl,{test,origin});
 const vars={
  'contact.first_name':recipient.first_name||'there','contact.last_name':recipient.last_name||'',
  'contact.full_name':[recipient.first_name,recipient.last_name].filter(Boolean).join(' ')||'there',
  'contact.email':recipient.email||'', 'company.name':recipient.company||'your team',
  interest_url:interestUrl, unsubscribe_url:unsubscribeUrl,
 };
 const merge=(body,html=false)=>body.replace(/\{\{([\w.]+)\}\}/g,(match,key)=>{
  if(key==='offers'&&html)return offers;
  if(!(key in vars))throw new AppError('Unsupported campaign merge field: '+key,422,'INVALID_MERGE_FIELD');return html?escape(vars[key]):vars[key];
 });
 const footer=`<div style="font:12px Arial;color:#666;padding:24px;text-align:center">${escape(c.footer)}<br>${escape(c.mailing_address)}<br><a href="${escape(unsubscribeUrl)}">Unsubscribe from marketing</a></div>`;
 const banner=test?'<p style="background:#171717;color:white;padding:12px;font:12px Arial;text-align:center">TEST EMAIL — sample recipient data</p>':'';
 let html;
 if(c.format==='HTML'){
  if(!c.html_body.trim())throw new AppError('Paste or upload your HTML campaign.',422,'EMPTY_CAMPAIGN_CONTENT');
  html=sanitizeHtml(merge(c.html_body,true),{
   allowedTags:['html','head','body','title','meta','style',...sanitizeHtml.defaults.allowedTags,'img','table','thead','tbody','tfoot','tr','th','td','s','strike','center','font'],
   allowedAttributes:{'*':['style','class','id','align','valign','width','height','bgcolor','role'],a:['href','title','target'],img:['src','alt','width','height'],table:['cellpadding','cellspacing','border'],td:['colspan','rowspan'],meta:['name','content']},
   allowedSchemes:['https','http','mailto','tel'],allowProtocolRelative:false,
   allowedSchemesByTag:{img:['https']},
   allowVulnerableTags:true,
   transformTags:{img:(_tag,attrs)=>{
    if(attrs.src){let url;try{url=new URL(attrs.src);}catch{throw new AppError('HTML images need absolute public HTTPS URLs.',422,'INVALID_CAMPAIGN_ASSET');}
     if(url.protocol!=='https:'||url.username||url.password||/^(localhost|127\.|\[::1\])/.test(url.hostname))throw new AppError('HTML images need public HTTPS URLs.',422,'INVALID_CAMPAIGN_ASSET');}
    return {tagName:'img',attribs:attrs};
   }},
  });
  const button=c.html_body.includes('{{interest_url}}')?'':`<p style="padding:16px;text-align:center"><a href="${escape(interestUrl)}" style="display:inline-block;background:#8c652a;color:white;padding:14px 24px;text-decoration:none;font:16px Arial">${escape(c.cta)}</a></p>`;
  const addition=(c.html_body.includes('{{offers}}')?'':offers)+button+banner+footer;
  html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,addition+'</body>'):html+addition;
 }else{
  if(!c.text_body.trim())throw new AppError('Write your campaign message.',422,'EMPTY_CAMPAIGN_CONTENT');
  html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f7f3ec">${banner}<table role="presentation" width="100%" cellpadding="24"><tr><td><div style="max-width:640px;margin:auto;color:#171717"><h1 style="font:32px Georgia">${escape(c.headline)}</h1><div style="font:16px Arial;line-height:1.7;white-space:pre-wrap">${escape(merge(c.text_body)).replaceAll('\n','<br>')}</div>${offers}<p><a href="${escape(interestUrl)}" style="display:inline-block;background:#8c652a;color:white;padding:14px 24px;font:16px Arial;text-decoration:none">${escape(c.cta)}</a></p>${footer}</div></td></tr></table></body></html>`;
 }
 const contentText=c.format==='HTML'?sanitizeHtml(merge(c.html_body.replaceAll('{{offers}}','')),{allowedTags:[],allowedAttributes:{}}):merge(c.text_body);
 const offersText=c.offers.map(o=>{const p=campaignOfferPrice(o);return o.name+': '+(p.saving?money(p.original)+' → ':'')+money(p.discounted);}).join('\n');
 return {html,text:[c.headline,contentText,offersText,interestUrl,c.footer,c.mailing_address,'Unsubscribe: '+unsubscribeUrl].filter(Boolean).join('\n\n')};
}
