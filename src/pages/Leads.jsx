import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "FOLLOW_UP", "WON", "LOST"];
const sources = ["", "WEBSITE", "META", "FACEBOOK", "INSTAGRAM", "TIKTOK", "LINKEDIN", "Referral", "Phone", "Manual", "Other"];

export default function Leads() {
  const [view, setView] = useState("table");
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ search });
    if (source) params.set("source", source);
    if (campaign) params.set("campaign", campaign);
    api.get(`/leads?${params}`).then((result) => setLeads(result.data));
  }, [search, source, campaign]);

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
      <div className="toolbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads..." />
        <select value={source} onChange={(event) => setSource(event.target.value)}>
          {sources.map((item) => <option key={item || "all"} value={item}>{item || "All sources"}</option>)}
        </select>
        <input value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Campaign..." />
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
