
import { ArrowLeft, ArrowRight, Check, FileText, Plus, Send, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import RelationshipSelect from "../components/RelationshipSelect.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { api } from "../api/client.js";

const eventTypes=["Wedding","Birthday","Private Party","Brand Activation","Corporate Event","Other"];

export default function ProposalWizard(){
  const navigate=useNavigate();
  const [params]=useSearchParams();
  const [step,setStep]=useState(1);
  const contextClientId = params.get("clientId") || "";
  const contextEventId = params.get("eventId") || "";
  const [context,setContext]=useState(null);
  const [contextLoading,setContextLoading]=useState(Boolean(contextClientId || contextEventId));
  const [sourceMode,setSourceMode]=useState(contextClientId || contextEventId ? "context" : "existing");
  const [lead,setLead]=useState(null);
  const [leadId,setLeadId]=useState(params.get("leadId")||"");
  const [experiences,setExperiences]=useState([]);
  const [packages,setPackages]=useState([]);
  const [addons,setAddons]=useState([]);
  const [selectedExperiences,setSelectedExperiences]=useState([]);
  const [selectedAddons,setSelectedAddons]=useState([]);
  const [advanced,setAdvanced]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [form,setForm]=useState({
    first_name:"",last_name:"",email:"",phone:"",event_name:"",event_type:"",custom_event_type:"",
    event_date:"",start_time:"",end_time:"",guest_count:"",venue_name:"",venue_address:"",city:"",state:"",
    notes:"",discount:"",travel:"",other_fees:"",deposit_value:"",valid_through:"",proposal_title:""
  });

  useEffect(()=>{
    Promise.all([
      api.get("/experiences?pageSize=100"),
      api.get("/packages?pageSize=200"),
      api.get("/addons?pageSize=100")
    ]).then(([x,p,a])=>{
      setExperiences((x.data||x||[]).filter(item=>item.active!==false));
      setPackages((p.data||p||[]).filter(item=>item.active!==false));
      setAddons((a.data||a||[]).filter(item=>item.active!==false));
    }).catch(()=>{});
  },[]);

  useEffect(()=>{if(leadId)hydrateLead(leadId);},[leadId]);

  useEffect(()=>{
    if(!contextClientId && !contextEventId)return;
    let active=true;
    async function loadContext(){
      try{
        const event=contextEventId ? await api.get("/events/"+contextEventId) : null;
        const clientId=event?.client_id || contextClientId;
        const client=clientId ? await api.get("/clients/"+clientId) : null;
        if(!active)return;
        if(!client)throw new Error("This event needs a linked client before creating a proposal.");
        setContext({client,event});
        const parts=(client.name||"").trim().split(/\s+/);
        const type=normalizeEventType(event?.event_type||"");
        setForm(current=>({...current,first_name:client.first_name||parts[0]||"",last_name:client.last_name||parts.slice(1).join(" "),email:client.email||"",phone:client.phone||"",
          event_name:event?.event_name||"",event_type:type,custom_event_type:type==="Other"?(event?.event_type||""):"",event_date:dateOnly(event?.event_date),
          start_time:event?.start_time||"",end_time:event?.end_time||"",guest_count:event?.guest_count||"",venue_name:event?.venue_name||"",venue_address:event?.venue_address||"",city:event?.city||"",state:event?.state||"",notes:event?.client_notes||client.notes||""}));
      }catch(err){if(active)setError(err.message);}
      finally{if(active)setContextLoading(false);}
    }
    loadContext();
    return()=>{active=false;};
  },[contextClientId,contextEventId]);

  async function hydrateLead(id){
    setError("");
    try{
      const record=await api.get("/leads/"+id);
      setLead(record);
      const normalized=normalizeEventType(record.event_type);
      setForm(current=>({
        ...current,
        first_name:record.first_name||"",
        last_name:record.last_name||"",
        email:record.email||"",
        phone:record.phone||"",
        event_name:record.event_name||proposalEventName(record),
        event_type:normalized,
        custom_event_type:normalized==="Other"?(record.event_type||""):"",
        event_date:dateOnly(record.event_date),
        start_time:record.event_start_time||"",
        end_time:record.event_end_time||"",
        guest_count:record.guest_count||"",
        venue_name:record.venue_name||"",
        venue_address:record.venue_address||"",
        city:record.city||"",
        state:record.state||"",
        notes:record.message||record.notes||"",
        proposal_title:[record.event_type,[record.first_name,record.last_name].filter(Boolean).join(" ")].filter(Boolean).join(" · ")
      }));
      if(record.preferredExperience){
        setSelectedExperiences([{
          experience_id:record.preferredExperience.id,
          name:record.preferredExperience.name,
          packages:record.preferredPackage?[packageSelection(record.preferredPackage)]:[],
          price:Number(record.preferredPackage?.starting_price??record.preferredExperience.base_price??0),
          description:record.preferredExperience.proposal_description||record.preferredExperience.description||""
        }]);
      }
    }catch(err){setError(err.message);}
  }

  function setField(name,value){setForm(current=>({...current,[name]:value}));}

  function chooseExperience(item){
    setSelectedExperiences(current=>{
      const exists=current.some(entry=>entry.experience_id===item.id);
      if(exists)return current.filter(entry=>entry.experience_id!==item.id);
      return [...current,{experience_id:item.id,name:item.name,packages:[],price:Number(item.base_price||0),description:item.proposal_description||item.description||""}];
    });
  }

  function choosePackage(experienceId,pkg){
    setSelectedExperiences(current=>current.map(item=>{
      if(item.experience_id!==experienceId)return item;
      const existing=item.packages||[];
      const has=existing.some(entry=>entry.package_id===pkg.id);
      const next=has?existing.filter(entry=>entry.package_id!==pkg.id):[packageSelection(pkg)];
      return {...item,packages:next,price:next.length?next.reduce((sum,entry)=>sum+Number(entry.price||0),0):item.price};
    }));
  }

  function chooseAddon(item){
    setSelectedAddons(current=>current.some(entry=>entry.addon_id===item.id)
      ?current.filter(entry=>entry.addon_id!==item.id)
      :[...current,{addon_id:item.id,description:item.name,quantity:1,unit_price:Number(item.price||0)}]
    );
  }

  const pricing=useMemo(()=>{
    const services=selectedExperiences.reduce((sum,item)=>sum+(item.packages?.length?item.packages.reduce((s,p)=>s+Number(p.price||0),0):Number(item.price||0)),0);
    const addonTotal=selectedAddons.reduce((sum,item)=>sum+Number(item.unit_price||0)*Number(item.quantity||1),0);
    const travel=Number(form.travel||0),other=Number(form.other_fees||0),discount=Number(form.discount||0);
    const subtotal=services+addonTotal+travel+other;
    return {services,addonTotal,total:Math.max(0,subtotal-discount)};
  },[selectedExperiences,selectedAddons,form.travel,form.other_fees,form.discount]);

  function actualEventType(){return form.event_type==="Other"?(form.custom_event_type||"Other"):form.event_type;}
  function eventTitle(){return form.event_name||[actualEventType(),[form.first_name,form.last_name].filter(Boolean).join(" ")].filter(Boolean).join(" · ")||"Event";}

  function validateStepOne(){
    if(contextLoading || (sourceMode==="context" && !context)){setError("Wait for the linked client and event to load, then try again.");return false;}
    const required=sourceMode==="existing"?[[leadId,"Select a lead"]]:[
      [form.first_name,"First name"],[form.last_name,"Last name"],[form.email,"Email"],[form.phone,"Phone"],[form.event_date,"Event date"],[form.event_type,"Event type"]
    ];
    const missing=required.find(([value])=>!value);
    if(missing){setError(missing[1]+" is required.");return false;}
    if(form.event_type==="Other"&&!form.custom_event_type){setError("Describe the event type.");return false;}
    if(form.start_time&&form.end_time&&form.end_time<=form.start_time){setError("End time must be after start time.");return false;}
    setError("");return true;
  }

  function next(){
    if(step===1&&!validateStepOne())return;
    if(step===2&&!selectedExperiences.length){setError("Select at least one LOLA experience.");return;}
    setError("");setStep(current=>Math.min(3,current+1));
  }

  async function createClientFromForm(){
    if(context?.client)return context.client.id;
    if(lead?.converted_client_id)return lead.converted_client_id;
    try{
      const client=await api.post("/clients",{
        first_name:form.first_name,last_name:form.last_name,email:form.email,phone:form.phone,
        name:[form.first_name,form.last_name].filter(Boolean).join(" "),notes:form.notes||null
      });
      return client.id;
    }catch(err){
      if(err.code==="POSSIBLE_DUPLICATE"&&err.details?.duplicate?.id)return err.details.duplicate.id;
      throw err;
    }
  }

  async function createEventIfReady(clientId){
    if(context?.event)return context.event.id;
    if(lead?.converted_event_id)return lead.converted_event_id;
    if(!form.event_date||!form.start_time||!form.end_time)return null;
    try{
      const event=await api.post("/events",{
        client_id:clientId,event_name:eventTitle(),event_type:actualEventType(),event_date:form.event_date,
        start_time:form.start_time,end_time:form.end_time,guest_count:form.guest_count?Number(form.guest_count):null,
        venue_name:form.venue_name||null,venue_address:form.venue_address||null,city:form.city||null,state:form.state||null,
        status:"TENTATIVE",experience_id:selectedExperiences[0]?.experience_id||null,
        package_id:selectedExperiences.flatMap(item=>item.packages||[])[0]?.package_id||null,
        experience_ids:selectedExperiences.map(item=>item.experience_id).filter(Boolean),
        package_ids:selectedExperiences.flatMap(item=>item.packages||[]).map(item=>item.package_id).filter(Boolean),
        client_notes:form.notes||null
      });
      return event.id;
    }catch(err){
      if(err.code==="POSSIBLE_DUPLICATE"&&err.details?.duplicate?.id)return err.details.duplicate.id;
      throw err;
    }
  }

  async function createLeadIfNeeded(){
    if(context?.event)return null;
    if(leadId)return leadId;
    const created=await api.post("/leads",{
      first_name:form.first_name,last_name:form.last_name,email:form.email,phone:form.phone,
      event_date:form.event_date,event_start_time:form.start_time||null,event_end_time:form.end_time||null,
      event_type:actualEventType(),guest_count:form.guest_count?Number(form.guest_count):null,
      venue_name:form.venue_name||null,venue_address:form.venue_address||null,city:form.city||null,state:form.state||null,
      message:form.notes||null,status:"NEW",preferred_experience_id:selectedExperiences[0]?.experience_id||null,
      preferred_package_id:selectedExperiences.flatMap(item=>item.packages||[])[0]?.package_id||null
    });
    return created.id;
  }

  function proposalSections(){
    return [
      section("Introduction","Thank you for considering The LOLA Booth for "+eventTitle()+".",0),
      section("Event Details",[
        actualEventType()?"Event type: "+actualEventType():null,
        form.event_date?"Date: "+form.event_date:null,
        form.guest_count?"Guests: "+form.guest_count:null,
        form.venue_name?"Venue: "+form.venue_name:null,
        form.venue_address?"Location: "+form.venue_address:null
      ].filter(Boolean).join("\n"),1),
      section("Proposed Experience",selectedExperiences.map(item=>item.name+(item.packages?.length?" — "+item.packages.map(p=>p.name).join(", "):"")).join("\n"),2),
      section("Investment Summary","Estimated investment: "+money(pricing.total),3),
      section("Next Steps","Review the experience and investment, request any edits, then approve when you are ready to proceed.",4),
      section("Terms","Final scope, pricing, availability, and logistics remain subject to the approved proposal and invoice.",5)
    ];
  }

  async function submit(send=false){
    if(busy)return;
    setBusy(true);setError("");
    try{
      const ensuredLeadId=await createLeadIfNeeded();
      const clientId=await createClientFromForm();
      const eventId=await createEventIfReady(clientId);
      const primaryExperience=selectedExperiences[0];
      const primaryPackage=selectedExperiences.flatMap(item=>item.packages||[])[0];
      const payload=clean({
        lead_id:ensuredLeadId,client_id:clientId,event_id:eventId,
        experience_id:primaryExperience?.experience_id||null,package_id:primaryPackage?.package_id||null,
        selected_experiences:selectedExperiences,addons:selectedAddons,
        proposal_title:form.proposal_title||actualEventType()+" Proposal",proposal_type:proposalType(actualEventType()),
        status:"DRAFT",notes:form.notes||null,discount:Number(form.discount||0),travel:Number(form.travel||0),
        other_fees:Number(form.other_fees||0),deposit_type:"PERCENTAGE",
        deposit_value:form.deposit_value===""?undefined:Number(form.deposit_value),
        valid_through:form.valid_through||undefined,sections:proposalSections(),
        introduction:"Thank you for considering The LOLA Booth for "+eventTitle()+".",
        next_steps:"Review the experience, pricing, and event details. Request any edits you need, then approve the proposal when you are ready to proceed."
      });
      const proposal=await api.post("/proposals",payload);
      if(send)await api.post("/proposals/"+proposal.id+"/send",{});
      navigate("/sales/proposals/"+proposal.id);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }

  return <main className="page proposal-wizard-page">
    <div className="detail-back"><Link to="/sales/proposals"><ArrowLeft size={16}/>Back to proposals</Link></div>
    <section className="page-heading">
      <div><p className="eyebrow">Proposal Builder</p><h1>Create Proposal</h1><p className="lede">Simple. Flexible. Fast.</p></div>
      <Link className="lola-secondary-button" to={"/sales/proposals/new/advanced"+(params.toString()?"?"+params.toString():"")}>Advanced editor</Link>
    </section>

    <div className="wizard-progress" aria-label="Proposal progress">
      {[["1","Client & Event"],["2","Services & Pricing"],["3","Review & Send"]].map(([number,label])=><div key={number} aria-current={step===Number(number)?"step":undefined} className={step>=Number(number)?"active":""}><span>{step>Number(number)?<Check size={14}/>:number}</span><strong>{label}</strong></div>)}
    </div>
    {error&&<div className="toast error">{error}</div>}

    {step===1&&<section className="wizard-panel">
      <div className="wizard-heading"><p className="eyebrow">Step 1 of 3</p><h2>Let’s get started</h2><p>Choose an existing lead or create a new one. We’ll prefill what we know and you can complete any gaps.</p></div>
      {sourceMode!=="context" && <div className="source-choice">
        <button className={sourceMode==="existing"?"selected":""} onClick={()=>setSourceMode("existing")}><UsersRound size={20}/><strong>Select Existing Lead</strong></button>
        <button className={sourceMode==="new"?"selected":""} onClick={()=>{setSourceMode("new");setLead(null);setLeadId("");}}><UserPlus size={20}/><strong>Create New Lead</strong></button>
      </div>}
      {sourceMode==="context" && <div className="cms-guidance" role="status">{contextLoading?"Loading client and event…":context?`Creating a proposal for ${context.client.name}${context.event?" · "+context.event.event_name:""}. Existing records will stay linked.`:"Unable to load the linked records. Retry by reopening this page."}</div>}
      {sourceMode==="existing"&&<div className="wizard-section">
        <label>Search for a lead *<RelationshipSelect resource="leads" value={leadId} placeholder="Lead" onChange={value=>setLeadId(value||"")}/></label>
        {lead&&<article className="lead-prefill-card"><div className="initial-badge">{initials((lead.first_name||"")+" "+(lead.last_name||""))}</div><div><strong>{lead.first_name} {lead.last_name}</strong><span>{lead.email} · {lead.phone}</span><small>{[lead.event_type,lead.event_date,lead.venue_name].filter(Boolean).join(" · ")}</small><p>{lead.message||lead.notes||"No notes provided."}</p></div><StatusBadge status={lead.status}/></article>}
      </div>}
      {(sourceMode==="new"||lead||context)&&<div className="wizard-section">
        <h3>Client & Event Details</h3>
        <div className="form-grid">
          <label>First name *<input value={form.first_name} onChange={e=>setField("first_name",e.target.value)}/></label>
          <label>Last name *<input value={form.last_name} onChange={e=>setField("last_name",e.target.value)}/></label>
          <label>Email *<input type="email" value={form.email} onChange={e=>setField("email",e.target.value)}/></label>
          <label>Phone *<input type="tel" value={form.phone} onChange={e=>setField("phone",e.target.value)}/></label>
          <label>Event title<input value={form.event_name} onChange={e=>setField("event_name",e.target.value)} placeholder="e.g. Sarah & Mike's Wedding"/></label>
          <label>Event type *<select value={form.event_type} onChange={e=>setField("event_type",e.target.value)}><option value="">Select event type</option>{eventTypes.map(type=><option key={type}>{type}</option>)}</select></label>
          {form.event_type==="Other"&&<label>Describe event type *<input value={form.custom_event_type} onChange={e=>setField("custom_event_type",e.target.value)}/></label>}
          <label>Event date *<input type="date" value={form.event_date} onChange={e=>setField("event_date",e.target.value)}/></label>
          <label>Start time <small>Optional</small><input type="time" value={form.start_time} onChange={e=>setField("start_time",e.target.value)}/></label>
          <label>End time <small>Optional</small><input type="time" value={form.end_time} onChange={e=>setField("end_time",e.target.value)}/></label>
          <label>Number of guests <small>Optional</small><input type="number" min="1" value={form.guest_count} onChange={e=>setField("guest_count",e.target.value)}/></label>
          <label>Venue <small>Optional</small><input value={form.venue_name} onChange={e=>setField("venue_name",e.target.value)}/></label>
          <label className="wide">Event location <small>Optional</small><input value={form.venue_address} onChange={e=>setField("venue_address",e.target.value)}/></label>
          <label className="wide">Notes <small>Optional</small><textarea value={form.notes} onChange={e=>setField("notes",e.target.value)} placeholder="Client requests, venue notes, creative ideas..."/></label>
        </div>
      </div>}
      <div className="wizard-actions"><Link to="/sales/proposals">Cancel</Link><button className="primary-action" onClick={next}>Continue to Services <ArrowRight size={15}/></button></div>
    </section>}

    {step===2&&<section className="wizard-panel">
      <div className="wizard-heading"><p className="eyebrow">Step 2 of 3</p><h2>Services & Pricing</h2><p>Select one or more LOLA experiences, packages, and optional enhancements.</p></div>
      <div className="experience-card-grid">
        {experiences.map(item=>{const selected=selectedExperiences.some(entry=>entry.experience_id===item.id);return <button key={item.id} className={selected?"experience-card selected":"experience-card"} onClick={()=>chooseExperience(item)}><span className="experience-select">{selected?<Check size={15}/>:<Plus size={15}/>}</span><strong>{item.website_name||item.name}</strong><small>{item.website_short_description||item.description||"LOLA experience"}</small>{item.base_price!=null&&<b>Starting at {money(item.base_price)}</b>}</button>;})}
      </div>
      {selectedExperiences.map(item=><section className="wizard-section package-picker" key={item.experience_id}>
        <div><h3>{item.name} Packages</h3><p>Choose the package that best fits this event.</p></div>
        <div className="package-card-grid">
          {packages.filter(pkg=>pkg.experience_id===item.experience_id).map(pkg=>{const selected=(item.packages||[]).some(entry=>entry.package_id===pkg.id);return <button key={pkg.id} className={selected?"package-card selected":"package-card"} onClick={()=>choosePackage(item.experience_id,pkg)}><strong>{pkg.name}</strong>{pkg.most_popular&&<span>Most Popular</span>}<b>{pkg.pricing_mode==="CUSTOM"?"Let's create":money(pkg.starting_price||0)}</b><small>{pkg.short_description||pkg.description||""}</small></button>;})}
        </div>
      </section>)}
      {!!addons.length&&<section className="wizard-section"><h3>Add-ons <small>Optional</small></h3><div className="addon-choice-grid">{addons.map(item=><label key={item.id}><input type="checkbox" checked={selectedAddons.some(entry=>entry.addon_id===item.id)} onChange={()=>chooseAddon(item)}/><span>{item.name}</span><strong>{money(item.price||0)}</strong></label>)}</div></section>}
      <section className="wizard-pricing-summary">
        <div><span>Selected services</span><strong>{money(pricing.services)}</strong></div>
        <div><span>Add-ons</span><strong>{money(pricing.addonTotal)}</strong></div>
        <div className="total"><span>Estimated investment</span><strong>{money(pricing.total)}</strong></div>
        <button className="button-link" onClick={()=>setAdvanced(v=>!v)}>{advanced?"Hide":"Show"} advanced pricing</button>
        {advanced&&<div className="form-grid advanced-pricing"><label>Discount<input type="number" min="0" value={form.discount} onChange={e=>setField("discount",e.target.value)}/></label><label>Travel<input type="number" min="0" value={form.travel} onChange={e=>setField("travel",e.target.value)}/></label><label>Other fees<input type="number" min="0" value={form.other_fees} onChange={e=>setField("other_fees",e.target.value)}/></label><label>Deposit %<input type="number" min="0" max="100" value={form.deposit_value} onChange={e=>setField("deposit_value",e.target.value)} placeholder="Use default"/></label></div>}
      </section>
      <div className="wizard-actions"><button onClick={()=>setStep(1)}><ArrowLeft size={15}/>Back</button><button className="primary-action" onClick={next}>Continue to Review <ArrowRight size={15}/></button></div>
    </section>}

    {step===3&&<section className="wizard-panel">
      <div className="wizard-heading"><p className="eyebrow">Step 3 of 3</p><h2>Review & Send</h2><p>Review the proposal details before creating or sending.</p></div>
      <div className="review-grid">
        <Review title="Client Information" onEdit={()=>setStep(1)} rows={[["Name",form.first_name+" "+form.last_name],["Email",form.email],["Phone",form.phone]]}/>
        <Review title="Event Details" onEdit={()=>setStep(1)} rows={[["Event",eventTitle()],["Event Type",actualEventType()],["Date",form.event_date],["Guests",form.guest_count||"TBD"],["Venue",form.venue_name||form.venue_address||"TBD"]]}/>
        <Review title="Selected Services" onEdit={()=>setStep(2)} rows={[...selectedExperiences.map(item=>[item.name,item.packages?.length?item.packages.map(pkg=>pkg.name).join(", "):money(item.price||0)]),["Add-ons",selectedAddons.length?selectedAddons.map(item=>item.description).join(", "):"None"],["Investment",money(pricing.total)]]}/>
        <Review title="Proposal Settings" rows={[["Deposit",form.deposit_value?form.deposit_value+"%":"Business default"],["Valid Until",form.valid_through||"Business default"],["Notes",form.notes||"—"]]}/>
      </div>
      <div className="wizard-actions"><button onClick={()=>setStep(2)}><ArrowLeft size={15}/>Back</button><div><button disabled={busy} onClick={()=>submit(false)}><FileText size={15}/>Create as Draft</button><button className="primary-action" disabled={busy} onClick={()=>submit(true)}><Send size={15}/>{busy?"Working...":"Create & Send Proposal"}</button></div></div>
    </section>}
  </main>;
}

function Review({title,rows,onEdit}){return <article className="review-card"><div><h3>{title}</h3>{onEdit&&<button onClick={onEdit}>Edit</button>}</div>{rows.map(([label,value])=><p key={label}><span>{label}</span><strong>{value||"—"}</strong></p>)}</article>;}
function packageSelection(pkg){return{package_id:pkg.id,name:pkg.name,price:Number(pkg.starting_price||0),description:pkg.proposal_description||pkg.description||""};}
function section(title,body,display_order){return{id:title.toLowerCase().replace(/[^a-z0-9]+/g,"_"),title,body,items:[],display_order};}
function clean(value){return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined&&v!==""));}
function money(value){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value||0));}
function initials(name=""){return name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()).join("")||"LO";}
function dateOnly(value){return value?String(value).slice(0,10):"";}
function proposalEventName(lead){return [lead.event_type,[lead.first_name,lead.last_name].filter(Boolean).join(" ")].filter(Boolean).join(" · ");}
function normalizeEventType(value=""){const lower=String(value).toLowerCase();const found=eventTypes.find(type=>type.toLowerCase()===lower);return found||"Other";}
function proposalType(value=""){const lower=String(value).toLowerCase();if(lower.includes("wedding"))return"WEDDING";if(lower.includes("corporate"))return"CORPORATE";if(lower.includes("brand"))return"BRAND_ACTIVATION";if(lower.includes("private")||lower.includes("birthday"))return"PRIVATE_EVENT";return"CUSTOM";}
