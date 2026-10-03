import { useAuth } from "../context/AuthContext.jsx";
import { GALLERY_ENABLED } from "../utils/features.js";
import AsyncState from "../components/AsyncState.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatMoney, formatDateOnly, businessToday, formatPercent, formatCount } from "../utils/display.js";
import {
  ArrowRight, CalendarDays, CircleDollarSign, FileText, Plus, UsersRound,
  AlertCircle, Sparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { api } from "../api/client.js";
import { sourceHref, metricHref } from "../utils/dashboard-links.js";

const sourceColors=["#e5c7a8","#171717","#f9b8d5","#fb8fa6","#b5b7bd","#dfe1e7"];
const experiences=[
  ["Glam Photo Booth","Polished portraits. Timeless.","glam.jpg"],
  ["360 Video Booth","Step in. Stand out.","360.jpg"],
  ["Vogue Booth","A magazine moment.","vogue.jpg"],
  ["Audio Guestbook","Voices that last forever.","audio.jpg"]
];
const ranges = [["today","Today"],["week","This Week"],["mtd","Month To Date"],["ytd","Year To Date"]];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const [searchParams,setSearchParams]=useSearchParams();
  const range=searchParams.get("range")||"mtd";
  const [data,setData]=useState(null);
  const [recentLeads,setRecentLeads]=useState([]);
  const [recentProposals,setRecentProposals]=useState([]);
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);

  useEffect(()=>{
    let active=true;
    setError("");
    Promise.all([
      api.get(`/dashboard?range=${range}`),
      api.get("/leads?pageSize=5&sort_by=created_at"),
      api.get("/proposals?pageSize=5&sort_by=created_at")
    ]).then(([dashboard,leads,proposals])=>{
      if(!active)return;
      setData(dashboard);
      setRecentLeads(leads.data||[]);
      setRecentProposals(proposals.data||[]);
    }).catch(err=>active&&setError(err.message));
    return()=>{active=false;};
  },[range,revision]);

  const metricMap=useMemo(()=>Object.fromEntries(
    (data?.groups||[]).flatMap(group=>group.metrics||[]).map(metric=>[metric.key,metric])
  ),[data]);

  const salesTrend=useMemo(()=>(data?.trends||[]).map(row=>({
    ...row,
    label:trendLabel(row.bucket)
  })),[data]);

  if(error)return <main className="page"><AsyncState error={error} onRetry={()=>setRevision(v=>v+1)} noun="dashboard"/></main>;
  if(!data)return <main className="page"><AsyncState loading noun="dashboard"/></main>;

  const cards=[
    ["upcoming_events","Upcoming Events",CalendarDays],
    ["new_leads","New Leads",UsersRound],
    ["proposals_sent","Proposals Sent",FileText],
    ["collected_revenue","Revenue",CircleDollarSign]
  ];

  const sourceTotal=(data.leadSources||[]).reduce((total,row)=>total+Number(row.leads||0),0);

  return (
    <main className="page lola-dashboard">
      <section className="dashboard-intro-grid">
        <div className="dashboard-intro-left">
          <div className="dashboard-hero-row">
            <div><h1>Good morning, {firstName(user?.name || data?.viewerName)||"there"}!</h1><p className="lede">Here’s what’s happening with The Lola Booth today.</p></div>
            <span className="lola-script morning-script" aria-hidden="true">Make it a<br/>Great Day.</span>
          </div>
          <div className="dashboard-kpi-row">
            {cards.map(([key,label,Icon])=>{
              const metric=metricMap[key]||{};
              return <Link key={key} className="dashboard-kpi-card" to={metricHref(metric,data.sqlRange)}>
                <span className="dashboard-kpi-icon"><Icon size={22}/></span>
                <div><strong>{metric.format==="money"?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(metric.value||0):formatCount(metric.value||0)}</strong><span>{label}{key==="collected_revenue"?` (${range.toUpperCase()})`:""}</span><small className={metric.comparison?.direction==="down"?"comparison-down":""}>{metric.comparison?.label||"Current period"}</small><small className="comparison-period">{metric.comparison ? "vs previous period" : data.label}</small></div>
              </Link>;
            })}
          </div>
        </div>
        <aside className="dashboard-brand-card">
          <div><h2>Good people.<br/>Better photos.</h2>{GALLERY_ENABLED && can("read:events") && <Link to="/operations/galleries">View Gallery <ArrowRight size={17}/></Link>}</div>
        </aside>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel dashboard-chart-card">
          <div className="dashboard-card-heading">
            <div><h2>Sales Overview</h2><p>Booked and collected revenue over time.</p></div>
            <label className="dashboard-period"><span className="sr-only">Dashboard period</span><select aria-label="Dashboard period" value={range} onChange={event=>setSearchParams({range:event.target.value})}>{ranges.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          </div>
          <ResponsiveContainer width="100%" height={186}>
            <BarChart data={salesTrend} barGap={5} margin={{top:12,right:4,left:-18,bottom:0}}>
              <CartesianGrid stroke="#eef0f4" vertical={false}/>
              <XAxis dataKey="label" tick={{fontSize:11,fill:"#697089"}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10,fill:"#697089"}} axisLine={false} tickLine={false} tickFormatter={v=>v>=1000?`$${v/1000}K`:formatMoney(v)}/>
              <Tooltip formatter={v=>formatMoney(v)} cursor={{fill:"#f6f7fa"}}/>
              <Bar isAnimationActive={false} dataKey="booked_revenue" name="Booked revenue" fill="#ceb496" radius={[2,2,0,0]} maxBarSize={15}/>
              <Bar isAnimationActive={false} dataKey="collected_revenue" name="Collected revenue" fill="#171717" radius={[2,2,0,0]} maxBarSize={15}/>
            </BarChart>
          </ResponsiveContainer>
          <div className="chart-key"><span><i style={{background:"#ceb496"}}/>Booked revenue</span><span><i style={{background:"#171717"}}/>Collected revenue</span></div>
        </article>

        <article className="panel dashboard-source-card">
          <div className="dashboard-card-heading"><div><h2>Leads by Source</h2><p>Where your leads are coming from.</p></div></div>
          <div className="dashboard-source-layout">
            <div className="dashboard-donut">
              <ResponsiveContainer width="100%" height={186}>
                <PieChart><Pie isAnimationActive={false} data={data.leadSources||[]} dataKey="leads" nameKey="source" innerRadius="63%" outerRadius="94%" stroke="none">{(data.leadSources||[]).map((row,i)=><Cell key={row.source} fill={sourceColors[i%sourceColors.length]}/>)}</Pie><Tooltip/></PieChart>
              </ResponsiveContainer>
              <div className="donut-total"><strong>{formatCount(sourceTotal)}</strong><span>Total Leads</span></div>
            </div>
            <div className="dashboard-source-list">{(data.leadSources||[]).slice(0,6).map((source,i)=><Link key={source.source} to={sourceHref(source.source,data.sqlRange)}><i style={{background:sourceColors[i%sourceColors.length]}}/><span>{source.source}</span><strong>{sourceTotal?Math.round(Number(source.leads)/sourceTotal*100):0}%</strong></Link>)}</div>
          </div>
        </article>

        <article className="panel dashboard-today-card">
          <div className="dashboard-card-heading"><div><h2>Today</h2><p>{formatDateOnly(businessToday())}</p></div><Link to="/events/calendar">View Calendar <ArrowRight size={14}/></Link></div>
          <div className="today-list">
            {(data.todaysEvents||[]).slice(0,5).map(event=><Link key={event.id} to={`/events/events/${event.id}`}><time>{event.start_time||"TBD"}</time><div><strong>{event.event_name}</strong><span>{event.client_name||"Client pending"} · {event.venue_name||"Venue TBD"}</span></div><StatusBadge status={event.operational_status||event.status}/></Link>)}
            {!data.todaysEvents?.length&&<div className="mini-empty">No events scheduled today.</div>}
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel">
          <div className="dashboard-card-heading"><h2>Recent Leads</h2><Link to="/sales/leads">View All <ArrowRight size={14}/></Link></div>
          <div className="dashboard-list">
            {recentLeads.map(lead=><Link key={lead.id} to={`/sales/leads/${lead.id}`}><span className="initial-badge">{initials(`${lead.first_name||""} ${lead.last_name||""}`)}</span><div><strong>{lead.first_name} {lead.last_name}</strong><small>{lead.email}</small></div><span>{lead.event_type||"Event TBD"}</span><small>{lead.created_at?relativeTime(lead.created_at):""}</small></Link>)}
          </div>
        </article>

        <article className="panel">
          <div className="dashboard-card-heading"><h2>Recent Proposals</h2><Link to="/sales/proposals">View All <ArrowRight size={14}/></Link></div>
          <div className="dashboard-list">
            {recentProposals.map(proposal=><Link key={proposal.id} to={`/sales/proposals/${proposal.id}`}><div><strong>{proposal.proposal_number}</strong><small>{proposal.client_name||"Client"}</small></div><span>{formatMoney(proposal.total||0)}</span><StatusBadge status={proposal.status}/><small>{proposal.created_at?formatDateOnly(proposal.created_at):""}</small></Link>)}
          </div>
        </article>

        <article className="panel">
          <div className="dashboard-card-heading"><h2>Tasks & Attention</h2><Link to="/operations/tasks">View All <ArrowRight size={14}/></Link></div>
          <div className="attention-list dashboard-attention">
            {(data.needsAttention||[]).slice(0,6).map((item,index)=><Link key={index} to={item.href||"/"}><span className="attention-icon"><AlertCircle size={16}/></span><div><strong>{item.message}</strong><small>{String(item.type||"Attention").replaceAll("_"," ")}</small></div></Link>)}
            {!data.needsAttention?.length&&<div className="mini-empty">Nothing urgent needs your attention.</div>}
          </div>
        </article>
      </section>

      <section className="dashboard-experience-row">
        <article className="dashboard-experiences"><div><h2>Our Experiences</h2><p>Unforgettable moments for every occasion.</p></div><div className="experience-mini-grid">{experiences.map(([name,description,photo])=><Link key={name} to={can("read:content")?"/content/experiences":"/sales/proposals"}><img src={`/brand/proposals/${photo}`} alt={name}/><strong>{name}</strong><small>{description}</small></Link>)}</div></article>
        <article className="dashboard-business-card"><Sparkles size={26}/><div><h2>Every detail. Every moment.</h2><p>Bring the LOLA experience to life, from the first enquiry to the final photo.</p><Link to="/events/calendar">Plan your next event <ArrowRight size={14}/></Link></div></article>
        <article className="dashboard-proposal-card"><span className="lola-script">Good people.<br/>Better photos.</span>{can("write:sales")&&<button onClick={()=>navigate("/sales/proposals/new")}>Create a Proposal <ArrowRight size={17}/></button>}</article>
      </section>
      {data.metricDefinitions && <details className="dashboard-definitions"><summary>Metric Definitions</summary><dl>{Object.entries(data.metricDefinitions).map(([key,definition])=><div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{definition}</dd></div>)}</dl></details>}
    </main>
  );
}

function firstName(name=""){return name.trim().split(/\s+/)[0]||"";}
function initials(name=""){return name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()).join("")||"LO";}
function relativeTime(value){const diff=Date.now()-new Date(value).getTime();const hours=Math.floor(diff/3600000);if(hours<1)return"Just now";if(hours<24)return`${hours} hr ago`;const days=Math.floor(hours/24);return`${days} day${days===1?"":"s"} ago`;}

function trendLabel(bucket){const raw=String(bucket||""),date=new Date(`${raw.length===7?raw+"-01":raw}T12:00:00Z`);return Number.isNaN(date.getTime())?raw:date.toLocaleDateString("en-US",{month:"short",...(raw.length>7?{day:"numeric"}:{})});}
