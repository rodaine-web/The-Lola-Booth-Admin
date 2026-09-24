import AsyncState from "../components/AsyncState.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatMoney, formatDateOnly, formatPercent, formatCount } from "../utils/display.js";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, CircleDot, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Bar, BarChart, Cell, Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";
import { funnelHref, sourceHref, metricHref } from "../utils/dashboard-links.js";
import DataTable from "../components/DataTable.jsx";

const primaryKeys = ["new_leads", "booked_revenue", "collected_revenue", "outstanding_balance", "events_scheduled", "conversion_rate"];

const ranges = [
  ["today", "Today"],
  ["week", "This Week"],
  ["mtd", "Month To Date"],
  ["ytd", "Year To Date"]
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = searchParams.get("range") || "today";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [revision,setRevision]=useState(0);
  const [revenueSeries,setRevenueSeries]=useState("both");

  useEffect(() => {
    setError("");
    api.get(`/dashboard?range=${range}`).then(setData).catch((err) => setError(err.message));
  }, [range,revision]);

  const trend = useMemo(() => data?.trends || [], [data]);

  if (error) return <main className="page"><AsyncState error={error} onRetry={()=>setRevision(r=>r+1)} noun="dashboard"/></main>;
  if (!data) return <main className="page"><div className="empty-state">Loading dashboard...</div></main>;

  return (
    <main className="page operations-dashboard">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Executive dashboard</p>
          <h1>{data.label}</h1>
          <p className="lede">{formatRange(data.sqlRange)} · {data.timeZone}</p>
        </div>
        <div className="quick-actions">
          <Link to="/sales/leads">New Lead</Link>
          <Link to="/events/events">New Event</Link>
          <Link to="/sales/clients">New Client</Link>
          <Link to="/operations/live">Live operations</Link>
        </div>
      </div>

      {data.dataScope&&<p className="note-text">Explicit QA, seed and legacy fixture records are excluded from reporting.{data.dataScope.unreviewedLeads>0?` ${data.dataScope.unreviewedLeads} older leads are unreviewed and remain included until classified.`:""}</p>}
      <div className="segmented dashboard-ranges">
        {ranges.map(([key, label]) => <button key={key} className={range === key ? "active" : ""} onClick={() => setSearchParams({ range: key })}>{label}</button>)}
      </div>

      <section className="kpi-grid dashboard-priority" aria-label="Key performance indicators">
        {primaryKeys.map(key => data.groups.flatMap(group => group.metrics).find(metric => metric.key === key)).filter(Boolean).map(metric => <Kpi key={metric.key} metric={metric} range={data.sqlRange} />)}
      </section>
      <section className="dashboard-revenue">
        <Panel title="Revenue Trend"><div className="segmented-control" aria-label="Revenue series">{[["both","Both series"],["booked","Booked"],["collected","Collected"]].map(([key,label])=><button aria-pressed={revenueSeries===key} key={key} onClick={()=>setRevenueSeries(key)}>{label}</button>)}</div>
          {trend.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trend}>
                <CartesianGrid stroke="#E8DDD0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={value=>formatMoney(value)}/>
                <Tooltip formatter={value=>formatMoney(value)}/>
                {revenueSeries!=="collected"&&<Area dataKey="booked_revenue" name="Booked" stroke="#1A1A1A" fill="#E8DDD0" />}
                {revenueSeries!=="booked"&&<Area dataKey="collected_revenue" name="Collected" stroke="#B89B6B" fill="#D9C6A8" />}
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="empty-state">No revenue movement in this period.</div>}
          <div className="chart-links"><Link to="/events/events">View booked events</Link><Link to="/finance/invoices?balance=open">Review outstanding invoices</Link></div>
        </Panel>

      </section>

      <section className="dashboard-grid dashboard-charts-first">
        <Panel title="Sales pipeline"><ResponsiveContainer width="100%" height={260}><BarChart data={data.funnel.stages} layout="vertical" margin={{left:15,right:25}}><CartesianGrid horizontal={false} stroke="#e8ddd0"/><XAxis type="number" allowDecimals={false}/><YAxis dataKey="label" type="category" width={115} tick={{fontSize:12}}/><Tooltip/><Bar dataKey="count" name="Records" fill="#b89b6b" radius={[0,4,4,0]} onClick={entry=>navigate(funnelHref(entry.key,data.sqlRange))}/></BarChart></ResponsiveContainer><div className="chart-links">{data.funnel.stages.map(stage=><Link key={stage.key} to={funnelHref(stage.key,data.sqlRange)}>{stage.label} <strong>{stage.count}</strong></Link>)}</div><p className="note-text">{data.funnel.attribution}</p></Panel>
        <Panel title="Lead sources"><ResponsiveContainer width="100%" height={260}><BarChart data={data.leadSources}><CartesianGrid vertical={false} stroke="#e8ddd0"/><XAxis dataKey="source" tick={{fontSize:11}}/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="leads" name="Leads" fill="#514a40" radius={[4,4,0,0]} onClick={entry=>navigate(sourceHref(entry.source,data.sqlRange))}/></BarChart></ResponsiveContainer><div className="chart-links">{data.leadSources.map(source=><Link key={source.source} to={sourceHref(source.source,data.sqlRange)}>{source.source} <strong>{source.leads}</strong></Link>)}</div>{!data.leadSources.length&&<p className="note-text">No leads in the selected period.</p>}</Panel>
      </section>
      <section className="dashboard-grid dashboard-operations">
        <Panel title="Needs Attention">
          <div className="attention-list">
            {data.needsAttention.map((item) => <Link key={`${item.type}-${item.href}-${item.date}`} to={item.href}><StatusBadge status={item.severity||"NEEDS_ATTENTION"}/><span>{item.message}</span><small>{item.type.replaceAll("_", " ")}</small></Link>)}
            {!data.needsAttention.length && <div className="empty-state">No urgent operational issues.</div>}
          </div>
        </Panel>
        <Panel title="Upcoming Readiness">
          <div className="attention-list">
            {(data.upcomingEvents || data.readiness).map((event) => <Link key={event.id} to={`/events/events/${event.id}`}><StatusBadge status={event.operational_readiness ? (event.operational_readiness.critical ? "BLOCKED" : event.operational_readiness.score<100 ? "NEEDS_ATTENTION" : "READY") : event.readiness_issues?.length ? "NEEDS_ATTENTION" : "READY"}/><span>{event.event_name}</span><small>{event.operational_readiness ? `${event.operational_readiness.complete} of ${event.operational_readiness.total} checks complete` : `${event.readiness_issues?.length||0} readiness checks outstanding`}</small></Link>)}
            {!data.readiness.length && <div className="empty-state">Upcoming events look ready.</div>}
          </div>
        </Panel>
      </section>
      <section className="dashboard-grid">
        <Panel title={range === "today" ? "Today's Events" : "Event Schedule"}>
          <DataTable rows={range === "week" ? flattenWeekly(data.weeklySchedule) : data.todaysEvents} columns={["event_date", "start_time", "client_name", "event_name", "venue_name", "experience_name", "package_name", "payment_status", "status"]} getRowHref={(row) => `/events/events/${row.id}`} empty="Nothing is booked for this period." />
        </Panel>
        <Panel title={range === "today" ? "Today's Tasks" : "Tasks Due"}>
          <DataTable rows={data.tasksDue} columns={["due_date", "title", "owner_name", "priority", "client_name", "event_name", "status"]} empty="No tasks due in this period." />
        </Panel>

      </section>

      <details className="panel dashboard-secondary"><summary>Source performance and recent activity</summary><section className="dashboard-grid">
        <Panel title="Lead Source Performance">
          <DataTable rows={data.leadSources} columns={["source", "leads", "qualified", "proposals", "bookings", "conversion_rate", "booked_revenue"]} empty="No leads in this period." />
        </Panel>
        <Panel title="Recent Activity">
          <DataTable rows={data.recentActivity} columns={["action", "summary", "entity_type", "created_at"]} empty="No recent activity." />
        </Panel>
      </section>

      </details>
      <details className="panel dashboard-secondary"><summary>Additional performance metrics</summary>
      <section className="dashboard-more-metrics" aria-label="Detailed metrics">
        {data.groups.map(group => <details key={group.title} className="panel"><summary>{group.title} details</summary><div className="kpi-grid kpi-grid-phase7">{group.metrics.filter(metric => !primaryKeys.includes(metric.key)).map(metric => <Kpi key={metric.key} metric={metric} range={data.sqlRange} />)}</div></details>)}
      </section>
      </details>

      <details className="panel">
        <summary>Metric Definitions</summary>
        <div className="definition-grid">
          {Object.entries(data.metricDefinitions).map(([key, value]) => <p key={key}><strong>{key.replaceAll("_", " ")}</strong>{value}</p>)}
        </div>
      </details>
    </main>
  );
}

function Kpi({metric,range}) {
  return <Link className="kpi kpi-link" to={metricHref(metric,range)}><span>{metric.label}</span><strong>{formatMetric(metric)}</strong><small className={`comparison ${metric.comparison.direction}`}>{metric.comparison.direction === "up" ? <ArrowUpRight size={14}/> : metric.comparison.direction === "down" ? <ArrowDownRight size={14}/> : <CircleDot size={14}/>} {metric.comparison.label}</small></Link>;
}

function Panel({ title, children }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function formatMetric(metric) {
  if (metric.format === "money") return formatMoney(metric.value || 0);
  if (metric.format === "percent") return formatPercent(metric.value);
  if (metric.format === "minutes") return `${Number(metric.value || 0).toFixed(0)} min`;
  return formatCount(metric.value);
}

function formatRange(range) {
  return `${formatDateOnly(range.start)} to ${formatDateOnly(range.end)}`;
}

function flattenWeekly(schedule = {}) {
  return Object.values(schedule).flat();
}
