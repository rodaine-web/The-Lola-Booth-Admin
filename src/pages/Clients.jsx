import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import { useDialogFocus } from "../utils/use-dialog-focus.js";

const clientTypes=["","INDIVIDUAL","CORPORATE","PLANNER","VENUE","OTHER"];

export default function Clients(){
  const [urlParams,setUrlParams]=useSearchParams();
  const [rows,setRows]=useState([]);
  const [search,setSearch]=useState("");
  const [creating,setCreating]=useState(urlParams.get("create")==="true");
  const [draft,setDraft]=useState({client_type:"INDIVIDUAL"});
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [revision,setRevision]=useState(0);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const type=urlParams.get("client_type")||"";
  useDialogFocus(creating,()=>setCreating(false));

  useEffect(()=>{if(urlParams.get("create")==="true")setCreating(true);},[urlParams]);

  useEffect(()=>{
    let active=true;
    const params=new URLSearchParams(urlParams);
    params.delete("create");
    params.set("search",search);
    if(type)params.set("client_type",type);else params.delete("client_type");
    api.get(`/clients?${params}`).then(result=>active&&setRows(result.data||[])).catch(err=>active&&setError(err.message));
    return()=>{active=false;};
  },[search,type,urlParams.toString(),revision]);

  function setType(value){setUrlParams(current=>{const next=new URLSearchParams(current);next.delete("create");if(value)next.set("client_type",value);else next.delete("client_type");return next;});}

  async function createClient(event){
    event.preventDefault();if(saving)return;setSaving(true);setError("");setNotice("");
    try{
      await api.post("/clients",draft);
      setCreating(false);setDraft({client_type:"INDIVIDUAL"});setRevision(v=>v+1);setNotice("Client created.");
      setUrlParams(current=>{const next=new URLSearchParams(current);next.delete("create");return next;});
    }catch(err){
      if(err.code==="POSSIBLE_DUPLICATE"&&err.details?.duplicate){
        setError(`Possible duplicate client: ${err.details.duplicate.name||"existing client"} (${err.details.duplicate.email||err.details.duplicate.phone||""}). Open the existing record before creating another.`);
      }else setError(err.message);
    }finally{setSaving(false);}
  }

  return <main className="page lola-list-page">
    <section className="page-heading lola-page-heading">
      <div><p className="eyebrow">Sales</p><h1>Clients</h1><p className="lede">Manage your clients.</p></div>
      <div className="button-row">
        <button className="lola-secondary-button" onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={15}/>Filters</button>
        <button className="primary-action" onClick={()=>{setDraft({client_type:"INDIVIDUAL"});setCreating(true);}}><Plus size={15}/>New Client</button>
      </div>
    </section>

    <section className="lola-list-toolbar">
      <div className="lola-list-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search clients by name, email, phone or company..."/></div>
    </section>

    {filtersOpen&&<section className="lola-filter-drawer"><label>Client type<select value={type} onChange={e=>setType(e.target.value)}>{clientTypes.map(item=><option key={item||"all"} value={item}>{item?item.replaceAll("_"," "):"All clients"}</option>)}</select></label></section>}

    {(error||notice)&&<div className={error?"toast error":"toast"}>{error||notice}</div>}
    <DataTable rows={rows} columns={["name","email","phone","company","client_type"]} getRowHref={row=>`/sales/clients/${row.id}`} empty="No clients found."/>

    {creating&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="New client">
      <form className="modal lola-create-modal" onSubmit={createClient}>
        <div className="modal-heading"><div><p className="eyebrow">New Client</p><h2>Add a client</h2></div><button type="button" onClick={()=>setCreating(false)}>Close</button></div>
        <p className="note-text">Start with the essentials. Address and preferences can be added later.</p>
        <div className="form-grid">
          <label>First name<input value={draft.first_name||""} onChange={e=>setDraft({...draft,first_name:e.target.value})}/></label>
          <label>Last name<input value={draft.last_name||""} onChange={e=>setDraft({...draft,last_name:e.target.value})}/></label>
          <label>Email<input type="email" value={draft.email||""} onChange={e=>setDraft({...draft,email:e.target.value})}/></label>
          <label>Phone<input type="tel" value={draft.phone||""} onChange={e=>setDraft({...draft,phone:e.target.value})}/></label>
          <label>Company<input value={draft.company||""} onChange={e=>setDraft({...draft,company:e.target.value})}/></label>
          <label>Client type<select value={draft.client_type||"INDIVIDUAL"} onChange={e=>setDraft({...draft,client_type:e.target.value})}>{clientTypes.filter(Boolean).map(item=><option key={item}>{item.replaceAll("_"," ")}</option>)}</select></label>
          <label className="wide">Notes<textarea value={draft.notes||""} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
        </div>
        <div className="modal-actions"><button type="button" onClick={()=>setCreating(false)}>Cancel</button><button className="primary-action" disabled={saving}>{saving?"Creating...":"Create Client"}</button></div>
      </form>
    </div>}
  </main>;
}
