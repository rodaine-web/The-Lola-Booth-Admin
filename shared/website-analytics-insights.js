const count=value=>Number.isFinite(Number(value))?Number(value):0;
export function analyticsPagePath(value){
 const path=String(value||'').split(/[?#]/)[0];
 let decoded=path;try{decoded=decodeURIComponent(path);}catch{}
 const privateRoute=decoded.match(/^\/(invoice|invoices|pay|payment|payments|proposal|proposals|client|sales|finance|system)(?:\/|\.|$)/i);
 return privateRoute?`/${privateRoute[1].toLowerCase()}/[private]`:path;
}
export function analyticsPageRows(rows=[],dimension='landingPage',metric='sessions'){
 const paths=new Map();
 for(const row of rows){const path=analyticsPagePath(row[dimension]);paths.set(path,(paths.get(path)||0)+count(row[metric]));}
 return [...paths].map(([path,total])=>({[dimension]:path,[metric]:total})).sort((a,b)=>b[metric]-a[metric]);
}
export function previousAnalyticsDates(dates){
 const day=86400000,start=Date.parse(dates.startDate+'T00:00:00Z'),end=Date.parse(dates.endDate+'T00:00:00Z');
 const iso=n=>new Date(n).toISOString().slice(0,10);
 return {...dates,startDate:iso(start-(end-start+day)),endDate:iso(start-day)};
}
export function websiteAnalyticsInsights(report){
 if(!report)return [];
 const insights=[],summary=report.summary||{},sessions=count(summary.sessions),inquiries=count(summary.inquiryEvents),crm=count(report.crmSummary?.inquiries);
 if(!sessions)insights.push({title:'No sessions reported',body:'Google returned no sessions for this date range. Check the selected property and period before drawing conclusions.'});
 else if(report.previous?.summary?.sessions>0){
  const change=(sessions/report.previous.summary.sessions-1)*100;
  insights.push({title:'Traffic compared with the previous period',body:`Sessions are ${Math.abs(change).toFixed(1)}% ${change<0?'lower':'higher'} than the preceding equal-length period. Recent Google data can still change; this does not establish why traffic changed.`});
 }
 if(sessions&&!inquiries)insights.push({title:'Check inquiry measurement',body:`No ${report.inquiryEvent||'generate_lead'} events were reported${crm?`, while the CRM recorded ${crm} inquiries`:''}. Verify successful-form tracking before concluding that visitors did not inquire.`});
 const top=[...(report.sources||[])].sort((a,b)=>count(b.sessions)-count(a.sessions))[0];
 if(top&&sessions)insights.push({title:'Leading traffic source',body:`${top.sessionDefaultChannelGroup||top.sessionSource||'Unclassified'} supplied ${count(top.sessions).toLocaleString('en-US')} sessions. Review its inquiry results alongside traffic volume; sessions alone do not demonstrate sales performance.`});
 const unmatched=(report.crmOnlyCampaigns||[]).reduce((sum,r)=>sum+count(r.inquiries),0);
 if(unmatched)insights.push({title:'Campaign attribution needs review',body:`${unmatched} CRM inquiries have campaign/source details without matching Google campaign rows. Check consistent UTM tagging. Google and CRM counts measure different things.`});
 if(!(report.experienceInterest||[]).length)insights.push({title:'Experience interest is not yet available',body:'Experience-selection events start with the new tracking update. Earlier pageviews cannot be retroactively divided into selected experiences.'});
 return insights;
}
