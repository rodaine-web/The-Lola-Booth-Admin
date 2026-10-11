import { recordCell } from '../components/workspace/RecordCells.jsx';
import RecordWorkspace, { RecordMetrics } from "../components/workspace/RecordWorkspace.jsx";
import RecordTable from "../components/workspace/RecordTable.jsx";

import { FilePlus2, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";

const statuses=["","DRAFT","SENT","VIEWED","PARTIALLY_PAID","PAID","OVERDUE","REFUNDED","VOID"];

export default function Invoices(){
  const [urlParams,setUrlParams]=useSearchParams();
  const [rows,setRows]=useState([]);
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");
  const [filtersOpen,setFiltersOpen]=useState(true);
  const status=urlParams.get("status")||"";

  useEffect(()=>{load();},[search,status,urlParams.toString()]);

  async function load(){
    try{
      const query=new URLSearchParams(urlParams);
      query.set("search",search);
      query.set("pageSize","50");
      if(status)query.set("status",status);else query.delete("status");
      const result=await api.get("/invoices?"+query.toString());
      setRows(result.data||[]);setError("");
    }catch(err){setError(err.message);}
  }

  function setFilter(name,value){
    setUrlParams(current=>{const next=new URLSearchParams(current);if(value)next.set(name,value);else next.delete(name);return next;});
  }

  return <main className="page lola-list-page record-module">
    <section className="page-heading lola-page-heading">
      <div><p className="eyebrow">Finance</p><h1>Invoices</h1><p className="lede">Create, send, and track what is owed.</p></div>
      <div className="button-row"><button className="lola-secondary-button" onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={15}/>Filters</button><Link className="primary-action" to="/finance/invoices/new"><FilePlus2 size={15}/>Create Invoice</Link></div>
    </section>

    <RecordMetrics module="Invoices" rows={rows}/>

    <div className="record-filter-bar"><section className="lola-list-toolbar"><div className="lola-list-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search invoice, client or event..."/></div></section>

    {filtersOpen&&<section className="lola-filter-drawer">
      <label>Status<select value={status} onChange={e=>setFilter("status",e.target.value)}>{statuses.map(item=><option key={item||"all"} value={item}>{item?item.toLowerCase().replaceAll("_"," "):"All statuses"}</option>)}</select></label>
      <label>Sort<select value={urlParams.get("sort_by")||"created_at"} onChange={e=>setFilter("sort_by",e.target.value)}><option value="created_at">Newest first</option><option value="total">Highest total</option><option value="event_date">Event date</option><option value="due_date">Due date</option></select></label>
    </section>}</div>

    {error&&<div className="toast error">{error}</div>}
    <RecordWorkspace module="Invoices" rows={rows}>    <RecordTable renderCell={recordCell} title="Invoices" rows={rows} columns={["invoice_number","client_name","event_name","total","amount_outstanding","due_date","status","updated_at"]} getRowHref={row=>"/finance/invoices/"+row.id} empty="No invoices found."/></RecordWorkspace>
  </main>;
}
