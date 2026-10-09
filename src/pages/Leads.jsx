import { recordCell } from '../components/workspace/RecordCells.jsx';
import RecordWorkspace, { RecordMetrics } from "../components/workspace/RecordWorkspace.jsx";
import RecordTable from "../components/workspace/RecordTable.jsx";
import EventTypeSelect from "../components/EventTypeSelect.jsx";
import { useDialogFocus } from "../utils/use-dialog-focus.js";
import { formatDateOnly } from "../utils/display.js";
import { Plus, Search, SlidersHorizontal, Table2, Columns3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.jsx";

const statuses=["","NEW","CONTACTED","QUALIFIED","PROPOSAL_DRAFT","PROPOSAL_SENT","FOLLOW_UP","WON","LOST"];
const sources=["","WEBSITE","META","FACEBOOK","INSTAGRAM","TIKTOK","LINKEDIN","Referral","Phone","Manual","Other"];
const eventTypes=["Wedding","Birthday","Private Party","Brand Activation","Corporate Event","Other"];

export default function Leads(){
  const [urlParams,setUrlParams]=useSearchParams();
  const [creating,setCreating]=useState(urlParams.get("create")==="true");
  const [saving,setSaving]=useState(false);
  const [draft,setDraft]=useState({});
  const [revision,setRevision]=useState(0);
  const [view,setView]=useState("table");
  const [leads,setLeads]=useState([]);
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");
  const [filtersOpen,setFiltersOpen]=useState(true);
  useDialogFocus(creating,()=>setCreating(false));

  const source=urlParams.get("source")||urlParams.get("source_group")||"";
  const status=urlParams.get("status")||"";
  const campaign=urlParams.get("campaign")||"";

  useEffect(()=>{
    if(urlParams.get("create")==="true"){setCreating(true);}
  },[urlParams]);

  useEffect(()=>{
    const params=new URLSearchParams(urlParams);
    params.delete("create");
    params.set("search",search);
    if(source&&!params.has("source_group"))params.set("source",source);
    if(status)params.set("status",status);else params.delete("status");
    if(campaign)params.set("campaign",campaign);else params.delete("campaign");
    let active=true;
    api.get(`/leads?${params}`).then(result=>{if(active){setLeads(result.data||[]);setError("");}}).catch(err=>active&&setError(err.message));
    return()=>{active=false;};
  },[search,source,status,campaign,urlParams.toString(),revision]);

  function setFilter(name,value){
    setUrlParams(current=>{
      const next=new URLSearchParams(current);
      next.delete("create");
      if(name==="source")next.delete("source_group");
      if(value)next.set(name,value);else next.delete(name);
      return next;
    });
  }

  async function createLead(event){
    event.preventDefault();
    if(saving)return;
    setSaving(true);setError("");
    try{
      await api.post("/leads",{
        ...draft,
        guest_count:draft.guest_count?Number(draft.guest_count):null,
        event_type:draft.event_type==="Other"?(draft.custom_event_type||"Other"):draft.event_type
      });
      setCreating(false);setDraft({});setRevision(v=>v+1);
      setUrlParams(current=>{const next=new URLSearchParams(current);next.delete("create");return next;});
    }catch(err){
      const duplicate=err.details?.duplicate;
      if(err.code==="POSSIBLE_DUPLICATE"&&duplicate){
        const reason=duplicate.match_reason==="EMAIL_MATCH"?"email address":"phone number";
        setError(`Possible duplicate: the ${reason} matches ${[duplicate.first_name,duplicate.last_name].filter(Boolean).join(" ")}. Open the existing lead before creating another.`);
      }else setError(err.message);
    }finally{setSaving(false);}
  }

  const columns=useMemo(()=>["name","email","phone","event_type","status","created_at"],[]);

  return <main className="page lola-list-page record-module">
    <section className="page-heading lola-page-heading">
      <div><p className="eyebrow">Sales</p><h1>Leads</h1><p className="lede">Capture. Track. Convert.</p></div>
      <div className="button-row">
        <button className="lola-secondary-button" onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={15}/>Filters</button>
        <button className="primary-action" onClick={()=>{setDraft({event_type:"",status:"NEW"});setCreating(true);setError("");}}><Plus size={15}/>New Lead</button>
      </div>
    </section>

    <RecordMetrics module="Leads" rows={leads}/>

    <div className="record-filter-bar"><section className="lola-list-toolbar">
      <div className="lola-list-search"><Search size={16}/><input aria-label="Search leads" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search leads by name, email, phone..."/></div>
      <div className="lola-view-toggle"><button aria-label="Table view" className={view==="table"?"active":""} onClick={()=>setView("table")}><Table2 size={15}/></button><button aria-label="Board view" className={view==="kanban"?"active":""} onClick={()=>setView("kanban")}><Columns3 size={15}/></button></div>
    </section>

    {filtersOpen&&<section className="lola-filter-drawer">
      <label>Source<select value={source} onChange={e=>setFilter("source",e.target.value)}>{[...new Set([...sources,source])].map(item=><option key={item||"all"} value={item}>{item||"All sources"}</option>)}</select></label>
      <label>Campaign<input value={campaign} onChange={e=>setFilter("campaign",e.target.value)} placeholder="Campaign"/></label>
      <button onClick={()=>{setFilter("source","");setFilter("campaign","");}}>Clear filters</button>
    </section>}<label>Status<select value={status} onChange={e=>setFilter("status",e.target.value)}>{statuses.map(item=><option key={item||"all"} value={item}>{item?item.replaceAll("_"," "):"All statuses"}</option>)}</select></label></div>

    {error&&<div className="toast error">{error}</div>}

    <RecordWorkspace module="Leads" rows={leads}>    {view==="table"
      ? <RecordTable renderCell={recordCell} title="Leads" rows={leads.map(lead=>({...lead,name:[lead.first_name,lead.last_name].filter(Boolean).join(" ")}))} columns={["name","event_type","lead_source","status","event_date","updated_at"]} columnLabels={{lead_source:"Source",updated_at:"Last Activity"}} empty="No leads found." getRowHref={lead=>`/sales/leads/${lead.id}`}/>
      : <LeadBoard leads={leads}/>
    }</RecordWorkspace>

    {creating&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="New lead">
      <form className="modal lola-create-modal" onSubmit={createLead}>
        <div className="modal-heading"><div><p className="eyebrow">New Lead</p><h2>Add a sales opportunity</h2></div><button type="button" onClick={()=>setCreating(false)}>Close</button></div>
        <p className="note-text">Only the essentials are required. Event details can be completed later.</p>
        <div className="form-grid">
          <label>First name *<input required value={draft.first_name||""} onChange={e=>setDraft({...draft,first_name:e.target.value})}/></label>
          <label>Last name *<input required value={draft.last_name||""} onChange={e=>setDraft({...draft,last_name:e.target.value})}/></label>
          <label>Email *<input required type="email" value={draft.email||""} onChange={e=>setDraft({...draft,email:e.target.value})}/></label>
          <label>Phone *<input required type="tel" value={draft.phone||""} onChange={e=>setDraft({...draft,phone:e.target.value})}/></label>
          <label>Event date *<input required type="date" value={draft.event_date||""} onChange={e=>setDraft({...draft,event_date:e.target.value})}/></label>
          <label>Event type *<select required value={draft.event_type||""} onChange={e=>setDraft({...draft,event_type:e.target.value})}><option value="">Select event type</option>{eventTypes.map(type=><option key={type}>{type}</option>)}</select></label>
          {draft.event_type==="Other"&&<label>Describe event type <span className="required-mark" aria-hidden="true">*</span><input aria-label="Describe event type" required value={draft.custom_event_type||""} onChange={e=>setDraft({...draft,custom_event_type:e.target.value})}/></label>}
          <label>Guests<input type="number" min="1" value={draft.guest_count||""} onChange={e=>setDraft({...draft,guest_count:e.target.value})}/></label>
          <label>Venue<input value={draft.venue_name||""} onChange={e=>setDraft({...draft,venue_name:e.target.value})}/></label>
          <label className="wide">Notes<textarea value={draft.message||""} onChange={e=>setDraft({...draft,message:e.target.value})} placeholder="What did the client tell us?"/></label>
        </div>
        <div className="modal-actions"><button type="button" onClick={()=>setCreating(false)}>Cancel</button><button className="primary-action" disabled={saving}>{saving?"Creating...":"Create Lead"}</button></div>
      </form>
    </div>}
  </main>;
}

function LeadBoard({leads}){
  const boardStatuses=["NEW","CONTACTED","QUALIFIED","PROPOSAL_SENT","FOLLOW_UP","WON"];
  return <div className="kanban lola-kanban">{boardStatuses.map(status=><section key={status}><h2>{status.replaceAll("_"," ")}</h2>{leads.filter(lead=>lead.status===status).map(lead=><Link key={lead.id} className="lead-card" to={`/sales/leads/${lead.id}`}><strong>{lead.first_name} {lead.last_name}</strong><span>{lead.event_type||"Event TBD"} · {lead.event_date?formatDateOnly(lead.event_date):"Date TBD"}</span><small>{lead.email}</small><StatusBadge status={lead.status}/></Link>)}</section>)}</div>;
}
