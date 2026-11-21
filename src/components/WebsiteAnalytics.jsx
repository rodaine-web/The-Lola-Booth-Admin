import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {LineChart,Line,ResponsiveContainer,CartesianGrid,XAxis,YAxis,Tooltip} from 'recharts';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import {formatTimestamp,formatMoney,formatCount} from '../utils/display.js';
import {websiteAnalyticsInsights} from '../../shared/website-analytics-insights.js';
import '../styles/website-analytics.css';
const ranges=[['today','Today'],['week','This Week'],['mtd','Month to Date'],['ytd','Year to Date'],['custom','Custom']];
const percent=n=>n==null?'Unavailable':`${(Number(n)*100).toFixed(1)}%`;
const labels={sessionSource:'Source',sessionMedium:'Medium',sessionDefaultChannelGroup:'Channel',sessions:'Sessions',activeUsers:'Active users',keyEvents:'Google key events',sessionCampaignName:'Campaign',inquiryEvents:'Google inquiry events',crmInquiries:'CRM inquiries',crmBookings:'Related bookings',crmBookingValue:'Related booking value',crmConversionRate:'Inquiries / sessions¹',campaign:'Campaign',source:'Source',medium:'Medium',inquiries:'CRM inquiries',landingPage:'Landing page',pagePath:'Page',screenPageViews:'Pageviews',sessionManualAdContent:'UTM content',experience:'Experience',selections:'Selections'};
const experienceNames={glam:'The Lola Glam','360':'The Lola 360',mirror:'The Lola Magic Mirror',vogue:'The Lola Vogue',virtual:'The Lola Virtual Booth',audio:'Audio Guest Book'};
export default function WebsiteAnalytics(){
 const {can}=useAuth(),[range,setRange]=useState('mtd'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let alive=true,timer,polls=0;setData(null);setError('');
  if(range==='custom'&&(!from||!to)){setLoading(false);return()=>{alive=false;};}
  async function load(){
   try{const result=await api.get('/integrations/website-analytics?'+new URLSearchParams({range,...(range==='custom'?{from,to}:{})}));if(!alive)return;setData(result);setError('');if((result.state==='QUEUED'||result.stale)&&polls++<12)timer=setTimeout(load,5000);}
   catch(e){if(alive)setError(e.message);}finally{if(alive)setLoading(false);}
  }
  setLoading(true);load();return()=>{alive=false;clearTimeout(timer);};
 },[range,from,to,revision]);
 async function refresh(){setBusy(true);setError('');try{await api.post('/integrations/google-analytics/sync',{range,...(range==='custom'?{from,to}:{})});setRevision(n=>n+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const r=data?.report,insights=r?.insights||websiteAnalyticsInsights(r),connected=data&&data.state!=='NOT_CONNECTED';
 return <section className="website-analytics" aria-label="Website analytics"><header className="wa-heading"><div><h2>Website & marketing analytics</h2><p>Understand visitor activity, experience interest and recorded business outcomes.</p></div>{can('write:integrations')&&connected&&<button disabled={busy||loading||(range==='custom'&&(!from||!to))} onClick={refresh}>Refresh reports</button>}</header>
 <div className="wa-period" aria-label="Website report period">{ranges.map(([value,label])=><button key={value} aria-pressed={range===value} onClick={()=>setRange(value)}>{label}</button>)}{range==='custom'&&<><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></>}</div>
 {loading&&<p role="status">Loading website analytics…</p>}{error&&<p role="alert">{error} <button onClick={()=>setRevision(n=>n+1)}>Retry</button></p>}
 {data?.state==='NOT_CONNECTED'&&<div className="panel wa-connect"><h3>Connect your Google Analytics property</h3><p>The website tag collects activity. Authorize read-only access and select The Lola Booth property to display its reports here.</p><Link to="/system/integrations">Connect Google Analytics →</Link><p>Historical Google traffic can be loaded after connection. New inquiry and experience-selection events begin with the tracking update.</p></div>}
 {data?.state==='QUEUED'&&<p role="status">Google reports are being prepared. This view checks progress automatically. <button onClick={()=>setRevision(n=>n+1)}>Check now</button></p>}{data?.state==='FAILED'&&<p role="alert">{data.message} <Link to="/system/integrations">Check connection</Link></p>}
 {r&&<><p className="wa-source">{r.property} · {r.dates.startDate} through {r.dates.endDate} · {r.dates.timeZone} · Updated {formatTimestamp(data.refreshed_at)}{data.stale?' · Refresh queued':''}</p>
 <div className="wa-metrics">{[['Active users',r.summary.activeUsers],['Sessions',r.summary.sessions],['Engagement rate',percent(r.summary.engagementRate)],['Google inquiry events',r.summary.inquiryEvents],['CRM inquiries',r.crmSummary?.inquiries],['Related booking records',r.crmSummary?.bookings],['Related booking value',r.crmSummary?.bookingValue==null?null:formatMoney(r.crmSummary.bookingValue)]].map(([label,value])=><article key={label}><span>{label}</span><strong>{value==null?'Unavailable':typeof value==='number'?formatCount(value):value}</strong></article>)}</div>
 <section className="panel wa-insights"><h3>What this means</h3>{insights.map(item=><article key={item.title}><h4>{item.title}</h4><p>{item.body}</p></article>)}</section>
 <p className="wa-note">Google data can be delayed or revised, particularly for recent dates. Inquiry events count successful tracked submissions; they are not unique people or confirmed bookings. {r.cohortNote} {r.attributionNote}{r.truncated?' Google returned a limited set of rows; detailed rows may not add up to summary totals.':''}</p>
 <section className="panel"><h3>Traffic over time</h3><ResponsiveContainer width="100%" height={250}><LineChart data={r.traffic||[]}><CartesianGrid stroke="#eee8df"/><XAxis dataKey="date"/><YAxis/><Tooltip/><Line name="Sessions" dataKey="sessions" stroke="var(--chart-0, #947133)"/><Line name="Active users" dataKey="activeUsers" stroke="var(--chart-1, #536685)"/></LineChart></ResponsiveContainer></section>
 <ReportTable title="Experience interest" rows={(r.experienceInterest||[]).map(x=>({...x,experience:experienceNames[x.experience]||x.experience}))} columns={['experience','selections']}/>
 <ReportTable title="Traffic sources & channels" rows={r.sources} columns={['sessionDefaultChannelGroup','sessionSource','sessionMedium','sessions','activeUsers','keyEvents']}/>
 <ReportTable title="Campaign results: Google activity and CRM outcomes" rows={r.campaigns} columns={['sessionCampaignName','sessionSource','sessionMedium','sessions','inquiryEvents','crmInquiries','crmBookings','crmBookingValue','crmConversionRate']}/><p className="wa-note">¹ Aggregate inquiries divided by sessions is a comparison ratio, not person-level conversion attribution or advertising return on spend.</p>
 {(r.crmOnlyCampaigns||[]).length>0&&<ReportTable title="CRM campaigns without matching Google sessions" rows={r.crmOnlyCampaigns} columns={['campaign','source','medium','inquiries']}/>}
 <ReportTable title="Top landing pages" rows={r.landing} columns={['landingPage','sessions']}/><ReportTable title="Top pages" rows={r.pages} columns={['pagePath','screenPageViews']}/>{r.contentUnavailable?<p>UTM content reporting is unavailable for this property.</p>:<ReportTable title="UTM content" rows={r.contents} columns={['sessionManualAdContent','sessions']}/>}</>}
 </section>;
}
function ReportTable({title,rows=[],columns}){
 return <section className="panel"><h3>{title}</h3><div className="wa-table"><table><thead><tr>{columns.map(key=><th key={key}>{labels[key]||key}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((row,i)=><tr key={i}>{columns.map(key=><td key={key}>{row[key]==null?'Unavailable':key==='crmConversionRate'?percent(row[key]):key==='crmBookingValue'?formatMoney(row[key]):row[key]}</td>)}</tr>)}</tbody></table></div>{!rows.length&&<p>No data in this period.</p>}{rows.length>100&&<p>Showing the first 100 rows.</p>}</section>;
}
