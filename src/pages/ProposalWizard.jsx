import {withoutCampaignBundle,removeCampaignExperience} from '../../shared/campaign-selection.js';
import CampaignPackagePicker,{mergeCampaignSelections} from '../components/CampaignPackagePicker.jsx';
import {proposalBookingPrefill} from '../../shared/proposal-booking-prefill.js';
import {experienceKey,normalizeScenarioEvent} from "../../shared/proposal-scenario.js";
import ProposalScenarioReview from "../components/ProposalScenarioReview.jsx";
import {mappedProposalPhotos} from "../../shared/proposal-photo-mapping.js";
import {loadCatalog} from "../../shared/catalog-loading.js";
import {experienceImage} from "../utils/experience-assets.js";

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
  const [photoAssets,setPhotoAssets]=useState([]);
  useEffect(()=>{let live=true;api.get("/proposal-assets").then(result=>{if(live)setPhotoAssets(result.data||[]);}).catch(()=>{});return()=>{live=false;};},[]);
  const [selectedExperiences,setSelectedExperiences]=useState([]);
  const [selectedAddons,setSelectedAddons]=useState([]);
  const [advanced,setAdvanced]=useState(false);
  const [busy,setBusy]=useState(false);
  const [overrides,setOverrides]=useState({});
  const [customLines,setCustomLines]=useState([]);
  const [preview,setPreview]=useState(null);
  const [previewError,setPreviewError]=useState('');
  const [createdId,setCreatedId]=useState('');
  const [error,setError]=useState("");
  const [form,setForm]=useState({
    first_name:"",last_name:"",email:"",phone:"",event_name:"",event_type:"",custom_event_type:"",
    event_date:"",start_time:"",end_time:"",guest_count:"",venue_name:"",venue_address:"",city:"",state:"",
    company:"",zip:"",estimated_budget:"",source:"",notes:"",customer_notes:"",tax_rate:"",deposit_type:"PERCENTAGE",discount:"",travel:"",other_fees:"",deposit_value:"",valid_through:"",proposal_title:""
  });

  const [catalogAttempt,setCatalogAttempt]=useState(0);
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [catalogError,setCatalogError]=useState("");
  useEffect(()=>{
    let live=true;
    setCatalogLoading(true);setCatalogError("");
    Promise.allSettled(["experiences","packages","addons"].map(resource=>loadCatalog(api.get,resource)))
      .then(results=>{
        if(!live)return;
        const setters=[setExperiences,setPackages,setAddons];
        const labels=["experiences","packages","add-ons"];
        const failures=[];
        results.forEach((result,index)=>{
          if(result.status==="fulfilled")setters[index](result.value.filter(item=>item.active!==false && (index!==0 || ["glam","360","vogue","audio"].includes(experienceKey(item)))));
          else failures.push(labels[index]+": "+result.reason.message);
        });
        setCatalogError(failures.length?"Unable to load "+failures.join("; "):"");
        setCatalogLoading(false);
      });
    return()=>{live=false;};
  },[catalogAttempt]);

  useEffect(()=>{
    let active=true;
    if(leadId && !catalogLoading)hydrateLead(leadId,()=>active);
    return()=>{active=false;};
  },[leadId,catalogLoading]);

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
        setForm(current=>({...current,first_name:client.first_name||parts[0]||"",last_name:client.last_name||parts.slice(1).join(" "),email:client.email||"",phone:client.phone||"",company:client.company||"",proposal_title:event?.event_name||"",
          event_name:event?.event_name||"",event_type:type,custom_event_type:type==="Other"?(event?.event_type||""):"",event_date:dateOnly(event?.event_date),
          start_time:event?.start_time||"",end_time:event?.end_time||"",guest_count:event?.guest_count||"",venue_name:event?.venue_name||"",venue_address:event?.venue_address||"",city:event?.city||"",state:event?.state||"",zip:event?.zip||"",notes:event?.client_notes||client.notes||""}));
      }catch(err){if(active)setError(err.message);}
      finally{if(active)setContextLoading(false);}
    }
    loadContext();
    return()=>{active=false;};
  },[contextClientId,contextEventId]);

  async function hydrateLead(id,isCurrent){
    setError("");
    try{
      const record=await api.get("/leads/"+id);
      if(!isCurrent())return;
      const prefill=proposalBookingPrefill(record,experiences,packages);
      setLead(record);
      setForm(current=>({...current,...prefill.fields}));
      if(params.get('campaignId')&&params.get('offerKey')){const campaigns=await api.get('/campaigns/offers-for-proposals');if(!isCurrent())return;const offer=campaigns.data?.find(c=>c.id===params.get('campaignId'))?.offers.find(o=>o.key===params.get('offerKey'));if(offer)setSelectedExperiences(offer.selections);else setError('The campaign offer is unavailable. Choose another package.');}else setSelectedExperiences(prefill.selectedExperiences);
    }catch(err){if(isCurrent())setError(err.message);}
  }

  function setField(name,value){setForm(current=>({...current,[name]:value}));}

  function chooseExperience(item){
    setSelectedExperiences(current=>{
      const exists=current.some(entry=>entry.experience_id===item.id);
      if(exists)return removeCampaignExperience(current,item.id);
      return [...current,{experience_id:item.id,name:item.name,packages:[],price:Number(item.base_price||0),description:item.proposal_description||item.description||""}];
    });
  }

  function choosePackage(experienceId,pkg){
    setSelectedExperiences(current=>withoutCampaignBundle(current,experienceId).map(item=>{
      if(item.experience_id!==experienceId)return item;
      const existing=item.packages||[];
      const has=existing.some(entry=>!entry.campaign_id&&entry.package_id===pkg.id);
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
    const required=[...(sourceMode==="existing"?[[leadId,"Select a lead"]]:[]),
      [form.first_name,"First name"],[form.last_name,"Last name"],[form.email,"Email"],[form.phone,"Phone"],[form.event_date,"Event date"],[form.event_type,"Event type"],[form.proposal_title,"Proposal name"]
    ];
    const missing=required.find(([value])=>!value);
    if(missing){setError(missing[1]+" is required.");return false;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)){setError("Enter a valid email address.");return false;}
    if(form.event_type==="Other"&&!form.custom_event_type){setError("Describe the event type.");return false;}
    if(form.start_time&&form.end_time&&form.end_time<=form.start_time){setError("End time must be after start time.");return false;}
    setError("");return true;
  }

  function next(){
    if(step===1&&!validateStepOne())return;
    if(step===2&&(catalogLoading||catalogError)){setError("Wait for the catalog to load, or retry the failed request.");return;}
    if(step===2&&!selectedExperiences.length){setError("Select at least one LOLA experience.");return;}
    if(step===2 && selectedExperiences.some(item=>!item.packages?.length)){setError("Choose a package for each selected experience.");return;}
    setError("");setStep(current=>Math.min(3,current+1));
  }

  async function createClientFromForm(){
    if(context?.client)return context.client.id;
    if(lead?.converted_client_id)return lead.converted_client_id;
    try{
      const client=await api.post("/clients",{
        first_name:form.first_name,last_name:form.last_name,email:form.email,phone:form.phone,
        name:[form.first_name,form.last_name].filter(Boolean).join(" "),company:form.company||null,notes:form.notes||null
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
      company:form.company||null,zip:form.zip||null,estimated_budget:form.estimated_budget?Number(form.estimated_budget):null,referral_source:form.source||null,message:form.customer_notes||null,notes:form.notes||null,status:"NEW",preferred_experience_id:selectedExperiences[0]?.experience_id||null,
      preferred_package_id:selectedExperiences.flatMap(item=>item.packages||[])[0]?.package_id||null
    });
    return created.id;
  }

  const previewPayload=useMemo(()=>clean({
    scenario_enabled:true,scenario_overrides:overrides,
    client_details:{first_name:form.first_name,last_name:form.last_name,name:[form.first_name,form.last_name].filter(Boolean).join(' '),email:form.email,phone:form.phone,company:form.company},
    event_type:form.event_type,event_details:{event_name:eventTitle(),event_type:actualEventType(),event_date:form.event_date,start_time:form.start_time,end_time:form.end_time,guest_count:form.guest_count,venue_name:form.venue_name,venue_address:form.venue_address,city:form.city,state:form.state,zip:form.zip},
    experience_id:selectedExperiences[0]?.experience_id||null,package_id:selectedExperiences[0]?.packages?.[0]?.package_id||null,
    selected_experiences:selectedExperiences,addons:selectedAddons,custom_line_items:customLines,
    visual_sections:mappedProposalPhotos(selectedExperiences,photoAssets,()=>crypto.randomUUID()),
    proposal_title:form.proposal_title||eventTitle(),proposal_type:proposalType(actualEventType()),
    customer_notes:form.customer_notes,notes:form.notes||null,discount:Number(form.discount||0),travel:Number(form.travel||0),other_fees:Number(form.other_fees||0),
    tax_rate:form.tax_rate===''?undefined:Number(form.tax_rate),deposit_type:form.deposit_type,
    deposit_value:form.deposit_value===''?undefined:Number(form.deposit_value),valid_through:form.valid_through||undefined
  }),[form,selectedExperiences,selectedAddons,customLines,overrides,photoAssets]);
  const previewKey=JSON.stringify(previewPayload);
  const previewReady=preview?.key===previewKey;
  useEffect(()=>{
    if(step<2||!selectedExperiences.length)return;
    let active=true;setPreviewError('');
    const timer=setTimeout(()=>api.post('/proposals/preview',previewPayload).then(result=>{if(active)setPreview({...result,key:previewKey});}).catch(err=>{if(active)setPreviewError(err.message);}),450);
    return()=>{active=false;clearTimeout(timer);};
  },[step,previewKey]);

  async function submit(send=false){
    if(busy||!previewReady||!validateStepOne())return;
    if(selectedExperiences.some(item=>!item.packages?.length)){setError("Choose a package for each selected experience.");return;}
    setBusy(true);setError("");
    try{
      const ensuredLeadId=await createLeadIfNeeded();
      const clientId=await createClientFromForm();
      const eventId=await createEventIfReady(clientId);
      const payload={...previewPayload,lead_id:ensuredLeadId,client_id:clientId,event_id:eventId,status:'DRAFT'};
      const proposal=createdId?{id:createdId}:await api.post('/proposals',payload);
      setCreatedId(proposal.id);
      if(send){try{await api.post('/proposals/'+proposal.id+'/send',{});}catch(err){setError('Draft created. Sending failed: '+err.message+' Open the saved draft to retry.');return;}}
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
          <details className="wizard-contact-fields wide" open={sourceMode==="new"}><summary>Contact details</summary><div className="form-grid">          <label>First name *<input value={form.first_name} onChange={e=>setField("first_name",e.target.value)}/></label>
          <label>Last name *<input value={form.last_name} onChange={e=>setField("last_name",e.target.value)}/></label>
          <label>Email *<input type="email" value={form.email} onChange={e=>setField("email",e.target.value)}/></label>
          <label>Phone *<input type="tel" value={form.phone} onChange={e=>setField("phone",e.target.value)}/></label>
<label>Company<input value={form.company} onChange={e=>setField("company",e.target.value)}/></label>
</div></details>
          <label>Proposal name *<input value={form.proposal_title} onChange={e=>setField("proposal_title",e.target.value)} placeholder="e.g. Nova Pulse Summer Launch"/></label>
          <label>Event title<input value={form.event_name} onChange={e=>setField("event_name",e.target.value)} placeholder="e.g. Sarah & Mike's Wedding"/></label>
          <label>Event type *<select value={form.event_type} onChange={e=>setField("event_type",e.target.value)}><option value="">Select event type</option>{eventTypes.map(type=><option key={type}>{type}</option>)}</select></label>
          {form.event_type==="Other"&&<label>Describe event type *<input value={form.custom_event_type} onChange={e=>setField("custom_event_type",e.target.value)}/></label>}
          <label>Event date *<input type="date" value={form.event_date} onChange={e=>setField("event_date",e.target.value)}/></label>
          <label>Start time <small>Optional</small><input type="time" value={form.start_time} onChange={e=>setField("start_time",e.target.value)}/></label>
          <label>End time <small>Optional</small><input type="time" value={form.end_time} onChange={e=>setField("end_time",e.target.value)}/></label>
          <details className="wizard-optional-fields wide"><summary>Venue, guests & notes <small>Optional</small></summary><div className="form-grid">          <label>Number of guests <small>Optional</small><input type="number" min="1" value={form.guest_count} onChange={e=>setField("guest_count",e.target.value)}/></label>
          <label>Venue <small>Optional</small><input value={form.venue_name} onChange={e=>setField("venue_name",e.target.value)}/></label>
          <label className="wide">Event location <small>Optional</small><input value={form.venue_address} onChange={e=>setField("venue_address",e.target.value)}/></label>
          <label>City<input value={form.city} onChange={e=>setField("city",e.target.value)}/></label><label>State<input value={form.state} onChange={e=>setField("state",e.target.value)}/></label><label>ZIP<input value={form.zip} onChange={e=>setField("zip",e.target.value)}/></label><label>Estimated budget<input value={form.estimated_budget} onChange={e=>setField("estimated_budget",e.target.value)}/></label><label>Source<input value={form.source} onChange={e=>setField("source",e.target.value)}/></label>
          <label className="wide">Internal notes <small>Optional</small><textarea value={form.notes} onChange={e=>setField("notes",e.target.value)} placeholder="Client requests, venue notes, creative ideas..."/></label></div></details>
        </div>
      </div>}
      <div className="wizard-actions"><Link to="/sales/proposals">Cancel</Link><button className="primary-action" onClick={next}>Continue to Services <ArrowRight size={15}/></button></div>
    </section>}

    {step===2&&<section className="wizard-panel">
      <div className="wizard-heading"><p className="eyebrow">Step 2 of 3</p><h2>Services & Pricing</h2><p>Select one or more LOLA experiences, packages, and optional enhancements.</p></div>
      {catalogLoading&&<p role="status">Loading experiences and packages…</p>}
      {catalogError&&<div className="toast error" role="alert">{catalogError} <button onClick={()=>setCatalogAttempt(value=>value+1)}>Retry catalog</button></div>}
      {!catalogLoading&&!catalogError&&!experiences.length&&<p role="status">No active experiences are available. Add an experience in the catalog before creating a proposal.</p>}
      <div className="experience-card-grid">
        {experiences.map(item=>{const selected=selectedExperiences.some(entry=>entry.experience_id===item.id);return <button key={item.id} className={selected?"experience-card selected":"experience-card"} onClick={()=>chooseExperience(item)}><img className="wizard-experience-photo" src={item.image_url || item.image || experienceImage(item.name)} alt=""/><span className="experience-select">{selected?<Check size={15}/>:<Plus size={15}/>}</span><strong>{item.website_name||item.name}</strong><small>{item.website_short_description||item.description||"LOLA experience"}</small>{item.base_price!=null&&<b>Starting at {money(item.base_price)}</b>}</button>;})}
      </div>
      {selectedExperiences.map(item=><section className="wizard-section package-picker" key={item.experience_id}>
        <div><h3>{item.name} Packages</h3><p>Choose the package that best fits this event.</p></div>
        <CampaignPackagePicker experienceId={item.experience_id} onSelect={offer=>setSelectedExperiences(current=>mergeCampaignSelections(current,offer))}/>
        <div className="package-card-grid">
          {!packages.some(pkg=>!pkg.experience_id||pkg.experience_id===item.experience_id)&&!catalogLoading&&!catalogError&&<p>No active packages are linked to this experience yet.</p>}
          {packages.filter(pkg=>!pkg.experience_id||pkg.experience_id===item.experience_id).map(pkg=>{const selected=(item.packages||[]).some(entry=>!entry.campaign_id&&entry.package_id===pkg.id);return <button key={pkg.id} className={selected?"package-card selected":"package-card"} onClick={()=>choosePackage(item.experience_id,pkg)}><strong>{pkg.name}</strong>{pkg.most_popular&&<span>Most Popular</span>}<b>{pkg.pricing_mode==="CUSTOM"?"Let's create":money(pkg.starting_price||0)}</b><small>{pkg.short_description||pkg.description||""}</small><small>{pkg.included_hours?pkg.included_hours+" hours":"Duration as agreed"}</small><small>{(pkg.items||pkg.website_features||[]).map(f=>typeof f==="string"?f:f.label).join(" · ")}</small></button>;})}
        </div>
      <div className="form-grid">{(item.packages||[]).map(pkg=><label key={pkg.campaign_id?pkg.campaign_id+pkg.campaign_offer_key:pkg.package_id}>Selected price — {pkg.name}<input type="number" min="0" step="0.01" readOnly={!!pkg.campaign_id} value={pkg.price} onChange={e=>setSelectedExperiences(current=>current.map(row=>row.experience_id===item.experience_id?{...row,packages:row.packages.map(p=>p.package_id===pkg.package_id?{...p,price:Number(e.target.value)}:p)}:row))}/></label>)}</div>
      </section>)}
      {!!addons.length&&<section className="wizard-section"><h3>Add-ons <small>Optional</small></h3><div className="addon-choice-grid">{addons.map(item=><label key={item.id}><input type="checkbox" checked={selectedAddons.some(entry=>entry.addon_id===item.id)} onChange={()=>chooseAddon(item)}/><span>{item.name}</span><strong>{money(item.price||0)}</strong></label>)}</div></section>}
      {!!mappedProposalPhotos(selectedExperiences,photoAssets,()=>"preview").length&&<p role="status">Reviewed experience photos will be included in this proposal.</p>}
      {previewError&&<p role="alert" className="toast error">{previewError}</p>}
      <section className="wizard-pricing-summary">
        <div><span>Selected services</span><strong>{money(pricing.services)}</strong></div>
        <div><span>Add-ons</span><strong>{money(pricing.addonTotal)}</strong></div>
        <div className="total"><span>Estimated investment</span><strong>{previewReady?money(preview.pricing.total):"Calculating…"}</strong></div>
        <button className="button-link" onClick={()=>setAdvanced(v=>!v)}>{advanced?"Hide":"More"} options</button>
        {advanced&&<div className="form-grid advanced-pricing"><label>Discount<input type="number" min="0" value={form.discount} onChange={e=>setField("discount",e.target.value)}/></label><label>Travel<input type="number" min="0" value={form.travel} onChange={e=>setField("travel",e.target.value)}/></label><label>Other fees<input type="number" min="0" value={form.other_fees} onChange={e=>setField("other_fees",e.target.value)}/></label><label>Tax %<input type="number" min="0" value={form.tax_rate} onChange={e=>setField("tax_rate",e.target.value)} placeholder="Business default"/></label><label>Deposit type<select value={form.deposit_type} onChange={e=>setField("deposit_type",e.target.value)}><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></select></label><label>Deposit value<input type="number" min="0" value={form.deposit_value} onChange={e=>setField("deposit_value",e.target.value)} placeholder="Use default"/></label></div>}
        {advanced&&<div className="wizard-section"><h3>Selected add-ons</h3>{selectedAddons.map(item=><div className="form-grid" key={item.addon_id}><label>{item.description} — quantity<input type="number" min="1" value={item.quantity} onChange={e=>setSelectedAddons(current=>current.map(row=>row.addon_id===item.addon_id?{...row,quantity:Number(e.target.value)}:row))}/></label><label>Agreed unit price<input type="number" min="0" step="0.01" value={item.unit_price} onChange={e=>setSelectedAddons(current=>current.map(row=>row.addon_id===item.addon_id?{...row,unit_price:Number(e.target.value)}:row))}/></label></div>)}</div>}
        {advanced&&<div className="wizard-section"><h3>Custom line items</h3>{customLines.map((line,index)=><div className="form-grid" key={index}>{['description','detail','quantity','unit_price'].map(field=><label key={field}>{field.replaceAll('_',' ')}<input type={['quantity','unit_price'].includes(field)?'number':'text'} min={field==='quantity'?1:0} value={line[field]} onChange={e=>setCustomLines(current=>current.map((v,i)=>i===index?{...v,[field]:['quantity','unit_price'].includes(field)?Number(e.target.value):e.target.value}:v))}/></label>)}<button onClick={()=>setCustomLines(current=>current.filter((_,i)=>i!==index))}>Remove item</button></div>)}<button onClick={()=>setCustomLines(current=>[...current,{description:'',detail:'',quantity:1,unit_price:0}])}>Add line item</button></div>}
      </section>
      <div className="wizard-actions"><button onClick={()=>setStep(1)}><ArrowLeft size={15}/>Back</button><button className="primary-action" onClick={next}>Continue to Review <ArrowRight size={15}/></button></div>
    </section>}

    {step===3&&<section className="wizard-panel">
      <div className="wizard-heading"><p className="eyebrow">Step 3 of 3</p><h2>Review & Send</h2><p>Review the proposal details before creating or sending.</p></div>
      <div className="review-grid">
        <Review title="Client Information" onEdit={()=>setStep(1)} rows={[["Name",form.first_name+" "+form.last_name],["Email",form.email],["Phone",form.phone]]}/>
        <Review title="Event Details" onEdit={()=>setStep(1)} rows={[["Event",eventTitle()],["Event Type",actualEventType()],["Date",form.event_date],["Guests",form.guest_count||"TBD"],["Venue",form.venue_name||form.venue_address||"TBD"]]}/>
        <Review title="Selected Services" onEdit={()=>setStep(2)} rows={[...selectedExperiences.map(item=>[item.name,item.packages?.length?item.packages.map(pkg=>pkg.name).join(", "):money(item.price||0)]),["Add-ons",selectedAddons.length?selectedAddons.map(item=>item.description).join(", "):"None"],["Investment",previewReady?money(preview.pricing.total):"Calculating…"]]}/>
        <Review title="Proposal Settings" rows={[["Investment",previewReady?money(preview.pricing.total):"Calculating…"],["Deposit",previewReady?money(preview.pricing.deposit_amount):"Calculating…"],["Balance",previewReady?money(preview.pricing.balance):"Calculating…"],["Valid Until",preview?.scenario.variables.valid_through||"Business default"]]}/>
      </div>
      {previewError&&<p className="toast error" role="alert">{previewError}</p>}
      <div className="form-grid"><label>Valid-through date<input type="date" value={form.valid_through||preview?.scenario.variables.valid_through||''} onChange={e=>setField('valid_through',e.target.value)}/></label><label>Client-facing notes<textarea value={form.customer_notes} onChange={e=>setField('customer_notes',e.target.value)}/></label></div>
      {preview&&<ProposalScenarioReview scenario={preview.scenario} overrides={overrides} onChange={setOverrides} experiences={selectedExperiences} onExperiencesChange={setSelectedExperiences} assets={photoAssets}/>}
      <details className="wizard-section"><summary>Preview client proposal</summary>{previewReady?<iframe title="Client proposal preview" sandbox="" srcDoc={preview.html} style={{width:'100%',height:760,border:'1px solid #ded5c9'}}/>:<p role="status">{previewError||'Updating preview…'}</p>}</details>
      {createdId&&<Link to={'/sales/proposals/'+createdId}>Open saved draft</Link>}
      <div className="wizard-actions"><button onClick={()=>setStep(2)}><ArrowLeft size={15}/>Back</button><div><button disabled={busy||!previewReady||Boolean(createdId)} onClick={()=>submit(false)}><FileText size={15}/>Create as Draft</button><button className="primary-action" disabled={busy||!previewReady||Boolean(createdId)} onClick={()=>submit(true)}><Send size={15}/>{busy?"Working...":"Create & Send Proposal"}</button></div></div>
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
function normalizeEventType(value=''){return normalizeScenarioEvent(value);}
function proposalType(value=""){const lower=String(value).toLowerCase();if(lower.includes("wedding"))return"WEDDING";if(lower.includes("corporate"))return"CORPORATE";if(lower.includes("brand"))return"BRAND_ACTIVATION";if(lower.includes("private")||lower.includes("birthday"))return"PRIVATE_EVENT";return"CUSTOM";}
