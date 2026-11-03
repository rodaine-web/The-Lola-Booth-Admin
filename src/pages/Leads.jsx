import { recordCell } from '../components/workspace/RecordCells.jsx';
import RecordWorkspace, { RecordMetrics } from "../components/workspace/RecordWorkspace.jsx";
import RecordTable from "../components/workspace/RecordTable.jsx";
import EventTypeSelect from "../components/EventTypeSelect.jsx";
import { useDialogFocus } from "../utils/use-dialog-focus.js";
import { formatDateOnly } from "../utils/display.js";
import { Plus, Search, SlidersHorizontal, Table2, Columns3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import {useAuth} from "../context/AuthContext.jsx";
import CrmImportWizard,{CrmImportHistory} from "../components/CrmImportWizard.jsx";
import "../styles/crm-contacts.css";
import StatusBadge from "../components/StatusBadge.jsx";

const statuses=["ACTIVE","ALL","NEW","CONTACTED","QUALIFIED","PROPOSAL_DRAFT","PROPOSAL_SENT","FOLLOW_UP","WON","LOST"];
const sources=["","WEBSITE","META","FACEBOOK","INSTAGRAM","TIKTOK","LINKEDIN","Referral","Phone","MANUAL","Bark.com","Other"];
const eventTypes=["Wedding","Birthday","Private Party","Brand Activation","Corporate Event","Other"];

export default function Leads(){
  const {can}=useAuth();
  const [selected, setSelected] = useState([]);
  const [bulkAction, setBulkAction] = useState(null);
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  useDialogFocus(Boolean(bulkAction), () => { if (!actingRef.current) setBulkAction(null); });
  function toggleLead(id) { setSelected(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]); }
  async function applyBulkAction() {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true); setError(""); setNotice("");
    try {
      const result = await api.post("/leads/bulk-action", { ids: selected, action: bulkAction });
      setNotice(`${result.count} lead${result.count === 1 ? "" : "s"} ${ { archive: "archived", restore: "restored", delete: "deleted" }[bulkAction]}.`);
      setSelected([]); setBulkAction(null); setRevision(value => value + 1);
    } catch (err) { setError(err.message); }
    finally { actingRef.current = false; setActing(false); }
  }
  const [importView,setImportView]=useState("");
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

  const archived=urlParams.get("archived")==="true";
  const source=urlParams.get("source")||urlParams.get("source_group")||"";
  const status=urlParams.get("status")||(urlParams.get("funnel")==="booked"?"WON":urlParams.get("funnel")==="qualified"?"ALL":"ACTIVE");
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
    setLoading(true);setSelected([]);
    api.get(`/leads?${params}`).then(result=>{if(active){setLeads(result.data||[]);setError("");setLoading(false);}}).catch(err=>{if(active){setError(err.message);setLeads([]);setLoading(false);}});
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
        lead_source:draft.lead_source||"MANUAL",
        referral_source:draft.lead_source&&draft.lead_source!=="MANUAL"?draft.lead_source:null,
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

  const tableRows=useMemo(()=>leads.map(lead=>({...lead,name:[lead.first_name,lead.last_name].filter(Boolean).join(" ")})),[leads]);
  const columns=useMemo(()=>["name","email","phone","event_type","status","created_at"],[]);

  return <main className="page lola-list-page record-module">
    <section className="page-heading lola-page-heading">
      <div><p className="eyebrow">Sales</p><h1>Leads</h1><p className="lede">Capture. Track. Convert.</p></div>
      <div className="button-row">
        <button className="lola-secondary-button" onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={15}/>Filters</button>
        <>{can('import:contacts')&&can('write:sales')&&<><button onClick={()=>setImportView('upload')}>Upload Leads</button><button onClick={()=>api.download('/crm/imports/template/leads','LOLA-leads-import-template.xlsx').catch(e=>setError(e.message))}>Download Leads Template</button><button onClick={()=>setImportView('history')}>Import History</button></>}</><button className="primary-action" onClick={()=>{setDraft({event_type:"",status:"NEW"});setCreating(true);setError("");}}><Plus size={15}/>New Lead</button>
      </div>
    </section>

    <RecordMetrics module="Leads" rows={leads}/>

    <div className="record-filter-bar"><section className="lola-list-toolbar">
      <div className="lola-list-search"><Search size={16}/><input aria-label="Search leads" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search leads by name, email, phone..."/></div>
      <div className="lola-view-toggle"><button aria-label="Table view" className={view==="table"?"active":""} onClick={()=>setView("table")}><Table2 size={15}/></button><button aria-label="Board view" className={view==="kanban"?"active":""} onClick={()=>setView("kanban")}><Columns3 size={15}/></button></div>
    </section>

    <label>Lead visibility<select aria-label="Lead visibility" value={archived?"archived":"active"} onChange={e=>{setSelected([]);setUrlParams(current=>{const next=new URLSearchParams(current);if(e.target.value==="archived"){next.set("archived","true");next.set("status","ALL");}else{next.delete("archived");next.set("status","ACTIVE");}next.delete("funnel");return next;});}}><option value="active">Unarchived leads</option><option value="archived">Archived leads</option></select></label>
    {filtersOpen&&<section className="lola-filter-drawer">
      <label>Source<select value={source} onChange={e=>setFilter("source",e.target.value)}>{[...new Set([...sources,source])].map(item=><option key={item||"all"} value={item}>{item||"All sources"}</option>)}</select></label>
      <label>Opportunity type<select value={urlParams.get("opportunity_type")||""} onChange={e=>setFilter("opportunity_type",e.target.value)}><option value="">All opportunities</option><option value="BOOKING">Booking</option><option value="PARTNERSHIP">Partnership</option></select></label>
      <label>Campaign<input value={campaign} onChange={e=>setFilter("campaign",e.target.value)} placeholder="Campaign"/></label>
      <button onClick={()=>{setFilter("source","");setFilter("campaign","");}}>Clear filters</button>
    </section>}<label>Status<select aria-label="Lead status filter" value={status} onChange={e=>setFilter("status",e.target.value)}>{statuses.map(item=><option key={item||"all"} value={item}>{item==="ACTIVE"?"Active leads":item==="ALL"?"All statuses":item==="LOST"?"Lost":item.replaceAll("_"," ")}</option>)}</select></label></div>

    {notice&&<div role="status" className="toast">{notice}</div>}
    {error&&<div role="alert" className="toast error">{error}</div>}

      {can("write:sales") && <div className="lead-bulk-actions" aria-label="Lead selection actions">
        {view === "kanban" && <label className="check-row"><input type="checkbox" aria-label="Select all visible leads" disabled={loading || acting || !leads.length} checked={leads.length > 0 && leads.every(lead => selected.includes(lead.id))} onChange={event => setSelected(event.target.checked ? leads.map(lead => lead.id) : [])} />Select all visible</label>}
        <span aria-live="polite">{selected.length} selected</span>
        <button className="lola-secondary-button" disabled={!selected.length || acting || loading} onClick={() => { setError(""); setBulkAction(archived ? "restore" : "archive"); }}>{archived ? "Restore selected" : "Archive selected"}</button>
        <button className="lola-secondary-button" disabled={!selected.length || acting || loading} onClick={() => { setError(""); setBulkAction("delete"); }}>Delete selected</button>
        {selected.length > 0 && <button className="lola-secondary-button" disabled={acting} onClick={() => setSelected([])}>Clear selection</button>}
      </div>}
      {bulkAction && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${bulkAction} selected leads`}><div className="modal">
        <h2>{ { archive: "Archive", restore: "Restore", delete: "Delete" }[bulkAction]} {selected.length} selected lead{selected.length === 1 ? "" : "s"}?</h2>
        <p>{bulkAction === "delete" ? "These leads will be removed from the CRM. Linked bookings, proposals, and audit history will be retained. This screen cannot undo deletion." : bulkAction === "archive" ? "These leads will move to Archived leads. You can restore them later." : "These leads will return to Active leads."}</p>
        {error && <p role="alert">{error}</p>}
        <button className="lola-secondary-button" disabled={acting} onClick={applyBulkAction}>{acting ? "Saving…" : "Confirm"}</button><button className="lola-secondary-button" disabled={acting} onClick={() => setBulkAction(null)}>Cancel</button>
      </div></div>}

    <RecordWorkspace module="Leads" rows={leads}>    {loading ? <p role="status">Loading leads…</p> : view==="table"
      ? <RecordTable selectedIds={selected} onSelectionChange={setSelected} selectionDisabled={acting} renderCell={recordCell} title="Leads" rows={tableRows} columns={["name","opportunity_type","event_type","lead_source","status","event_date","updated_at"]} columnLabels={{lead_source:"Source",updated_at:"Last Activity"}} empty={archived?"No archived leads.":"No leads found."} getRowHref={lead=>`/sales/leads/${lead.id}`}/>
      : <LeadBoard leads={leads} selected={selected} onToggle={can("write:sales")?toggleLead:null} disabled={acting}/>
    }</RecordWorkspace>

    {importView==='upload'&&<CrmImportWizard kind="LEADS" onClose={()=>setImportView('')} onDone={()=>setRevision(v=>v+1)}/>}
    {importView==='history'&&<CrmImportHistory kind="LEADS" onClose={()=>setImportView('')}/>}
    {creating&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="New lead">
      <form className="modal lola-create-modal" onSubmit={createLead}>
        <div className="modal-heading"><div><p className="eyebrow">New Lead</p><h2>Add a sales opportunity</h2></div><button type="button" onClick={()=>setCreating(false)}>Close</button></div>
        <p className="note-text">Only the essentials are required. Event details can be completed later.</p>
        <div className="form-grid">
          <label>Opportunity type<select value={draft.opportunity_type||"BOOKING"} onChange={e=>setDraft({...draft,opportunity_type:e.target.value})}><option value="BOOKING">Booking</option><option value="PARTNERSHIP">Partnership</option></select></label><label>Organization<input value={draft.company||""} onChange={e=>setDraft({...draft,company:e.target.value})}/></label>
          <label>First name *<input required value={draft.first_name||""} onChange={e=>setDraft({...draft,first_name:e.target.value})}/></label>
          <label>Last name *<input required value={draft.last_name||""} onChange={e=>setDraft({...draft,last_name:e.target.value})}/></label>
          <label>Email *<input required type="email" value={draft.email||""} onChange={e=>setDraft({...draft,email:e.target.value})}/></label>
          <label>Phone *<input required type="tel" value={draft.phone||""} onChange={e=>setDraft({...draft,phone:e.target.value})}/></label>
          <label>Event date *<input required type="date" value={draft.event_date||""} onChange={e=>setDraft({...draft,event_date:e.target.value})}/></label>
          <label>Event type *<select required value={draft.event_type||""} onChange={e=>setDraft({...draft,event_type:e.target.value})}><option value="">Select event type</option>{eventTypes.map(type=><option key={type}>{type}</option>)}</select></label>
          {draft.event_type==="Other"&&<label>Describe event type <span className="required-mark" aria-hidden="true">*</span><input aria-label="Describe event type" required value={draft.custom_event_type||""} onChange={e=>setDraft({...draft,custom_event_type:e.target.value})}/></label>}
          <label>Guests<input type="number" min="1" value={draft.guest_count||""} onChange={e=>setDraft({...draft,guest_count:e.target.value})}/></label>
          <label>Lead source<select value={draft.lead_source||"MANUAL"} onChange={e=>setDraft({...draft,lead_source:e.target.value})}>{sources.filter(Boolean).map(item=><option key={item} value={item}>{item==="MANUAL"?"Manual":item}</option>)}</select></label>
          <label>Venue<input value={draft.venue_name||""} onChange={e=>setDraft({...draft,venue_name:e.target.value})}/></label>
          <label className="wide">Notes<textarea value={draft.message||""} onChange={e=>setDraft({...draft,message:e.target.value})} placeholder="What did the client tell us?"/></label>
        </div>
        <div className="modal-actions"><button type="button" onClick={()=>setCreating(false)}>Cancel</button><button className="primary-action" disabled={saving}>{saving?"Creating...":"Create Lead"}</button></div>
      </form>
    </div>}
  </main>;
}

function LeadBoard({leads,selected,onToggle,disabled}){
  const boardStatuses=["NEW","CONTACTED","QUALIFIED","PROPOSAL_DRAFT","PROPOSAL_SENT","FOLLOW_UP",...(["WON","LOST"].filter(status=>leads.some(lead=>lead.status===status)))];
  return <div className="kanban lola-kanban">{boardStatuses.map(status=><section key={status}><h2>{status.replaceAll("_"," ")}</h2>{leads.filter(lead=>lead.status===status).map(lead=><div key={lead.id} className="lead-selection-card">{onToggle&&<label className="check-row"><input type="checkbox" aria-label={`Select ${lead.first_name} ${lead.last_name}`} checked={selected.includes(lead.id)} disabled={disabled} onChange={()=>onToggle(lead.id)}/>Select lead</label>}<Link className="lead-card" to={`/sales/leads/${lead.id}`}><strong>{lead.first_name} {lead.last_name}</strong><span>{lead.event_type||"Event TBD"} · {lead.event_date?formatDateOnly(lead.event_date):"Date TBD"}</span><small>{lead.email}</small><StatusBadge status={lead.status}/></Link></div>)}</section>)}</div>;
}
