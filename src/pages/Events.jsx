
import RelationshipSelect from "../components/RelationshipSelect.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { api } from "../api/client.js";
import { CalendarDays, Plus, Search, SlidersHorizontal, ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const statuses=["","INQUIRY","TENTATIVE","PENDING_CONTRACT","PENDING_DEPOSIT","CONFIRMED","PREPARING","READY","IN_PROGRESS","COMPLETED","CANCELLED"];
const eventTypes=["Wedding","Birthday","Private Party","Brand Activation","Corporate Event","Other"];

export default function Events(){
  const [urlParams,setUrlParams]=useSearchParams();
  const [rows,setRows]=useState([]);
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [creating,setCreating]=useState(urlParams.get("create")==="true");
  const [step,setStep]=useState(1);
  const [saving,setSaving]=useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [options,setOptions]=useState({packages:[],experiences:[]});
  const [duplicate,setDuplicate]=useState(null);
  const [form,setForm]=useState(emptyEvent());
  const status=urlParams.get("status")||"";

  useEffect(()=>{if(urlParams.get("create")==="true")openCreate();},[urlParams.toString()]);

  useEffect(()=>{
    Promise.all([api.get("/pickers/packages?q="),api.get("/pickers/experiences?q=")])
      .then(([packages,experiences])=>setOptions({packages:packages.data||[],experiences:experiences.data||[]}))
      .catch(()=>setOptions({packages:[],experiences:[]}));
  },[]);

  useEffect(()=>{
    const params=new URLSearchParams(urlParams);
    params.delete("create");
    params.set("search",search);
    if(status)params.set("status",status);else params.delete("status");
    let active=true;
    api.get("/events?"+params.toString()).then(result=>active&&setRows(result.data||[])).catch(err=>active&&setError(err.message));
    return()=>{active=false;};
  },[search,status,urlParams.toString(),notice]);

  function openCreate(){
    setCreating(true);setStep(1);setDuplicate(null);setError("");setForm(emptyEvent());
    setUrlParams(current=>{const next=new URLSearchParams(current);next.delete("create");return next;},{replace:true});
  }

  function setStatus(value){
    setUrlParams(current=>{const next=new URLSearchParams(current);if(value)next.set("status",value);else next.delete("status");return next;});
  }

  function toggle(kind,id){
    const key=kind==="experience"?"experience_ids":"package_ids";
    setForm(current=>{
      const list=current[key]||[];
      const next=list.includes(id)?list.filter(item=>item!==id):[...list,id];
      return {...current,[key]:next,[kind+"_id"]:next[0]||null};
    });
  }

  function validateBasics(){
    const required=[["client_id","Client"],["event_name","Event title"],["event_type","Event type"],["event_date","Event date"],["start_time","Start time"],["end_time","End time"]];
    const missing=required.find(([key])=>!form[key]);
    if(missing){setError(missing[1]+" is required.");return false;}
    if(form.end_time<=form.start_time){setError("End time must be after start time.");return false;}
    setError("");return true;
  }

  async function createEvent(continueAnyway=false){
    if(saving)return;
    if(!validateBasics())return;
    setSaving(true);setError("");setNotice("");
    try{
      const payload={...form,guest_count:form.guest_count?Number(form.guest_count):null};
      const created=await api.post(continueAnyway?"/events?continueAnyway=true":"/events",payload);
      setCreating(false);setDuplicate(null);setNotice((created.event_name||"Event")+" created.");
    }catch(err){
      if(err.code==="POSSIBLE_DUPLICATE"&&err.details?.duplicate){
        setDuplicate(err.details.duplicate);
        setError("Possible duplicate event found. Review the existing event before creating another.");
      } else setError(err.message);
    }finally{setSaving(false);}
  }

  return <main className="page lola-events-page">
    <section className="page-heading lola-page-heading">
      <div><p className="eyebrow">Events</p><h1>Events</h1><p className="lede">Plan. Prepare. Execute.</p></div>
      <div className="button-row">
        <Link className="lola-secondary-button" to="/events/calendar"><CalendarDays size={15}/>Calendar</Link>
        <button className="lola-secondary-button" onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal size={15}/>Filters</button>
        <button className="primary-action" onClick={openCreate}><Plus size={15}/>New Event</button>
      </div>
    </section>

    <section className="lola-status-tabs">
      {statuses.map(item=><button key={item||"all"} className={status===item?"active":""} onClick={()=>setStatus(item)}>{item?item.replaceAll("_"," "):"All"}</button>)}
    </section>

    <section className="lola-list-toolbar">
      <div className="lola-list-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search events by name, type or venue..."/></div>
    </section>

    {filtersOpen&&<section className="lola-filter-drawer">
      <label>Date from<input type="date" value={urlParams.get("date_from")||""} onChange={e=>setUrlParams(current=>{const next=new URLSearchParams(current);if(e.target.value)next.set("date_from",e.target.value);else next.delete("date_from");return next;})}/></label>
      <label>Date to<input type="date" value={urlParams.get("date_to")||""} onChange={e=>setUrlParams(current=>{const next=new URLSearchParams(current);if(e.target.value)next.set("date_to",e.target.value);else next.delete("date_to");return next;})}/></label>
    </section>}

    {(error||notice)&&<div className={error?"toast error":"toast"}>{error||notice}</div>}

    <section className="event-card-list">
      {rows.map(event=><Link className="event-row-card" to={"/events/events/"+event.id} key={event.id}>
        <div className="event-date-tile"><strong>{day(event.event_date)}</strong><span>{month(event.event_date)}</span></div>
        <div className="event-row-main"><strong>{event.event_name}</strong><span>{event.event_type||"Event"} · {event.venue_name||"Venue TBD"}</span><small>{event.start_time||"Time TBD"}{event.end_time?" – "+event.end_time:""}</small></div>
        <div className="event-row-meta"><span>{event.guest_count?String(event.guest_count)+" guests":"Guest count TBD"}</span><StatusBadge status={event.status}/></div>
        <ArrowRight size={16}/>
      </Link>)}
      {!rows.length&&<div className="empty-state">No events found.</div>}
    </section>

    {creating&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create event">
      <div className="modal lola-wizard-modal">
        <WizardHeader step={step}/>
        {error&&<div className="toast error">{error}</div>}
        {step===1&&<section>
          <h2>Event details</h2><p className="note-text">Start with what is needed to schedule the event. Operations details can be completed later.</p>
          <div className="form-grid">
            <label>Client *<RelationshipSelect resource="clients" value={form.client_id} placeholder="Select client" onChange={value=>setForm({...form,client_id:value})}/></label>
            <label>Event title *<input value={form.event_name} onChange={e=>setForm({...form,event_name:e.target.value})}/></label>
            <label>Event type *<select value={form.event_type} onChange={e=>setForm({...form,event_type:e.target.value})}><option value="">Select event type</option>{eventTypes.map(type=><option key={type}>{type}</option>)}</select></label>
            <label>Event date *<input type="date" value={form.event_date} onChange={e=>setForm({...form,event_date:e.target.value})}/></label>
            <label>Start time *<input type="time" value={form.start_time} onChange={e=>setForm({...form,start_time:e.target.value})}/></label>
            <label>End time *<input type="time" value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})}/></label>
            <label>Guests<input type="number" min="1" value={form.guest_count} onChange={e=>setForm({...form,guest_count:e.target.value})}/></label>
            <label>Venue<input value={form.venue_name} onChange={e=>setForm({...form,venue_name:e.target.value})}/></label>
            <label className="wide">Address<input value={form.venue_address} onChange={e=>setForm({...form,venue_address:e.target.value})}/></label>
          </div>
        </section>}
        {step===2&&<section>
          <h2>Experiences & packages</h2><p className="note-text">Select everything included in this booking. These selections flow into proposals and operations.</p>
          <div className="wizard-choice-grid">
            <fieldset><legend>Experiences</legend>{options.experiences.map(option=><label className="wizard-check-card" key={option.id}><input type="checkbox" checked={(form.experience_ids||[]).includes(option.id)} onChange={()=>toggle("experience",option.id)}/><span><strong>{option.label}</strong></span></label>)}</fieldset>
            <fieldset><legend>Packages</legend>{options.packages.map(option=><label className="wizard-check-card" key={option.id}><input type="checkbox" checked={(form.package_ids||[]).includes(option.id)} onChange={()=>toggle("package",option.id)}/><span><strong>{option.label}</strong><small>{option.subtitle||""}</small></span></label>)}</fieldset>
          </div>
          <label className="wide">Notes<textarea value={form.client_notes} onChange={e=>setForm({...form,client_notes:e.target.value})} placeholder="Client preferences, venue notes, special requests..."/></label>
        </section>}
        {step===3&&<section>
          <h2>Review event</h2>
          <div className="review-grid">
            <Review title="Event" rows={[["Title",form.event_name],["Type",form.event_type],["Date",form.event_date],["Time",form.start_time+" – "+form.end_time],["Guests",form.guest_count||"TBD"]]}/>
            <Review title="Location" rows={[["Venue",form.venue_name||"TBD"],["Address",form.venue_address||"TBD"]]}/>
            <Review title="Services" rows={[["Experiences",(form.experience_ids||[]).length],["Packages",(form.package_ids||[]).length],["Status","Tentative"]]}/>
          </div>
          {duplicate&&<div className="duplicate-review"><strong>Possible duplicate</strong><p>{duplicate.event_name} · {duplicate.event_number||""}</p><div className="button-row"><Link to={"/events/events/"+duplicate.id}>Open existing event</Link><button onClick={()=>createEvent(true)}>Create separate event anyway</button></div></div>}
        </section>}
        <div className="wizard-actions">
          <button onClick={()=>step===1?setCreating(false):setStep(step-1)}><ArrowLeft size={15}/>{step===1?"Cancel":"Back"}</button>
          {step<3?<button className="primary-action" onClick={()=>{if(step===1&&!validateBasics())return;setStep(step+1);}}>Next <ArrowRight size={15}/></button>:<button className="primary-action" disabled={saving} onClick={()=>createEvent(false)}>{saving?"Creating...":"Create Event"}</button>}
        </div>
      </div>
    </div>}
  </main>;
}

function WizardHeader({step}){return <div className="wizard-header"><div><p className="eyebrow">Create Event</p><h1>Let’s set up the event.</h1></div><div className="wizard-progress">{["Event Details","Services","Review"].map((label,index)=><span className={step===index+1?"active":step>index+1?"done":""} key={label}><b>{index+1}</b>{label}</span>)}</div></div>;}
function Review({title,rows}){return <article className="review-card"><h3>{title}</h3>{rows.map(([label,value])=><p key={label}><span>{label}</span><strong>{String(value??"")}</strong></p>)}</article>;}
function emptyEvent(){return{client_id:"",event_name:"",event_type:"",event_date:"",start_time:"",end_time:"",guest_count:"",venue_name:"",venue_address:"",status:"TENTATIVE",package_ids:[],experience_ids:[],package_id:null,experience_id:null,client_notes:""};}
function day(value){if(!value)return"--";return new Date(value+"T00:00:00").toLocaleDateString("en-US",{day:"2-digit"});}
function month(value){if(!value)return"---";return new Date(value+"T00:00:00").toLocaleDateString("en-US",{month:"short"}).toUpperCase();}
