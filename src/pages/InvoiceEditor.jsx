
import { ArrowLeft, FileText, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import RelationshipSelect from "../components/RelationshipSelect.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatMoney } from "../utils/display.js";

export default function InvoiceEditor(){
  const navigate=useNavigate();
  const {id}=useParams();
  const [params]=useSearchParams();
  const [loaded,setLoaded]=useState(!id);
  const [mode,setMode]=useState(params.get("proposalId")?"proposal":"proposal");
  const [proposal,setProposal]=useState(null);
  const [form,setForm]=useState({
    proposal_id:params.get("proposalId")||"",
    client_id:params.get("clientId")||"",
    event_id:params.get("eventId")||"",
    due_date:"",
    depositOnly:true,
    items:[]
  });
  const [item,setItem]=useState({description:"",quantity:1,unit_price:0,taxable:true,tax_rate:0,discount:0});
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    if(id){
      api.get("/invoices/"+id).then(invoice=>{setForm({...invoice,due_date:invoice.due_date?.slice(0,10)||"",items:invoice.items||[]});setLoaded(true);}).catch(err=>setError(err.message));
    }
  },[id]);

  useEffect(()=>{
    if(!id&&form.proposal_id){
      api.get("/proposals/"+form.proposal_id).then(data=>{setProposal(data);setForm(current=>({...current,client_id:data.client_id||current.client_id,event_id:data.event_id||current.event_id}));}).catch(err=>setError(err.message));
    }else if(!form.proposal_id)setProposal(null);
  },[form.proposal_id,id]);

  function setField(name,value){setForm(current=>({...current,[name]:value}));}

  const manualTotal=useMemo(()=>form.items.reduce((sum,line)=>sum+Math.max(0,Number(line.quantity||1)*Number(line.unit_price||0)-Number(line.discount||0)),0),[form.items]);

  async function save(event){
    event.preventDefault();if(saving)return;setSaving(true);setError("");
    try{
      const payload=compact({
        client_id:form.client_id,event_id:form.event_id,due_date:form.due_date,notes:form.notes,terms:form.terms,items:form.items,
        ...(!id?{proposal_id:form.proposal_id||null,depositOnly:mode==="proposal"?true:Boolean(form.depositOnly)}:{})
      });
      const created=id?await api.patch("/invoices/"+id,payload):await api.post("/invoices",payload);
      navigate("/finance/invoices/"+created.id);
    }catch(err){setError(err.message);}finally{setSaving(false);}
  }

  if(id)return <AdvancedInvoiceEdit loaded={loaded} form={form} setField={setField} item={item} setItem={setItem} error={error} saving={saving} save={save}/>;

  return <main className="page invoice-wizard-page">
    <div className="detail-back"><Link to="/finance/invoices"><ArrowLeft size={16}/>Back to invoices</Link></div>
    <section className="page-heading"><div><p className="eyebrow">Create Invoice</p><h1>Create Invoice</h1><p className="lede">Quick and easy from a proposal.</p></div></section>
    {error&&<div className="toast error">{error}</div>}

    <section className="source-choice invoice-source-choice">
      <button type="button" className={mode==="proposal"?"selected":""} onClick={()=>setMode("proposal")}><FileText size={20}/><strong>From Accepted Proposal</strong><span>Recommended</span></button>
      <button type="button" className={mode==="manual"?"selected":""} onClick={()=>{setMode("manual");setProposal(null);setField("proposal_id","");}}><Plus size={20}/><strong>Manual Invoice</strong><span>For non-proposal charges</span></button>
    </section>

    <form onSubmit={save}>
      {mode==="proposal"?<section className="wizard-panel invoice-proposal-panel">
        <div className="wizard-heading"><h2>Select the proposal</h2><p>Choose the accepted proposal you want to invoice. Existing proposal pricing will be reused.</p></div>
        <label>Proposal *<RelationshipSelect resource="proposals" value={form.proposal_id} placeholder="Search accepted proposals" onChange={value=>setField("proposal_id",value)}/></label>
        {proposal&&<div className="invoice-source-summary">
          <div><span>Proposal</span><strong>{proposal.proposal_number}</strong></div>
          <div><span>Client</span><strong>{proposal.client_name||"Client"}</strong></div>
          <div><span>Event</span><strong>{proposal.event_name||"Event details pending"}</strong></div>
          <div><span>Total</span><strong>{formatMoney(proposal.total||0)}</strong></div>
          <div><span>Status</span><StatusBadge status={proposal.status}/></div>
        </div>}
        <section className="invoice-options-card">
          <h3>Payment setup</h3>
          <p>The invoice tracks the full proposal total. The configured deposit is requested first, while the remaining balance stays on the same invoice.</p>
          <div className="form-grid">
            <label>Due date<input type="date" value={form.due_date||""} onChange={e=>setField("due_date",e.target.value)}/></label>
            <label className="wide">Notes<textarea value={form.notes||""} onChange={e=>setField("notes",e.target.value)} placeholder="Optional message shown on the invoice"/></label>
          </div>
        </section>
        <div className="wizard-actions"><Link to="/finance/invoices">Cancel</Link><button className="primary-action" disabled={!form.proposal_id||saving}>{saving?"Creating...":"Create Invoice"}</button></div>
      </section>:<section className="wizard-panel">
        <div className="wizard-heading"><h2>Manual invoice</h2><p>Use this only when the invoice is not tied to an accepted proposal.</p></div>
        <div className="form-grid">
          <label>Client<RelationshipSelect resource="clients" value={form.client_id} placeholder="Client" onChange={value=>setField("client_id",value)}/></label>
          <label>Event<RelationshipSelect resource="events" value={form.event_id} placeholder="Event" onChange={value=>setField("event_id",value)}/></label>
          <label>Due date<input type="date" value={form.due_date||""} onChange={e=>setField("due_date",e.target.value)}/></label>
          <label className="wide">Notes<textarea value={form.notes||""} onChange={e=>setField("notes",e.target.value)}/></label>
        </div>
        <section className="wizard-section">
          <div className="wizard-section-heading"><div><h2>Line items</h2><p>Add only the charges that belong on this invoice.</p></div><strong>{formatMoney(manualTotal)}</strong></div>
          <div className="inline-form invoice-line-form">
            <input aria-label="Line description" value={item.description} onChange={e=>setItem(current=>({...current,description:e.target.value}))} placeholder="Description"/>
            <input type="number" min="1" aria-label="Quantity" value={item.quantity} onChange={e=>setItem(current=>({...current,quantity:e.target.value}))}/>
            <input type="number" min="0" aria-label="Unit price" value={item.unit_price} onChange={e=>setItem(current=>({...current,unit_price:e.target.value}))}/>
            <button type="button" className="primary-action" disabled={!item.description} onClick={()=>{setForm(current=>({...current,items:[...current.items,item]}));setItem({description:"",quantity:1,unit_price:0,taxable:true,tax_rate:0,discount:0});}}><Plus size={16}/>Add</button>
          </div>
          <div className="line-list">{form.items.map((line,index)=><div key={line.description+"-"+index}><span>{line.description} · {line.quantity} × {formatMoney(line.unit_price)}</span><button type="button" onClick={()=>setForm(current=>({...current,items:current.items.filter((_,i)=>i!==index)}))}><Trash2 size={14}/></button></div>)}</div>
        </section>
        <div className="wizard-actions"><Link to="/finance/invoices">Cancel</Link><button className="primary-action" disabled={!form.items.length||saving}>{saving?"Creating...":"Create Invoice"}</button></div>
      </section>}
    </form>
  </main>;
}

