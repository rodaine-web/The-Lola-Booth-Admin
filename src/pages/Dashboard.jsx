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
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { api } from "../api/client.js";
import { funnelHref, sourceHref, metricHref } from "../utils/dashboard-links.js";

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
    label:String(row.bucket||"").slice(5)
  })),[data]);

  if(error)return <main className="page"><AsyncState error={error} onRetry={()=>setRevision(v=>v+1)} noun="dashboard"/></main>;
  if(!data)return <main className="page"><AsyncState loading noun="dashboard"/></main>;

  const cards=[
    ["upcoming_events","Upcoming Events",CalendarDays],
    ["new_leads","New Leads",UsersRound],
    ["proposals_sent","Proposals Sent",FileText],
    ["collected_revenue","Revenue",CircleDollarSign]
  ];

  return (
    <main className="page lola-dashboard">
      <section className="dashboard-hero-row">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Good morning, {firstName(user?.name || data?.viewerName)||"there"}!</h1>
          <p className="lede">Here’s what’s happening with The Lola Booth today.</p>
        </div>
        <div className="dashboard-range-picker">
          {ranges.map(([key,label])=><button key={key} className={range===key?"active":""} onClick={()=>setSearchParams({range:key})}>{label}</button>)}
        </div>
      </section>

      <section className="dashboard-top-grid">
        <div className="dashboard-kpi-row">
          {cards.map(([key,label,Icon])=>{
            const metric=metricMap[key]||{};
            return <Link key={key} className="dashboard-kpi-card" to={metricHref(metric,data.sqlRange)}>
              <span className="dashboard-kpi-icon"><Icon size={20}/></span>
              <div><strong>{metric.format==="money"?formatMoney(metric.value||0):formatCount(metric.value||0)}</strong><span>{label}</span><small>{metric.comparison?.label||"Current period"}</small></div>
            </Link>;
          })}
        </div>
        <aside className="dashboard-brand-card">
          <div>
            <span>THE LOLA BOOTH</span>
            <h2>Good people.<br/>Better photos.</h2>
            {GALLERY_ENABLED && can("read:events") && <Link to="/operations/galleries">View Gallery <ArrowRight size={15}/></Link>}
          </div>
          <Sparkles size={54}/>
        </aside>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel dashboard-chart-card">
          <div className="dashboard-card-heading">
            <div><h2>Sales Overview</h2><p>Revenue, proposals and bookings over time.</p></div>
            <span>{data.label}</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={salesTrend}>
              <defs>
                <linearGradient id="revenueFade" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#b28745" stopOpacity={.3}/><stop offset="95%" stopColor="#b28745" stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid stroke="#eee9e2" vertical={false}/>
              <XAxis dataKey="label" tick={{fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>formatMoney(v)}/>
              <Tooltip formatter={v=>formatMoney(v)}/>
              <Area type="monotone" dataKey="booked_revenue" name="Booked" stroke="#171717" fill="transparent" strokeWidth={2}/>
              <Area type="monotone" dataKey="collected_revenue" name="Collected" stroke="#b28745" fill="url(#revenueFade)" strokeWidth={2}/>
            </AreaChart>
          </ResponsiveContainer>
        </article>

        <article className="panel dashboard-source-card">
          <div className="dashboard-card-heading"><div><h2>Leads by Source</h2><p>Where your leads are coming from.</p></div></div>
          <div className="dashboard-source-layout">
            <ResponsiveContainer width="48%" height={220}>
              <PieChart>
                <Pie data={data.leadSources||[]} dataKey="leads" nameKey="source" innerRadius={58} outerRadius={88} paddingAngle={2}>
                  {(data.leadSources||[]).map((_,i)=><Cell key={i} fill={["#e3c79d","#171717","#e7a1aa","#d6b4cf","#b6b8bb","#eadfd2"][i%6]}/>)}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
            <div className="dashboard-source-list">
              {(data.leadSources||[]).slice(0,6).map(source=><Link key={source.source} to={sourceHref(source.source,data.sqlRange)}><span>{source.source}</span><strong>{source.leads}</strong></Link>)}
            </div>
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

      {data.metricDefinitions && <details className="panel dashboard-definitions"><summary>Metric Definitions</summary><dl>{Object.entries(data.metricDefinitions).map(([key,definition])=><div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{definition}</dd></div>)}</dl></details>}
      <section className="dashboard-quick-actions">
        {can("write:sales") && <button onClick={()=>navigate("/sales/leads?create=true")}><Plus size={15}/>New Lead</button>}
        {can("write:sales") && <button onClick={()=>navigate("/sales/proposals/new")}><Plus size={15}/>Create Proposal</button>}
        {can("write:finance") && <button onClick={()=>navigate("/finance/invoices/new")}><Plus size={15}/>Create Invoice</button>}
        {can("write:events") && <button onClick={()=>navigate("/events/events?create=true")}><Plus size={15}/>New Event</button>}
      </section>
    </main>
  );
}

function firstName(name=""){return name.trim().split(/\s+/)[0]||"";}
function initials(name=""){return name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()).join("")||"LO";}
function relativeTime(value){const diff=Date.now()-new Date(value).getTime();const hours=Math.floor(diff/3600000);if(hours<1)return"Just now";if(hours<24)return`${hours} hr ago`;const days=Math.floor(hours/24);return`${days} day${days===1?"":"s"} ago`;}
