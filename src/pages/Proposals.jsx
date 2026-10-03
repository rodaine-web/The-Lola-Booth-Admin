import { FilePlus2, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses=["","DRAFT","READY","SENT","VIEWED","ACCEPTED","CONVERTED","DECLINED","EXPIRED","ARCHIVED"];

export default function Proposals(){
  const [urlParams,setUrlParams]=useSearchParams();
  const [rows,setRows]=useState([]);
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");
  const [filtersOpen,setFiltersOpen]=useState(false);
  const status=urlParams.get("status")||"";

  useEffect(()=>{load();},[search,status,urlParams.toString()]);

  async function load(){
    try{
      const query=new URLSearchParams(urlParams);
      query.set("search",search);
      query.set("pageSize","50");
      if(status)query.set("status",status);else query.delete("status");
      const result=await api.get(`/proposals?${query}`);
      setRows(result.data||[]);
      setError("");
    }catch(err){setError(err.message);}
  }

  function setFilter(name,value){
    setUrlParams(current=>{
      const next=new URLSearchParams(current);
      if(value)next.set(name,value);else next.delete(name);
      return next;
    });
  }

  return <main className="page lola-list-page">
    <section className="page-heading lola-page-heading">
      <div>
        <p className="eyebrow">Sales</p>
        <h1>Proposals</h1>
        <p className="lede">Create, send, and track every proposal from one place.</p>
      </div>
      <div className="button-row">
        <button className="lola-secondary-button" onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={15}/>Filters</button>
        <Link className="primary-action" to="/sales/proposals/new"><FilePlus2 size={15}/>Create Proposal</Link>
      </div>
    </section>

    <section className="lola-status-tabs">
      {statuses.slice(0,7).map(item=><button key={item||"all"} className={status===item?"active":""} onClick={()=>setFilter("status",item)}>{item?item.toLowerCase().replaceAll("_"," "):"All"}</button>)}
    </section>

    <section className="lola-list-toolbar">
      <div className="lola-list-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search proposals by number, client, event or package..."/></div>
    </section>

    {filtersOpen&&<section className="lola-filter-drawer">
      <label>Status<select value={status} onChange={e=>setFilter("status",e.target.value)}>{statuses.map(item=><option key={item||"all"} value={item}>{item?item.toLowerCase().replaceAll("_"," "):"All statuses"}</option>)}</select></label>
      <label>Sort<select value={urlParams.get("sort_by")||"created_at"} onChange={e=>setFilter("sort_by",e.target.value)}><option value="created_at">Newest first</option><option value="total">Highest total</option><option value="event_date">Event date</option></select></label>
    </section>}

    {urlParams.has("funnel")&&<p className="note-text">Showing one matching proposal per lead for the selected dashboard funnel.</p>}
    {error&&<div className="toast error">{error}</div>}

    <DataTable
      rows={rows}
      columns={["proposal_number","client_name","event_name","event_date","total","status","sent_at","valid_through"]}
      getRowHref={row=>`/sales/proposals/${row.id}`}
      empty="No proposals found."
    />
  </main>;
}
