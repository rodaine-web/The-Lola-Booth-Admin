import {experienceImage} from "../utils/experience-assets.js";
import EventTypeSelect from '../components/EventTypeSelect.jsx';
import {useDialogFocus} from "../utils/use-dialog-focus.js";
import AsyncState from "../components/AsyncState.jsx";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import MediaSelect from "../components/MediaSelect.jsx";
import RelationshipSelect from "../components/RelationshipSelect.jsx";

export default function ResourcePage({ title, endpoint, columns, phase, rowHref, fields = [] }) {
  const [routeParams] = useSearchParams();
  const isCatalog = ["/experiences","/packages","/addons"].includes(endpoint);
  const [rows, setRows] = useState([]);
  const [loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[saving,setSaving]=useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter,setStatusFilter]=useState(routeParams.get("status")||""),[sort,setSort]=useState("created_at"),[overdue,setOverdue]=useState(routeParams.get("overdue")==="true");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [inlineClientOpen,setInlineClientOpen]=useState(false);
  const [inlineClientSaving,setInlineClientSaving]=useState(false);
  const [inlineClient,setInlineClient]=useState({first_name:"",last_name:"",email:"",phone:""});
  const [multiOptions,setMultiOptions]=useState({packages:[],experiences:[]});
  const [duplicateEvent,setDuplicateEvent]=useState(null);
  useDialogFocus(Boolean(editing),()=>setEditing(null));

  useEffect(()=>{setEditing(null);setForm({});setStatusFilter(routeParams.get("status")||"");setOverdue(routeParams.get("overdue")==="true");},[endpoint,routeParams.toString()]);
  useEffect(()=>{
    if(endpoint!=="/events") return;
    Promise.all([api.get("/pickers/packages?q="),api.get("/pickers/experiences?q=")])
      .then(([packages,experiences])=>setMultiOptions({packages:packages.data||[],experiences:experiences.data||[]}))
      .catch(()=>setMultiOptions({packages:[],experiences:[]}));
  },[endpoint]);
  useEffect(() => {
    let active=true; setLoading(true); setError("");
    const queryParams=new URLSearchParams(routeParams);
    queryParams.set("search",search);
    if(statusFilter)queryParams.set("status",statusFilter);else queryParams.delete("status");
    queryParams.set("sort_by",sort);
    if(overdue)queryParams.set("overdue","true");else queryParams.delete("overdue");
    api.get(`${endpoint}?${queryParams.toString()}`)
      .then((result) => {if(active)setRows(result.data || []);})
      .catch((err) => {
        if(active){setRows([]);setError(err.message);}
      }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  }, [endpoint, search, revision,statusFilter,sort,overdue,routeParams.toString()]);

  function openCreate() {
    setDuplicateEvent(null);
    setInlineClientOpen(false);
    setInlineClient({first_name:"",last_name:"",email:"",phone:""});
    setForm(Object.fromEntries(fields.map(([name, , type]) => [name, type === "checkbox" ? false : ""])));
    if (endpoint === "/experiences") setForm(current=>({...current,website_status:"DRAFT",active:true}));
    if (endpoint === "/packages") setForm(current => ({ ...current, pricing_mode: "STARTING", website_status: "DRAFT", currency: "USD", active: true }));
    if (endpoint === "/events") setForm(current=>({...current,package_ids:[],experience_ids:[]}));
    setEditing({ mode: "create" });
    setError("");
    setNotice("");
  }

  async function openEdit(row) {
    setDuplicateEvent(null);
    setError("");
    setNotice("");
    try {
      const source = endpoint === "/events" ? await api.get(`${endpoint}/${row.id}`) : row;
      setForm({
        ...Object.fromEntries(fields.map(([name, , type]) => [name, type === "checkbox" ? Boolean(source[name]) : type === "lines" ? (source[name] || []).join("\n") : source[name] ?? ""])),
        package_ids: source.package_ids || [],
        experience_ids: source.experience_ids || []
      });
      setEditing({ mode: "edit", id: row.id });
    } catch (err) {
      setError(err.message);
    }
  }

  async function createInlineClient() {
    if (inlineClientSaving) return;
    setInlineClientSaving(true);
    setError("");
    try {
      const created = await api.post("/clients", inlineClient);
      setForm((current) => ({ ...current, client_id: created.id }));
      setInlineClientOpen(false);
      setInlineClient({first_name:"",last_name:"",email:"",phone:""});
      setNotice(`Client ${created.name || "created"} added to this event.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setInlineClientSaving(false);
    }
  }

  function eventPayload() {
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value === "" ? null : value]));
    for (const [name, , type] of fields) if (type === "number" && payload[name] === null && name !== "starting_price") delete payload[name];
    for (const [name, , type] of fields) if (type === "lines") payload[name] = String(form[name] || "").split("\n").map(value => value.trim()).filter(Boolean);
    if (endpoint === "/packages" && payload.pricing_mode === "CUSTOM") payload.starting_price = null;
    return payload;
  }

  async function createDuplicateEventAnyway() {
    if (saving || endpoint !== "/events" || !duplicateEvent) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await api.post("/events?continueAnyway=true", eventPayload());
      setDuplicateEvent(null);
      setEditing(null);
      setNotice("Event created after duplicate review.");
      const queryParams=new URLSearchParams(routeParams);queryParams.set("search",search);if(statusFilter)queryParams.set("status",statusFilter);else queryParams.delete("status");queryParams.set("sort_by",sort);
      const result=await api.get(`/events?${queryParams.toString()}`);
      setRows(result.data||[]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveForm(event) {
    event.preventDefault();
    if(saving)return;
    setError("");
    setNotice("");
    if (endpoint === "/events") {
      const required = [
        ["client_id","Client"],
        ["event_name","Event title"],
        ["event_type","Event type"],
        ["event_date","Event date"],
        ["start_time","Start time"],
        ["end_time","End time"]
      ];
      const missing = required.find(([name]) => !form[name]);
      if (missing) {
        setError(`${missing[1]} is required.`);
        requestAnimationFrame(() => {
          const field = document.querySelector(`[aria-label="${missing[1]}"], [aria-label="Search ${missing[1]}"]`);
          field?.scrollIntoView?.({behavior:"smooth",block:"center"});
          field?.focus?.();
        });
        return;
      }
      if (form.start_time && form.end_time && form.end_time <= form.start_time) {
        setError("End time must be after start time.");
        requestAnimationFrame(()=>document.querySelector('[aria-label="End time"]')?.focus?.());
        return;
      }
    }
    setSaving(true);
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value === "" ? null : value]));
    for(const [name,,type] of fields)if(type==="number"&&payload[name]===null&&name!=="starting_price")delete payload[name];
    for (const [name, , type] of fields) if (type === "lines") payload[name] = String(form[name] || "").split("\n").map(value => value.trim()).filter(Boolean);
    if (endpoint === "/packages" && payload.pricing_mode === "CUSTOM") payload.starting_price = null;
    try {
      if (editing.mode === "edit") {
        await api.patch(`${endpoint}/${editing.id}`, payload);
        setNotice(`${title.replace(/s$/, "")} updated.`);
      } else {
        await api.post(endpoint, payload);
        setNotice(`${title.replace(/s$/, "")} created.`);
      }
      setDuplicateEvent(null);
      setEditing(null);
      const queryParams=new URLSearchParams(routeParams);queryParams.set("search",search);if(statusFilter)queryParams.set("status",statusFilter);else queryParams.delete("status");queryParams.set("sort_by",sort);if(overdue)queryParams.set("overdue","true");else queryParams.delete("overdue");
      const result = await api.get(`${endpoint}?${queryParams.toString()}`);
      setRows(result.data || []);
    } catch (err) {
      if (err.code === "POSSIBLE_DUPLICATE" && err.details?.duplicate) {
        const duplicate = err.details.duplicate;
        if (endpoint === "/events") {
          setDuplicateEvent(duplicate);
          const when = [duplicate.event_date, duplicate.start_time].filter(Boolean).join(" at ");
          setError(`Possible duplicate event: ${duplicate.event_name || "an existing event"}${when ? ` on ${when}` : ""}${duplicate.venue_name ? ` at ${duplicate.venue_name}` : ""}. Review it before deciding whether to create another event.`);
        } else {
          const reason = duplicate.match_reason === "EMAIL_MATCH" ? "email address" : "phone number";
          setError(`Possible duplicate: the ${reason} matches ${duplicate.name || [duplicate.first_name, duplicate.last_name].filter(Boolean).join(" ") || "an existing record"} (${duplicate.email || duplicate.phone || duplicate.id}). Open the existing record before creating another one.`);
        }
      } else if (err.message.includes("Possible duplicate")) {
        setError(`${err.message} Open the existing record or continue with a distinct email/phone.`);
      } else {
        setError(err.message);
      }
    } finally {setSaving(false);}
  }

  return (
    <main className={isCatalog ? "page resource-redesign catalog-redesign" : "page resource-redesign"}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{phase || resourceEyebrow(endpoint)}</p>
          <h1>{title}</h1>
        </div>
        {fields.length > 0 && <button className="primary-action" onClick={openCreate}>New {title.replace(/s$/, "")}</button>}
      </div>
      {isCatalog && <nav className="catalog-section-tabs" aria-label="Catalog sections">{[["experiences","Experiences"],["packages","Packages"],["addons","Add-ons"]].map(([path,label])=><Link key={path} to={`/content/${path}`} className={endpoint===`/${path}`?"active":""}>{label}</Link>)}</nav>}
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <div className="toolbar">
        <input aria-label="Search records" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} />

        {columns.includes('status')&&(statusFilter||rows.some(r=>r.status))&&<label>Status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All statuses</option>{[...new Set([statusFilter,...rows.map(r=>r.status)].filter(Boolean))].map(status=><option key={status}>{status}</option>)}</select></label>}
        <label>Sort<select value={sort} onChange={e=>setSort(e.target.value)}><option value="created_at">Newest first</option><option value="updated_at">Recently updated</option></select></label>
        {endpoint==='/tasks'&&<label>Overdue only<input type="checkbox" checked={overdue} onChange={e=>setOverdue(e.target.checked)}/></label>}
      </div>
      <AsyncState loading={loading} error={error} onRetry={()=>setRevision(r=>r+1)} noun={title.toLowerCase()}>{!loading&&!error&&(isCatalog?<div className="catalog-card-grid">{rows.map(row=><article className="catalog-card" key={row.id}><div className="catalog-card-top"><img className="catalog-list-image" src={row.image_url || row.image || experienceImage(row.name)} alt="" loading="lazy"/></div><div><h2>{row.name||"Untitled"}</h2><p>{row.short_description||row.description||row.proposal_description||"No description yet."}</p></div><div className="catalog-meta">{endpoint==="/experiences"&&<><span>Base price</span><strong>{row.base_price!=null?"$"+Number(row.base_price).toLocaleString():"Custom"}</strong></>}{endpoint==="/packages"&&<><span>{row.pricing_mode==="CUSTOM"?"Custom pricing":"Starting price"}</span><strong>{row.pricing_mode==="CUSTOM"?"Let's create":"$"+Number(row.starting_price||0).toLocaleString()}</strong></>}{endpoint==="/addons"&&<><span>{row.pricing_type||"Add-on"}</span><strong>{"$"+Number(row.price||0).toLocaleString()}</strong></>}</div><div className="catalog-actions"><span className={row.active===false?"catalog-state inactive":"catalog-state"}>{row.active===false?"Inactive":"Active"}</span><button onClick={()=>openEdit(row)}>Edit</button>{row.most_popular&&<span>Most Popular</span>}</div></article>)}</div>:<DataTable rows={rows} columns={columns} getRowHref={rowHref} onEdit={fields.length ? openEdit : null} />)}</AsyncState>
      {editing && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title+" editor"}>
          <form className="modal" onSubmit={saveForm}>
            <div className="modal-heading">
              <h2>{editing.mode === "edit" ? "Edit" : "New"} {title.replace(/s$/, "")}</h2>
              <button type="button" onClick={() => setEditing(null)}>Close</button>
            </div>
            <div className="form-grid">
              {fields.map(([name, label, type = "text", config = {}]) => (
                <label key={name} className={type === "textarea" ? "wide" : ""}>
                  {label}
                  {name === "event_type" ? <EventTypeSelect value={form[name]} onChange={value=>setForm(current=>({...current,[name]:value}))} required/> : name.endsWith("media_id") ? <MediaSelect label={label} value={form[name]} onChange={value=>setForm(current=>({...current,[name]:value}))}/> : type === "textarea" || type === "lines" ? (
                    <textarea aria-label={label} value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
                  ) : type === "select" ? (
                    <select aria-label={label} value={form[name] || ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}><option value="">Select…</option>{config.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
                  ) : type === "checkbox" ? (
                    <input type="checkbox" checked={Boolean(form[name])} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.checked }))} />
                  ) : type === "relationship" ? (
                    <>
                      <RelationshipSelect resource={config.resource} value={form[name]} placeholder={label} onChange={(value) => setForm((current) => ({ ...current, [name]: value }))} />
                      {endpoint === "/events" && name === "client_id" && editing?.mode === "create" && <button type="button" onClick={() => setInlineClientOpen((value) => !value)}>{inlineClientOpen ? "Cancel new client" : "Create new client"}</button>}
                    </>
                  ) : (
                    <input required={Boolean(config.required)} type={type} value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
                  )}
                </label>
              ))}
            </div>
            {endpoint === "/events" && <section className="panel wide">
              <h3>Event experiences and packages</h3>
              <p className="note-text">Select every experience and package included in this event. The first selected item remains the primary selection for legacy reporting.</p>
              <fieldset>
                <legend>Experiences</legend>
                {multiOptions.experiences.map(option=><label className="check-row" key={option.id}><input type="checkbox" checked={(form.experience_ids||[]).includes(option.id)} onChange={(event)=>setForm(current=>{const next=event.target.checked?[...(current.experience_ids||[]),option.id]:(current.experience_ids||[]).filter(id=>id!==option.id);return {...current,experience_ids:next,experience_id:next[0]||null};})}/><span>{option.label}</span></label>)}
              </fieldset>
              <fieldset>
                <legend>Packages</legend>
                {multiOptions.packages.map(option=><label className="check-row" key={option.id}><input type="checkbox" checked={(form.package_ids||[]).includes(option.id)} onChange={(event)=>setForm(current=>{const next=event.target.checked?[...(current.package_ids||[]),option.id]:(current.package_ids||[]).filter(id=>id!==option.id);return {...current,package_ids:next,package_id:next[0]||null};})}/><span>{option.label}{option.subtitle ? " · " + option.subtitle : ""}</span></label>)}
              </fieldset>
            </section>}
            {endpoint === "/events" && inlineClientOpen && <section className="panel wide">
              <h3>Create client without leaving this event</h3>
              <div className="form-grid">
                <label>First name<input required value={inlineClient.first_name} onChange={(event)=>setInlineClient(current=>({...current,first_name:event.target.value}))}/></label>
                <label>Last name<input required value={inlineClient.last_name} onChange={(event)=>setInlineClient(current=>({...current,last_name:event.target.value}))}/></label>
                <label>Email<input required type="email" value={inlineClient.email} onChange={(event)=>setInlineClient(current=>({...current,email:event.target.value}))}/></label>
                <label>Phone<input value={inlineClient.phone} onChange={(event)=>setInlineClient(current=>({...current,phone:event.target.value}))}/></label>
              </div>
              <div className="button-row">
                <button type="button" onClick={()=>setInlineClientOpen(false)}>Cancel</button>
                <button type="button" className="primary-action" disabled={inlineClientSaving||!inlineClient.first_name||!inlineClient.last_name||!inlineClient.email} onClick={createInlineClient}>{inlineClientSaving?"Creating…":"Create client & use"}</button>
              </div>
            </section>}
            {endpoint === "/events" && duplicateEvent && <section className="panel wide" role="alert">
              <h3>Possible duplicate event</h3>
              <p>{duplicateEvent.event_name || "Existing event"}{duplicateEvent.event_number ? ` · ${duplicateEvent.event_number}` : ""}. Open the existing event if this is the same booking. Only create another event when it is intentionally separate.</p>
              <div className="button-row">
                <a href={`/events/events/${duplicateEvent.id}`}>Open existing event</a>
                <button type="button" disabled={saving} onClick={createDuplicateEventAnyway}>Create anyway</button>
              </div>
            </section>}
            <div className="modal-actions">
              <button type="button" onClick={() => {setDuplicateEvent(null);setEditing(null);}}>Cancel</button>
              <button className="primary-action" disabled={saving}>{saving?"Saving…":"Save"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}


function resourceEyebrow(endpoint) {
  if (["/experiences", "/packages", "/addons"].includes(endpoint)) return "Catalog";
  if (endpoint === "/tasks") return "Operations";
  if (endpoint === "/files") return "Operations";
  return "Workspace";
}
