import "../styles/record-workspace.css";
import StatusBadge from "../components/StatusBadge.jsx";
import AsyncState from "../components/AsyncState.jsx";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";

const columns = [
  ["UPCOMING", ["PREPARING", "NOT_STARTED", "CONFIRMED", "ISSUE_REPORTED", null]],
  ["EN ROUTE", ["EN_ROUTE"]],
  ["ON SITE", ["ON_SITE"]],
  ["SETTING UP", ["SETTING_UP"]],
  ["LIVE", ["LIVE"]],
  ["BREAKDOWN", ["BREAKDOWN"]],
  ["COMPLETE", ["COMPLETED", "COMPLETE"]]
];

export default function LiveOperations() {
  const [tab,setTab]=useState("All Events");
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    setError("");
    try {
      setDashboard(await api.get("/dashboard?range=today"));
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const grouped = useMemo(() => {
    const events = dashboard?.todaysEvents || [];
    return columns.map(([label, statuses]) => ({
      label,
      events: events.filter((event) => statuses.includes(event.operational_status || event.status))
    }));
  }, [dashboard]);

  return (
    <main className="page live-operations-redesign record-module">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Live Operations</h1><p className="lede">Monitor event readiness, team status and equipment in real time.</p>
        </div>
        <button className="primary-action" onClick={load} disabled={refreshing}><RefreshCw size={16} />Refresh</button>
      </div>
      {error && <AsyncState error={error} onRetry={load} noun="live operations"/>}{!dashboard&&!error&&<AsyncState loading noun="live operations"/>}
      <div className="live-meta">
        <span>Today</span>
        <span>{dashboard?.timeZone || "America/Chicago"}</span>
        <span>Updates every 30 seconds</span>
      </div>
      <div className="lola-status-tabs">{['All Events','Live','Upcoming','Completed'].map(value=><button key={value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{value}</button>)}</div>
      <section className="live-reference-list">{grouped.filter(column=>tab==='All Events'||(tab==='Live'?['LIVE','ON SITE','SETTING UP','BREAKDOWN','EN ROUTE'].includes(column.label):tab==='Completed'?column.label==='COMPLETE':column.label==='UPCOMING')).flatMap(column=>column.events.map(event=><article className="record-panel" key={event.id}><StatusBadge status={event.operational_status||event.status}/><LiveCard event={event}/></article>))}{dashboard&&!grouped.some(column=>column.events.length)&&<div className="empty-state"><h2>No events today</h2><p>Your event readiness and team assignments will appear here.</p></div>}</section>
    </main>
  );
}

function LiveCard({ event }) {
  const issues = event.readiness_issues || [];
  return (
    <Link to={`/events/events/${event.id}`} className="live-card">
      <strong>{event.event_name}</strong>
      <span><Clock size={14} />{event.start_time || event.setup_time || "Time TBD"} · {event.venue_name || "Venue TBD"}</span>
      <span><Users size={14} />{event.staff_count || 0} staff · {event.equipment_count || 0} equipment</span>
      <span className={issues.length ? "readiness bad" : "readiness good"}>
        {issues.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
        <StatusBadge status={event.operational_status==="ISSUE_REPORTED"?"BLOCKED":issues.length?"NEEDS_ATTENTION":"READY"}/>
      </span>
      <small>{event.client_name || "Client pending"} · {event.payment_status || "Payment status pending"}</small>
    </Link>
  );
}
