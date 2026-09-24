import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "FOLLOW_UP", "WON", "LOST"];
const sources = ["", "WEBSITE", "META", "FACEBOOK", "INSTAGRAM", "TIKTOK", "LINKEDIN", "Referral", "Phone", "Manual", "Other"];

export default function Leads() {
  const [urlParams, setUrlParams] = useSearchParams();
  const [view, setView] = useState("table");
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const source = urlParams.get("source") || urlParams.get("source_group") || "";
  const [error, setError] = useState("");
  function setSource(value) { setUrlParams(current => { const next = new URLSearchParams(current); next.delete("source_group"); if (value) next.set("source", value); else next.delete("source"); return next; }); }
  const [campaign, setCampaign] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(urlParams);
    params.set("search", search);
    if (source && !params.has("source_group")) params.set("source", source);
    if (campaign) params.set("campaign", campaign);
    let active = true;
    api.get(`/leads?${params}`).then((result) => { if (active) { setLeads(result.data); setError(""); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [search, source, campaign, urlParams]);

  const columns = useMemo(() => ["first_name", "last_name", "email", "event_date", "event_type", "lead_source", "source_subtype", "campaign", "status"], []);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Sales CRM</p>
          <h1>Leads</h1>
        </div>
        <div className="segmented">
          <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Table</button>
          <button className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")}>Kanban</button>
        </div>
      </div>
      {error && <div className="toast error">{error}</div>}
      <div className="toolbar">
        <input aria-label="Search leads" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads..." />
        <select aria-label="Lead source" value={source} onChange={(event) => setSource(event.target.value)}>
          {[...new Set([...sources, source])].map((item) => <option key={item || "all"} value={item}>{item || "All sources"}</option>)}
        </select>
        <input aria-label="Campaign" value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Campaign..." />
      </div>
      {view === "table" ? <DataTable rows={leads} columns={columns} empty="No new inquiries." getRowHref={(lead) => `/sales/leads/${lead.id}`} /> : <Kanban leads={leads} />}
    </main>
  );
}

function Kanban({ leads }) {
  return (
    <div className="kanban">
      {statuses.map((status) => (
        <section key={status}>
          <h2>{status.replaceAll("_", " ")}</h2>
          {leads.filter((lead) => lead.status === status).map((lead) => (
            <Link key={lead.id} to={`/sales/leads/${lead.id}`} className="lead-card">
              <strong>{lead.first_name} {lead.last_name}</strong>
              <span>{lead.event_type} · {new Date(lead.event_date).toLocaleDateString()}</span>
              <small>{lead.email}</small>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