function AdvancedInvoiceEdit({loaded,form,setField,item,setItem,error,saving,save}){
  return <main className="page"><div className="detail-back"><Link to="/finance/invoices"><ArrowLeft size={16}/>Back to invoices</Link></div><section className="page-heading"><div><p className="eyebrow">Invoice</p><h1>Edit Invoice</h1><p className="lede">Update this unpaid draft invoice.</p></div></section>{error&&<div className="toast error">{error}</div>}<form onSubmit={save} className="document-editor"><section className="panel"><div className="form-grid"><label>Client<RelationshipSelect resource="clients" value={form.client_id} placeholder="Client" onChange={value=>setField("client_id",value)}/></label><label>Event<RelationshipSelect resource="events" value={form.event_id} placeholder="Event" onChange={value=>setField("event_id",value)}/></label><label>Due date<input type="date" value={form.due_date||""} onChange={e=>setField("due_date",e.target.value)}/></label><label className="wide">Notes<textarea value={form.notes||""} onChange={e=>setField("notes",e.target.value)}/></label></div></section><section className="panel"><h2>Line Items</h2><div className="inline-form invoice-line-form"><input value={item.description} onChange={e=>setItem(current=>({...current,description:e.target.value}))} placeholder="Description"/><input type="number" min="1" value={item.quantity} onChange={e=>setItem(current=>({...current,quantity:e.target.value}))}/><input type="number" min="0" value={item.unit_price} onChange={e=>setItem(current=>({...current,unit_price:e.target.value}))}/><button type="button" className="primary-action" disabled={!item.description} onClick={()=>{setField("items",[...form.items,item]);setItem({description:"",quantity:1,unit_price:0,taxable:true,tax_rate:0,discount:0});}}><Plus size={15}/>Add</button></div><div className="line-list">{form.items.map((line,index)=><div key={line.description+"-"+index}><span>{line.description} · {line.quantity} × {formatMoney(line.unit_price)}</span><button type="button" onClick={()=>setField("items",form.items.filter((_,i)=>i!==index))}><Trash2 size={14}/></button></div>)}</div></section><div className="modal-actions"><Link to="/finance/invoices">Cancel</Link><button className="primary-action" disabled={!loaded||saving}>Save Invoice</button></div></form></main>;
}

function compact(value){return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,item===""?null:item]));}
