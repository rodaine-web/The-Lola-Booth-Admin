import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, CircleDot, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const ranges = [
  ["today", "Today"],
  ["week", "This Week"],
  ["mtd", "Month To Date"],
  ["ytd", "Year To Date"]
];

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = searchParams.get("range") || "today";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api.get(`/dashboard?range=${range}`).then(setData).catch((err) => setError(err.message));
  }, [range]);

  const trend = useMemo(() => data?.trends || [], [data]);

  if (error) return <main className="page"><div className="toast error">{error}</div></main>;
  if (!data) return <main className="page"><div className="empty-state">Loading dashboard...</div></main>;

  return (
    <main className="page">
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
          <Link to="/finance/payments">Record Payment</Link>
        </div>
      </div>

      <div className="segmented dashboard-ranges">
        {ranges.map(([key, label]) => <button key={key} className={range === key ? "active" : ""} onClick={() => setSearchParams({ range: key })}>{label}</button>)}
      </div>

      {data.groups.map((group) => (
        <section className="metric-section" key={group.title}>
          <div className="section-heading"><h2>{group.title}</h2></div>
          <div className="kpi-grid kpi-grid-phase7">
            {group.metrics.map((metric) => (
              <Link className="kpi kpi-link" key={metric.key} to={metric.href}>
                <span>{metric.label}</span>
                <strong>{formatMetric(metric)}</strong>
                <small className={`comparison ${metric.comparison.direction}`}>
                  {metric.comparison.direction === "up" ? <ArrowUpRight size={14} /> : metric.comparison.direction === "down" ? <ArrowDownRight size={14} /> : <CircleDot size={14} />}
                  {metric.comparison.label}
                </small>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="dashboard-grid">
        <Panel title="Revenue Trend">
          {trend.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trend}>
                <CartesianGrid stroke="#E8DDD0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area dataKey="booked_revenue" name="Booked" stroke="#1A1A1A" fill="#E8DDD0" />
                <Area dataKey="collected_revenue" name="Collected" stroke="#B89B6B" fill="#D9C6A8" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="empty-state">No revenue movement in this period.</div>}
        </Panel>
        <Panel title="Sales Funnel">
          <div className="funnel">
            {data.funnel.stages.map((stage) => (
              <article key={stage.key}>
                <span>{stage.label}</span>
                <strong>{stage.count.toLocaleString()}</strong>
                <small>{stage.overall_conversion}% overall</small>
              </article>
            ))}
          </div>
          <p className="note-text">{data.funnel.attribution}</p>
        </Panel>
      </section>

      <section className="dashboard-grid">
        <Panel title={range === "today" ? "Today's Events" : "Event Schedule"}>
          <DataTable rows={range === "week" ? flattenWeekly(data.weeklySchedule) : data.todaysEvents} columns={["event_date", "start_time", "client_name", "event_name", "venue_name", "experience_name", "package_name", "payment_status", "status"]} getRowHref={(row) => `/events/events/${row.id}`} empty="Nothing is booked for this period." />
        </Panel>
        <Panel title={range === "today" ? "Today's Tasks" : "Tasks Due"}>
          <DataTable rows={data.tasksDue} columns={["due_date", "title", "owner_name", "priority", "client_name", "event_name", "status"]} empty="No tasks due in this period." />
        </Panel>
        <Panel title="Needs Attention">
          <div className="attention-list">
            {data.needsAttention.map((item) => <Link key={`${item.type}-${item.href}-${item.date}`} to={item.href}><AlertTriangle size={16} /><span>{item.message}</span><small>{item.type.replaceAll("_", " ")}</small></Link>)}
            {!data.needsAttention.length && <div className="empty-state">No urgent operational issues.</div>}
          </div>
        </Panel>
        <Panel title="Upcoming Readiness">
          <div className="attention-list">
            {data.readiness.map((event) => <Link key={event.id} to={`/events/events/${event.id}`}><CalendarDays size={16} /><span>{event.event_name}</span><small>{event.readiness_issues.length} items need attention</small></Link>)}
            {!data.readiness.length && <div className="empty-state">Upcoming events look ready.</div>}
          </div>
        </Panel>
      </section>

      <section className="dashboard-grid">
        <Panel title="Lead Source Performance">
          <DataTable rows={data.leadSources} columns={["source", "leads", "qualified", "proposals", "bookings", "conversion_rate", "booked_revenue"]} empty="No leads in this period." />
        </Panel>
        <Panel title="Recent Activity">
          <DataTable rows={data.recentActivity} columns={["action", "summary", "entity_type", "created_at"]} empty="No recent activity." />
        </Panel>
      </section>

      <section className="panel">
        <h2>Metric Definitions</h2>
        <div className="definition-grid">
          {Object.entries(data.metricDefinitions).map(([key, value]) => <p key={key}><strong>{key.replaceAll("_", " ")}</strong>{value}</p>)}
        </div>
      </section>
    </main>
  );
}

function Panel({ title, children }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function formatMetric(metric) {
  if (metric.format === "money") return `$${Number(metric.value || 0).toLocaleString()}`;
  if (metric.format === "percent") return `${Number(metric.value || 0).toFixed(1)}%`;
  if (metric.format === "minutes") return `${Number(metric.value || 0).toFixed(0)} min`;
  return Number(metric.value || 0).toLocaleString();
}

function formatRange(range) {
  return `${new Date(range.start).toLocaleDateString()} to ${new Date(range.end).toLocaleDateString()}`;
}

function flattenWeekly(schedule = {}) {
  return Object.values(schedule).flat();
}
