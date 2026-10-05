import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses=["","SUCCEEDED","PROCESSING","FAILED","PARTIALLY_REFUNDED","REFUNDED"];
const providers=["","STRIPE","PAYPAL","MANUAL"];

export default function Payments(){
  const [urlParams,setUrlParams]=useSearchParams();
  const [rows,setRows]=useState([]);
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");
  const [filtersOpen,setFiltersOpen]=useState(false);
  const provider=urlParams.get("provider")||"";
  const status=urlParams.get("status")||"";

  function setFilter(name,value){setUrlParams(current=>{const next=new URLSearchParams(current);if(value)next.set(name,value);else next.delete(name);return next;});}

  useEffect(()=>{load();},[search,provider,status,urlParams.toString()]);

  async function load(){
    try{
      const params=new URLSearchParams(urlParams);
      params.set("search",search);params.set("pageSize","50");
      if(provider)params.set("provider",provider);else params.delete("provider");
      if(status)params.set("status",status);else params.delete("status");
      const result=await api.get("/payments?"+params.toString());
      setRows(result.data||[]);setError("");
    }catch(err){setError(err.message);}
  }

  return <main className="page lola-list-page">
    <section className="page-heading lola-page-heading">
      <div><p className="eyebrow">Finance</p><h1>Payments</h1><p className="lede">All payments in one place.</p></div>
      <button className="lola-secondary-button" onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={15}/>Filters</button>
    </section>

    <section className="lola-status-tabs">
      {statuses.map(item=><button key={item||"all"} className={status===item?"active":""} onClick={()=>setFilter("status",item)}>{item?item.toLowerCase().replaceAll("_"," "):"All"}</button>)}
    </section>

    <section className="lola-list-toolbar">
      <div className="lola-list-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search payments by invoice, client or reference..."/></div>
    </section>

    {filtersOpen&&<section className="lola-filter-drawer">
      <label>Provider<select value={provider} onChange={e=>setFilter("provider",e.target.value)}>{providers.map(item=><option key={item||"all"} value={item}>{item||"All providers"}</option>)}</select></label>
      <label>From<input type="date" value={urlParams.get("from")||""} onChange={e=>setFilter("from",e.target.value)}/></label>
      <label>To<input type="date" value={urlParams.get("to")||""} onChange={e=>setFilter("to",e.target.value)}/></label>
    </section>}

    {error&&<div className="toast error">{error}</div>}
    <DataTable rows={rows} columns={["payment_date","client_name","invoice_number","provider","payment_method","amount","refunded_amount","status","reference_number"]} getRowHref={row=>"/finance/payments/"+row.id} empty="No payments found."/>
  </main>;
}
