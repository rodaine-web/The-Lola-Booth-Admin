import {useDialogFocus} from "../utils/use-dialog-focus.js";
import { formatDateOnly, formatMoney, formatTimestamp } from "../utils/display.js";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "FOLLOW_UP", "WON", "LOST"];
const sources = ["", "WEBSITE", "META", "FACEBOOK", "INSTAGRAM", "TIKTOK", "LINKEDIN", "Referral", "Phone", "Manual", "Other"];

export default function Leads() {
  const [creating,setCreating]=useState(false),[saving,setSaving]=useState(false),[draft,setDraft]=useState({}),[revision,setRevision]=useState(0);
  useDialogFocus(creating,()=>setCreating(false));
  async function createLead(e){e.preventDefault();if(saving)return;setSaving(true);setError('');try{await api.post('/leads',draft);setCreating(false);setRevision(v=>v+1);}catch(error){setError(error.message);}finally{setSaving(false);}}

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
  }, [search, source, campaign, urlParams,revision]);

  const columns = useMemo(() => ["first_name", "last_name", "email", "event_date", "event_type", "lead_source", "source_subtype", "campaign", "status"], []);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Sales CRM</p>
          <h1>Leads</h1>
        </div>
        <div className="segmented"><button onClick={()=>{setDraft({});setCreating(true);setError('');}}>New Lead</button>
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
      {creating&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="New lead"><form className="modal" onSubmit={createLead} aria-describedby={error?'lead-form-error':undefined}><h2>New Lead</h2>{error&&<p role="alert" id="lead-form-error">{error}</p>}<div className="form-grid">{[['first_name','First name','text'],['last_name','Last name','text'],['email','Email','email'],['phone','Phone','tel'],['event_date','Event date','date'],['event_type','Event type','text']].map(([key,label,type])=><label key={key}>{label}<input required type={type} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</div><button disabled={saving}>Create Lead</button><button type="button" onClick={()=>setCreating(false)}>Cancel</button></form></div>}
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
              <span>{lead.event_type} · {formatDateOnly(lead.event_date)}</span>
              <small>{lead.email}</small>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
